//! Tauri command surface - the only entry points the WebView can call.

use serde_json::Value;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, State};

use crate::pty::{PtyManager, SpawnOpts};
use crate::session;

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    manager: State<'_, PtyManager>,
    opts: SpawnOpts,
    on_data: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    manager.spawn(app, opts, on_data)
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

#[tauri::command]
pub fn pty_kill(manager: State<'_, PtyManager>, id: String) -> Result<(), String> {
    manager.kill(&id)
}

/// Resolve a program on PATH. Returns its full path if installed, else None.
#[tauri::command]
pub fn which_program(program: String) -> Option<String> {
    which::which(&program)
        .ok()
        .map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
pub fn session_state_load(app: AppHandle) -> Result<Option<Value>, String> {
    session::load(&app)
}

#[tauri::command]
pub fn session_state_save(app: AppHandle, state: Value) -> Result<(), String> {
    session::save(&app, &state)
}
