//! Session-state persistence.
//!
//! The frontend Zustand stores are the single source of truth for the session tree +
//! layout. Rust just persists an opaque JSON blob to `app_config_dir/state.json` so the
//! Rust side never has to duplicate (and drift from) the frontend model. Writes are
//! atomic (temp file + rename) so a crash mid-write can't corrupt the saved workspace.

use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Manager};

const STATE_FILE: &str = "state.json";

fn state_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("no config dir: {e}"))?;
    Ok(dir.join(STATE_FILE))
}

/// Load the saved workspace blob, or `None` on first run.
pub fn load(app: &AppHandle) -> Result<Option<Value>, String> {
    let path = state_path(app)?;
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(&path).map_err(|e| {
        tracing::warn!(error = %e, "read state failed");
        format!("read state failed: {e}")
    })?;
    if raw.trim().is_empty() {
        return Ok(None);
    }
    let value = serde_json::from_str(&raw).map_err(|e| {
        tracing::warn!(error = %e, "parse state failed");
        format!("parse state failed: {e}")
    })?;
    Ok(Some(value))
}

/// Persist the workspace blob atomically.
pub fn save(app: &AppHandle, state: &Value) -> Result<(), String> {
    let path = state_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("create config dir failed: {e}"))?;
    }
    let body = serde_json::to_string_pretty(state).map_err(|e| format!("serialize failed: {e}"))?;

    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, body).map_err(|e| {
        tracing::warn!(error = %e, "write temp state failed");
        format!("write state failed: {e}")
    })?;
    fs::rename(&tmp, &path).map_err(|e| {
        tracing::warn!(error = %e, "rename state failed");
        format!("save state failed: {e}")
    })?;
    Ok(())
}
