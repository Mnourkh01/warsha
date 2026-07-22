//! Staging for chat image attachments.
//!
//! A dropped or picked image is copied into a controlled cache dir with a safe, space-free
//! name before it is ever handed to the headless CLI. Two reasons:
//!   1. Claude's `@path` mention parser splits on whitespace, so the original path (which
//!      may contain spaces, e.g. `C:\My Pictures\a.png`) cannot be used directly.
//!   2. It bounds what the CLI is allowed to read to a single `--add-dir` scope we own,
//!      instead of one `--add-dir` per arbitrary source directory.
//!
//! The `AppHandle` wrapper only resolves the cache path; the real work lives in the
//! path-based `stage_into` so it is testable without a Tauri runtime.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Image types the Read tool renders as visual content. Kept in one place so the agent
/// argument builder validates against the same list.
pub const ALLOWED_EXT: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp"];

/// Hard cap per attachment. Claude re-encodes large images itself, but a WebView asking us
/// to copy a multi-hundred-MB file is a bug or an abuse attempt (boundary validation).
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

/// Staged images are only needed for the turn that sends them. Anything older than this is
/// pruned on startup so the cache cannot grow without bound across sessions.
const MAX_AGE_SECS: u64 = 24 * 60 * 60;

const SUBDIR: &str = "chat-images";

/// Uniquifier for staged filenames. Time alone can collide when two images are staged in
/// the same nanosecond; the counter breaks the tie.
static COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize)]
pub struct StagedImage {
    /// Absolute path (forward slashes) of the staged copy - safe to hand to the CLI as an
    /// `@mention`.
    pub path: String,
    /// Original filename, shown to the user as the attachment chip label.
    pub name: String,
}

fn images_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("no cache dir: {e}"))?
        .join(SUBDIR);
    Ok(dir)
}

/// Copy `src` into this app's chat-image cache and return its staged path + display name.
pub fn stage(app: &AppHandle, src: &str) -> Result<StagedImage, String> {
    stage_into(&images_dir(app)?, Path::new(src))
}

/// The app-owned staged-image cache dir (may not exist yet). Exposed so the agent builder
/// can confine `--add-dir` to this one directory instead of an arbitrary source folder.
pub fn images_dir_path(app: &AppHandle) -> Option<PathBuf> {
    images_dir(app).ok()
}

/// Best-effort prune of stale staged images. Called on startup so a day of screenshot
/// dropping does not leave the cache dir growing forever. Never fails the app: a cache we
/// cannot clean is a log line, not a crash.
pub fn prune(app: &AppHandle) {
    if let Ok(dir) = images_dir(app) {
        prune_dir(&dir, MAX_AGE_SECS);
    }
}

fn prune_dir(dir: &Path, max_age_secs: u64) {
    let now = std::time::SystemTime::now();
    let max_age = std::time::Duration::from_secs(max_age_secs);
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return, // no cache dir yet, nothing to prune
    };
    for entry in entries.flatten() {
        // Compare Durations, not truncated seconds: a file a few hundred ms old must count
        // as stale under a 0s threshold, which `as_secs()` would round down to "not stale".
        let stale = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|mtime| now.duration_since(mtime).ok())
            .map(|age| age > max_age)
            .unwrap_or(false);
        if stale {
            let path = entry.path();
            if let Err(e) = fs::remove_file(&path) {
                tracing::debug!(path = %path.display(), error = %e, "prune stale image failed");
            }
        }
    }
}

fn unique_name(ext: &str) -> String {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("img-{ts}-{n}.{ext}")
}

fn forward_slashed(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

fn stage_into(dir: &Path, src: &Path) -> Result<StagedImage, String> {
    let meta = fs::metadata(src).map_err(|_| format!("image_missing: {}", src.display()))?;
    if !meta.is_file() {
        return Err(format!("image_not_file: {}", src.display()));
    }
    if meta.len() > MAX_IMAGE_BYTES {
        return Err("image_too_large".to_string());
    }
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !ALLOWED_EXT.contains(&ext.as_str()) {
        return Err(format!("image_type_unsupported: {ext}"));
    }

    fs::create_dir_all(dir).map_err(|e| format!("create image dir failed: {e}"))?;
    let dest = dir.join(unique_name(&ext));
    fs::copy(src, &dest).map_err(|e| {
        tracing::warn!(error = %e, "stage image copy failed");
        format!("stage image failed: {e}")
    })?;

    let name = src
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("image")
        .to_string();
    Ok(StagedImage {
        path: forward_slashed(&dest),
        name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_dir(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("warsha-images-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create test dir");
        dir
    }

    #[test]
    fn stages_a_valid_image_and_keeps_the_original_name() {
        let dir = test_dir("ok");
        let src = dir.join("Screen Shot.png");
        fs::write(&src, b"\x89PNG fake bytes").expect("write src");
        let staged = stage_into(&dir.join("out"), &src).expect("stage");
        assert_eq!(staged.name, "Screen Shot.png");
        assert!(staged.path.ends_with(".png"));
        assert!(!staged.path.contains('\\'), "path must be forward-slashed: {}", staged.path);
        assert!(Path::new(&staged.path.replace('/', std::path::MAIN_SEPARATOR_STR)).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_non_image_extensions() {
        let dir = test_dir("ext");
        let src = dir.join("id_rsa");
        fs::write(&src, b"secret").expect("write");
        let err = stage_into(&dir.join("out"), &src).unwrap_err();
        assert!(err.starts_with("image_type_unsupported"), "got: {err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_a_missing_source() {
        let dir = test_dir("missing");
        let err = stage_into(&dir.join("out"), &dir.join("nope.png")).unwrap_err();
        assert!(err.starts_with("image_missing"), "got: {err}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn two_stages_do_not_collide() {
        let dir = test_dir("collide");
        let src = dir.join("a.jpg");
        fs::write(&src, b"x").expect("write");
        let one = stage_into(&dir.join("out"), &src).expect("one");
        let two = stage_into(&dir.join("out"), &src).expect("two");
        assert_ne!(one.path, two.path);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_removes_stale_keeps_fresh() {
        let dir = test_dir("prune");
        let fresh = dir.join("fresh.png");
        let stale = dir.join("stale.png");
        fs::write(&fresh, b"x").expect("write fresh");
        fs::write(&stale, b"x").expect("write stale");
        // max_age 0 => everything older than "now" is stale; touching fresh right before
        // the sweep is racy, so instead prove selectivity with a huge max_age: nothing goes.
        prune_dir(&dir, u64::MAX);
        assert!(fresh.exists() && stale.exists(), "huge max_age must keep all");
        // max_age 0 => both files (written a moment ago) are older than the threshold.
        prune_dir(&dir, 0);
        assert!(!fresh.exists() && !stale.exists(), "zero max_age must drop all");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prune_missing_dir_is_noop() {
        let dir = test_dir("prune-missing");
        let _ = fs::remove_dir_all(&dir);
        prune_dir(&dir, MAX_AGE_SECS); // must not panic on a non-existent dir
    }
}
