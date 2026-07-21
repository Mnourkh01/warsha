//! Warsha - a lightweight terminal workspace. Tauri app entry.

mod agent;
mod commands;
mod pty;
mod session;
mod update;

use agent::AgentManager;
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
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(PtyManager::default())
        .manage(AgentManager::default())
        .invoke_handler(tauri::generate_handler![
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::which_program,
            commands::session_state_load,
            commands::session_state_save,
            commands::session_state_backup,
            commands::agent_send,
            commands::agent_cancel,
            commands::update_check,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Kill every live ConPTY and in-flight agent CLI on exit so nothing leaks.
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(manager) = app.try_state::<PtyManager>() {
                    manager.kill_all();
                }
                if let Some(agents) = app.try_state::<AgentManager>() {
                    agents.kill_all();
                }
            }
        });
}
