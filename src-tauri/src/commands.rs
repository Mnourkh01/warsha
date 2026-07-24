//! Tauri command surface - the only entry points the WebView can call.

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, State};

use crate::pty::{PtyManager, SpawnOpts};
use crate::session;

#[derive(Debug, Clone, Serialize)]
struct ExitPayload {
    id: String,
    code: u32,
}

// Commands that block (ConPTY setup, taskkill, file I/O) are marked `async` so Tauri
// runs them on the thread pool instead of the main thread; a stalled child or slow disk
// must never freeze the UI. pty_write/pty_resize stay sync: they are a channel send and
// an ioctl.
#[tauri::command(async)]
pub fn pty_spawn(
    app: AppHandle,
    manager: State<'_, PtyManager>,
    opts: SpawnOpts,
    on_data: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    manager.spawn(
        move |id, code| {
            if let Err(e) = app.emit("pty://exit", ExitPayload { id: id.clone(), code }) {
                tracing::debug!(session = %id, error = %e, "emit exit failed");
            }
        },
        opts,
        on_data,
    )
}

#[tauri::command]
pub fn pty_write(manager: State<'_, PtyManager>, id: String, data: String) -> Result<(), String> {
    manager.write(&id, data.as_bytes())
}

#[tauri::command]
pub fn pty_resize(
    manager: State<'_, PtyManager>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(&id, cols, rows)
}

#[tauri::command(async)]
pub fn pty_kill(manager: State<'_, PtyManager>, id: String) -> Result<(), String> {
    manager.kill(&id)
}

/// Resolve a program on PATH. Returns its full path if installed, else None.
#[tauri::command(async)]
pub fn which_program(program: String) -> Option<String> {
    which::which(&program)
        .ok()
        .map(|p| p.to_string_lossy().to_string())
}

/// Deep availability check for shells whose launcher exists even when the shell is
/// unusable (wsl.exe without a distro, a broken bash.exe stub). Runs the real binary
/// headless with a timeout - hence `async`, it can block for seconds.
#[tauri::command(async)]
pub fn shell_check(kind: String) -> Result<crate::shells::ShellCheck, String> {
    crate::shells::check(&kind)
}

#[tauri::command(async)]
pub fn session_state_load(app: AppHandle) -> Result<Option<Value>, String> {
    session::load(&app)
}

#[tauri::command(async)]
pub fn session_state_save(app: AppHandle, state: Value) -> Result<(), String> {
    session::save(&app, &state)
}

/// Back up the current state file (e.g. before discarding an old-version blob).
#[tauri::command(async)]
pub fn session_state_backup(app: AppHandle, label: String) -> Result<(), String> {
    session::backup(&app, &label)
}

/// A plan's on-disk mirror inside the project folder, readable by any AI CLI that
/// works in that folder (claude, codex, gemini).
const PLAN_DIR: &str = ".warsha";
const PLAN_FILE: &str = "plan.md";
/// Well under the 5 MB state cap; a plan at the node/edge limits serializes far smaller.
const MAX_PLAN_MD_BYTES: usize = 2 * 1024 * 1024;

/// Write `<dir>/.warsha/plan.md` atomically (temp + rename, same discipline as the
/// state file). `dir` comes from the WebView, so it must already exist as a directory;
/// this command never creates project folders, only the `.warsha` mirror inside one.
#[tauri::command(async)]
pub fn plan_file_save(dir: String, markdown: String) -> Result<String, String> {
    plan_file_save_at(std::path::Path::new(&dir), &markdown)
}

/// Format spec dropped next to the plan so AIs WITHOUT a skill system (codex, gemini)
/// can learn the draft contract; the ask-for-a-plan prompt points them at it.
const PLAN_SPEC: &str = "BLUEPRINT.md";
const MAX_PLAN_SPEC_BYTES: usize = 256 * 1024;

/// Write `<dir>/.warsha/BLUEPRINT.md` (content is a frontend constant; the file name
/// is fixed here so the WebView can never choose an arbitrary target).
#[tauri::command(async)]
pub fn plan_spec_save(dir: String, spec: String) -> Result<(), String> {
    if spec.len() > MAX_PLAN_SPEC_BYTES {
        return Err("spec too large".to_string());
    }
    let base = std::path::Path::new(&dir);
    if !base.is_dir() {
        return Err(format!("project folder does not exist: {}", base.display()));
    }
    let folder = base.join(PLAN_DIR);
    std::fs::create_dir_all(&folder).map_err(|e| format!("create {PLAN_DIR} failed: {e}"))?;
    std::fs::write(folder.join(PLAN_SPEC), spec.as_bytes()).map_err(|e| {
        tracing::warn!(error = %e, "write blueprint spec failed");
        format!("write spec failed: {e}")
    })
}

/// The AI-to-canvas channel: an AI CLI writes a whole-plan JSON here, the Blueprint
/// polls for it and the user loads it with one click. Consumed (renamed) after load
/// so the same draft never re-triggers the banner.
const PLAN_DRAFT: &str = "plan.draft.json";
const PLAN_DRAFT_APPLIED: &str = "plan.draft.applied.json";

/// Contents of `<dir>/.warsha/plan.draft.json`, or None when there is no draft.
/// A missing project folder is also None - the poller must never error-spam.
#[tauri::command(async)]
pub fn plan_draft_read(dir: String) -> Result<Option<String>, String> {
    let path = std::path::Path::new(&dir).join(PLAN_DIR).join(PLAN_DRAFT);
    if !path.is_file() {
        return Ok(None);
    }
    let meta = std::fs::metadata(&path).map_err(|e| format!("read draft failed: {e}"))?;
    if meta.len() as usize > MAX_PLAN_MD_BYTES {
        return Err("draft too large".to_string());
    }
    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("read draft failed: {e}"))
}

/// Mark the draft as applied: rename it to plan.draft.applied.json (kept as a trace
/// for the AI, replaced on the next load). Idempotent when the draft is already gone.
#[tauri::command(async)]
pub fn plan_draft_consume(dir: String) -> Result<(), String> {
    let folder = std::path::Path::new(&dir).join(PLAN_DIR);
    let draft = folder.join(PLAN_DRAFT);
    if !draft.is_file() {
        return Ok(());
    }
    let applied = folder.join(PLAN_DRAFT_APPLIED);
    // Windows rename fails when the target exists; the old trace is disposable.
    let _ = std::fs::remove_file(&applied);
    std::fs::rename(&draft, &applied).map_err(|e| {
        tracing::warn!(error = %e, "consume plan draft failed");
        format!("consume draft failed: {e}")
    })
}

fn plan_file_save_at(base: &std::path::Path, markdown: &str) -> Result<String, String> {
    if markdown.len() > MAX_PLAN_MD_BYTES {
        tracing::warn!(bytes = markdown.len(), "plan markdown over limit, save rejected");
        return Err("plan too large to save".to_string());
    }
    if !base.is_dir() {
        return Err(format!("project folder does not exist: {}", base.display()));
    }
    let folder = base.join(PLAN_DIR);
    std::fs::create_dir_all(&folder).map_err(|e| {
        tracing::warn!(error = %e, "create plan dir failed");
        format!("create {PLAN_DIR} failed: {e}")
    })?;
    let path = folder.join(PLAN_FILE);
    let tmp = folder.join(format!("{PLAN_FILE}.tmp"));
    {
        use std::io::Write;
        let mut f = std::fs::File::create(&tmp).map_err(|e| {
            tracing::warn!(error = %e, "create temp plan file failed");
            format!("write plan file failed: {e}")
        })?;
        f.write_all(markdown.as_bytes()).map_err(|e| {
            tracing::warn!(error = %e, "write temp plan file failed");
            format!("write plan file failed: {e}")
        })?;
        f.sync_all().map_err(|e| {
            tracing::warn!(error = %e, "sync temp plan file failed");
            format!("write plan file failed: {e}")
        })?;
    }
    std::fs::rename(&tmp, &path).map_err(|e| {
        tracing::warn!(error = %e, "rename plan file failed");
        format!("save plan file failed: {e}")
    })?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("warsha-plan-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create test dir");
        dir
    }

    #[test]
    fn plan_file_save_writes_and_overwrites() {
        let dir = test_dir("save");
        let p1 = plan_file_save_at(&dir, "# Plan v1\n").expect("first save");
        assert!(std::path::Path::new(&p1).exists());
        plan_file_save_at(&dir, "# Plan v2\n").expect("second save");
        let body = std::fs::read_to_string(&p1).expect("read back");
        assert_eq!(body, "# Plan v2\n");
        assert!(!dir.join(PLAN_DIR).join(format!("{PLAN_FILE}.tmp")).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn plan_spec_save_writes_the_fixed_file() {
        let dir = test_dir("spec");
        plan_spec_save(dir.to_string_lossy().into_owned(), "# format".into()).expect("save");
        let body = std::fs::read_to_string(dir.join(PLAN_DIR).join(PLAN_SPEC)).expect("read");
        assert_eq!(body, "# format");
        assert!(plan_spec_save("Z:\\definitely\\missing".into(), "x".into()).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn plan_draft_roundtrip_reads_then_consumes() {
        let dir = test_dir("draft");
        let folder = dir.join(PLAN_DIR);
        std::fs::create_dir_all(&folder).expect("mkdir");
        assert_eq!(plan_draft_read(dir.to_string_lossy().into_owned()).expect("read"), None);
        std::fs::write(folder.join(PLAN_DRAFT), "{\"nodes\":[]}").expect("write draft");
        assert_eq!(
            plan_draft_read(dir.to_string_lossy().into_owned()).expect("read"),
            Some("{\"nodes\":[]}".to_string())
        );
        plan_draft_consume(dir.to_string_lossy().into_owned()).expect("consume");
        assert_eq!(plan_draft_read(dir.to_string_lossy().into_owned()).expect("read"), None);
        assert!(folder.join(PLAN_DRAFT_APPLIED).is_file());
        // Idempotent when nothing is left to consume.
        plan_draft_consume(dir.to_string_lossy().into_owned()).expect("consume again");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn plan_file_save_rejects_missing_dir_and_oversize() {
        let missing = std::env::temp_dir().join("warsha-plan-test-definitely-missing");
        let _ = std::fs::remove_dir_all(&missing);
        assert!(plan_file_save_at(&missing, "x").is_err());
        let dir = test_dir("cap");
        let big = "x".repeat(MAX_PLAN_MD_BYTES + 1);
        assert!(plan_file_save_at(&dir, &big).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
