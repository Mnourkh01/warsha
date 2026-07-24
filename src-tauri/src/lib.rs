//! Warsha - a lightweight terminal workspace. Tauri app entry.

mod commands;
mod headless;
mod monitor;
mod pty;
mod session;
mod shells;

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Window geometry persistence. DECORATIONS is excluded: the frameless custom
        // title bar (tauri.conf.json decorations:false) must win over any saved state,
        // or a state file from a decorated build re-adds the native title bar forever.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::DECORATIONS,
                )
                .build(),
        )
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
            commands::plan_draft_read,
            commands::plan_draft_consume,
            commands::plan_spec_save,
            monitor::radar_snapshot,
            monitor::radar_kill_process,
            monitor::radar_docker_stop,
            monitor::session_ai_probe,
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
