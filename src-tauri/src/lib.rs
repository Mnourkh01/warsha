//! Warsha - a lightweight terminal workspace. Tauri app entry.

mod commands;
mod headless;
mod pty;
mod session;
mod shells;
mod update;

use pty::PtyManager;
use tauri::{Manager, RunEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                // NB: the lib crate is `warsha_lib` (Cargo.toml [lib]), so tracing targets
                // are `warsha_lib::...` - "warsha" would match nothing and drop all logs.
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("warsha_lib=info")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::which_program,
            commands::shell_check,
            headless::run_headless,
            commands::session_state_load,
            commands::session_state_save,
            commands::session_state_backup,
            commands::plan_file_save,
            commands::update_check,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Kill every live ConPTY on exit so nothing leaks.
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(manager) = app.try_state::<PtyManager>() {
                    manager.kill_all();
                }
            }
        });
}
