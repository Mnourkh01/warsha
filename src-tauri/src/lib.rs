//! Warsha - a lightweight terminal workspace. Tauri app entry.

mod commands;
mod pty;
mod session;

use pty::PtyManager;
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warsha=info")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::which_program,
            commands::session_state_load,
            commands::session_state_save,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Kill every live ConPTY on exit so no shell children leak.
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(manager) = app.try_state::<PtyManager>() {
                    manager.kill_all();
                }
            }
        });
}
