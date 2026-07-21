//! Session-state persistence.
//!
//! The frontend Zustand stores are the single source of truth for the session tree +
//! layout. Rust just persists an opaque JSON blob to `app_config_dir/state.json` so the
//! Rust side never has to duplicate (and drift from) the frontend model. Writes are
//! atomic (temp file + rename) so a crash mid-write can't corrupt the saved workspace.
//!
//! The `AppHandle` wrappers only resolve the path; all real logic lives in the
//! path-based helpers below so it is testable without a Tauri runtime.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::Value;
use tauri::{AppHandle, Manager};

const STATE_FILE: &str = "state.json";

/// Serializes state-file writes. Save/backup commands run on Tauri's thread pool, so two
/// debounced saves (or a save racing a backup) would otherwise fight over the shared
/// `state.json.tmp` path and break the atomic-write invariant.
static FILE_LOCK: Mutex<()> = Mutex::new(());

fn file_lock() -> std::sync::MutexGuard<'static, ()> {
    // A poisoned lock only means another writer panicked; the file itself is still
    // consistent (rename is atomic), so writing may continue.
    FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner())
}

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config dir: {e}"))?;
    Ok(dir.join(STATE_FILE))
}

/// Load the saved workspace blob, or `None` on first run.
pub fn load(app: &AppHandle) -> Result<Option<Value>, String> {
    load_from(&state_path(app)?)
}

/// Persist the workspace blob atomically.
pub fn save(app: &AppHandle, state: &Value) -> Result<(), String> {
    save_to(&state_path(app)?, state)
}

/// Copy the current state file to `state.<label>.bak.json`. Used before a
/// version-mismatch reset so old data is never silently destroyed.
pub fn backup(app: &AppHandle, label: &str) -> Result<(), String> {
    backup_at(&state_path(app)?, label)
}

fn load_from(path: &Path) -> Result<Option<Value>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path).map_err(|e| {
        tracing::warn!(error = %e, "read state failed");
        format!("read state failed: {e}")
    })?;
    // Windows editors (Notepad, PowerShell redirects) love to prepend a UTF-8 BOM;
    // serde_json rejects it, which would silently reset the user's workspaces.
    let raw = raw.trim_start_matches('\u{feff}');
    if raw.trim().is_empty() {
        return Ok(None);
    }
    let value = serde_json::from_str(raw).map_err(|e| {
        tracing::warn!(error = %e, "parse state failed");
        format!("parse state failed: {e}")
    })?;
    Ok(Some(value))
}

/// Hard cap on the persisted blob. The real state is a few KB; anything near this is a
/// bug or a compromised WebView trying to disk-fill (boundary validation).
const MAX_STATE_BYTES: usize = 5 * 1024 * 1024;

fn save_to(path: &Path, state: &Value) -> Result<(), String> {
    let _guard = file_lock();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create config dir failed: {e}"))?;
    }
    let body = serde_json::to_string_pretty(state).map_err(|e| format!("serialize failed: {e}"))?;
    if body.len() > MAX_STATE_BYTES {
        tracing::warn!(bytes = body.len(), "state blob over limit, save rejected");
        return Err("state too large to save".to_string());
    }

    let tmp = path.with_extension("json.tmp");
    {
        use std::io::Write;
        let mut f = fs::File::create(&tmp).map_err(|e| {
            tracing::warn!(error = %e, "create temp state failed");
            format!("write state failed: {e}")
        })?;
        f.write_all(body.as_bytes()).map_err(|e| {
            tracing::warn!(error = %e, "write temp state failed");
            format!("write state failed: {e}")
        })?;
        // fsync BEFORE the rename: on power loss NTFS may persist the rename first,
        // which would leave an empty/corrupt state.json.
        f.sync_all().map_err(|e| {
            tracing::warn!(error = %e, "sync temp state failed");
            format!("write state failed: {e}")
        })?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        tracing::warn!(error = %e, "rename state failed");
        format!("save state failed: {e}")
    })?;
    Ok(())
}

/// Boundary validation lives here: the label comes from the WebView, so it is reduced
/// to alphanumerics, `-` and `_` before touching a filename.
fn backup_at(path: &Path, label: &str) -> Result<(), String> {
    let _guard = file_lock();
    if !path.exists() {
        return Ok(());
    }
    let safe: String = label
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(32)
        .collect();
    let name = if safe.is_empty() { "backup".to_string() } else { safe };
    let dest = path.with_file_name(format!("state.{name}.bak.json"));
    fs::copy(path, &dest).map_err(|e| {
        tracing::warn!(error = %e, "backup state failed");
        format!("backup state failed: {e}")
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Fresh per-test directory under the OS temp dir (no tempfile dependency).
    fn test_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "warsha-session-test-{tag}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create test dir");
        dir
    }

    #[test]
    fn round_trip_preserves_the_blob() {
        let dir = test_dir("roundtrip");
        let path = dir.join(STATE_FILE);
        let blob = json!({"version": 3, "workspaces": {"a": [1, 2, 3]}, "غرفة": "عربي"});
        save_to(&path, &blob).expect("save");
        let loaded = load_from(&path).expect("load").expect("some");
        assert_eq!(loaded, blob);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missing_and_empty_files_are_first_run() {
        let dir = test_dir("empty");
        let path = dir.join(STATE_FILE);
        assert_eq!(load_from(&path).expect("missing -> ok"), None);
        fs::write(&path, "   \n").expect("write");
        assert_eq!(load_from(&path).expect("empty -> ok"), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_json_errors_instead_of_panicking() {
        let dir = test_dir("corrupt");
        let path = dir.join(STATE_FILE);
        fs::write(&path, "{not json").expect("write");
        let err = load_from(&path).unwrap_err();
        assert!(err.contains("parse state failed"), "got: {err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_overwrites_atomically_and_leaves_no_tmp() {
        let dir = test_dir("overwrite");
        let path = dir.join(STATE_FILE);
        save_to(&path, &json!({"v": 1})).expect("first");
        save_to(&path, &json!({"v": 2})).expect("second");
        assert_eq!(load_from(&path).unwrap().unwrap()["v"], 2);
        assert!(!path.with_extension("json.tmp").exists(), "tmp must be renamed away");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn bom_prefixed_state_still_loads() {
        let dir = test_dir("bom");
        let path = dir.join(STATE_FILE);
        fs::write(&path, "\u{feff}{\"v\": 7}").expect("write");
        assert_eq!(load_from(&path).expect("load").expect("some")["v"], 7);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn oversized_blob_is_rejected_and_file_untouched() {
        let dir = test_dir("cap");
        let path = dir.join(STATE_FILE);
        save_to(&path, &json!({"v": 1})).expect("small save");
        let big = "x".repeat(MAX_STATE_BYTES + 1);
        let err = save_to(&path, &json!({ "blob": big })).unwrap_err();
        assert!(err.contains("too large"), "got: {err}");
        assert_eq!(load_from(&path).unwrap().unwrap()["v"], 1);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn concurrent_saves_do_not_corrupt() {
        let dir = test_dir("concurrent");
        let path = dir.join(STATE_FILE);
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let p = path.clone();
                std::thread::spawn(move || {
                    for _ in 0..10 {
                        save_to(&p, &json!({ "v": i })).expect("save");
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().expect("join");
        }
        // Whatever write won last, the file parses and no tmp is left behind.
        let v = load_from(&path).expect("load").expect("some");
        assert!(v["v"].is_number());
        assert!(!path.with_extension("json.tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn backup_copies_and_sanitizes_the_label() {
        let dir = test_dir("backup");
        let path = dir.join(STATE_FILE);
        save_to(&path, &json!({"v": 2})).expect("save");
        backup_at(&path, "v2").expect("backup");
        assert!(dir.join("state.v2.bak.json").exists());
        // Hostile label collapses to safe characters only.
        backup_at(&path, "../..\\evil name!").expect("backup hostile");
        assert!(dir.join("state.evilname.bak.json").exists());
        // No state file -> silently ok.
        let missing = dir.join("nope.json");
        backup_at(&missing, "x").expect("missing ok");
        let _ = fs::remove_dir_all(&dir);
    }
}
