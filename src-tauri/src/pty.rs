//! PTY manager - one ConPTY per session, streamed to the WebView over a Channel.
//!
//! Windows ConPTY note: the conout pipe does NOT return EOF while we still hold the
//! master handle, so a read-until-EOF loop can't detect the shell exiting on its own.
//! Instead each session runs a *waiter* thread on `child.wait()`; when the process ends
//! it removes the session (dropping the master closes the ConPTY, which makes the reader
//! thread's blocking read return) and emits `pty://exit`. A cloned `ChildKiller` kept in
//! the session map lets `kill()` terminate the process from another thread.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter};

/// How to launch a session's process. Sent from the frontend.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ShellSpec {
    Powershell,
    Cmd,
    Wsl,
    Custom {
        program: String,
        #[serde(default)]
        args: Vec<String>,
    },
}

/// Arguments for spawning a session. `id` is the stable session-node id owned by the
/// frontend tree, so the same id is used to write/resize/kill later.
#[derive(Debug, Deserialize)]
pub struct SpawnOpts {
    pub id: String,
    pub shell: ShellSpec,
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Clone, Serialize)]
struct ExitPayload {
    id: String,
}

/// One live pseudo-terminal. The child itself lives in its waiter thread; we keep a
/// cloned killer here so `kill()` works from the command thread.
struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

type Sessions = Arc<Mutex<HashMap<String, PtySession>>>;

/// Owns all live sessions. Registered as Tauri managed state.
#[derive(Default)]
pub struct PtyManager {
    sessions: Sessions,
}

impl PtyManager {
    /// Spawn a ConPTY, start its reader + waiter threads, and register it under `opts.id`.
    pub fn spawn(
        &self,
        app: AppHandle,
        opts: SpawnOpts,
        on_data: Channel<InvokeResponseBody>,
    ) -> Result<(), String> {
        let SpawnOpts {
            id,
            shell,
            cwd,
            cols,
            rows,
        } = opts;

        if self.sessions.lock().contains_key(&id) {
            return Err(format!("session '{id}' already running"));
        }

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| {
                tracing::error!(session = %id, error = %e, "openpty failed");
                format!("openpty failed: {e}")
            })?;

        let cmd = build_command(&shell, cwd.as_deref());
        let mut child = pair.slave.spawn_command(cmd).map_err(|e| {
            tracing::error!(session = %id, error = %e, "spawn_command failed");
            format!("failed to launch shell: {e}")
        })?;

        // Drop the slave so no stray handle keeps the pty open.
        drop(pair.slave);

        let killer = child.clone_killer();
        let mut reader = pair.master.try_clone_reader().map_err(|e| {
            tracing::error!(session = %id, error = %e, "try_clone_reader failed");
            format!("could not read pty: {e}")
        })?;
        let writer = pair.master.take_writer().map_err(|e| {
            tracing::error!(session = %id, error = %e, "take_writer failed");
            format!("could not write pty: {e}")
        })?;

        // Reader thread: blocking reads -> raw bytes to the frontend Channel. Ends when
        // the master is dropped (on exit/kill) and the read returns 0 or errors.
        std::thread::Builder::new()
            .name(format!("pty-read-{id}"))
            .spawn(move || {
                let mut buf = [0u8; 8192];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            if on_data
                                .send(InvokeResponseBody::Raw(buf[..n].to_vec()))
                                .is_err()
                            {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            })
            .map_err(|e| format!("could not start reader thread: {e}"))?;

        // Waiter thread: owns the child, blocks until it exits, then cleans up + notifies.
        let wait_id = id.clone();
        let sessions_ref = self.sessions.clone();
        std::thread::Builder::new()
            .name(format!("pty-wait-{id}"))
            .spawn(move || {
                let _ = child.wait();
                // Dropping the session drops the master, which closes the ConPTY and lets
                // the reader thread finish.
                sessions_ref.lock().remove(&wait_id);
                if let Err(e) = app.emit("pty://exit", ExitPayload { id: wait_id.clone() }) {
                    tracing::debug!(session = %wait_id, error = %e, "emit exit failed");
                }
                tracing::info!(session = %wait_id, "pty exited");
            })
            .map_err(|e| format!("could not start waiter thread: {e}"))?;

        self.sessions.lock().insert(
            id.clone(),
            PtySession {
                master: pair.master,
                writer,
                killer,
            },
        );
        tracing::info!(session = %id, "pty spawned");
        Ok(())
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let session = sessions
            .get_mut(id)
            .ok_or_else(|| format!("no session '{id}'"))?;
        session
            .writer
            .write_all(data)
            .and_then(|_| session.writer.flush())
            .map_err(|e| {
                tracing::warn!(session = %id, error = %e, "pty write failed");
                format!("write failed: {e}")
            })
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock();
        let session = sessions
            .get(id)
            .ok_or_else(|| format!("no session '{id}'"))?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| {
                tracing::warn!(session = %id, error = %e, "pty resize failed");
                format!("resize failed: {e}")
            })
    }

    pub fn kill(&self, id: &str) -> Result<(), String> {
        if let Some(mut session) = self.sessions.lock().remove(id) {
            let _ = session.killer.kill();
            tracing::info!(session = %id, "pty killed");
        }
        Ok(())
    }

    /// Kill every live session. Called on app exit so no ConPTY children leak.
    pub fn kill_all(&self) {
        let mut sessions = self.sessions.lock();
        for (id, mut session) in sessions.drain() {
            let _ = session.killer.kill();
            tracing::debug!(session = %id, "pty killed on shutdown");
        }
    }
}

fn build_command(shell: &ShellSpec, cwd: Option<&str>) -> CommandBuilder {
    let mut cmd = match shell {
        ShellSpec::Powershell => {
            let mut c = CommandBuilder::new("powershell.exe");
            c.arg("-NoLogo");
            c
        }
        ShellSpec::Cmd => CommandBuilder::new("cmd.exe"),
        ShellSpec::Wsl => CommandBuilder::new("wsl.exe"),
        ShellSpec::Custom { program, args } => {
            let mut c = CommandBuilder::new(program);
            for a in args {
                c.arg(a);
            }
            c
        }
    };

    if let Some(dir) = cwd {
        if !dir.is_empty() && std::path::Path::new(dir).is_dir() {
            cmd.cwd(dir);
        }
    }
    cmd.env("TERM", "xterm-256color");
    cmd
}

#[cfg(test)]
mod tests {
    use super::*;

    // Verifies the PTY round-trip against a real ConPTY: spawn `cmd /c echo` and read its
    // output through the same reader path the app uses. The read runs on a helper thread
    // with a hard 6s budget so it can never hang the suite (ConPTY does not EOF the conout
    // while the master is held).
    #[test]
    fn spawns_conpty_and_reads_output() {
        use std::sync::mpsc::{channel, RecvTimeoutError};
        use std::time::{Duration, Instant};

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");

        let mut cmd = CommandBuilder::new("cmd.exe");
        cmd.arg("/c");
        cmd.arg("echo warsha_pty_ok");
        let mut child = pair.slave.spawn_command(cmd).expect("spawn");
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().expect("reader");
        let mut writer = pair.master.take_writer().expect("writer");
        let (tx, rx) = channel::<Vec<u8>>();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        // ConPTY emits a cursor-position query (ESC[6n) on startup and waits for the
        // terminal to answer before the child proceeds - exactly what xterm.js does in
        // the app. Answer it so the shell runs and produces the echo.
        let mut out = String::new();
        let mut answered = false;
        let start = Instant::now();
        while start.elapsed() < Duration::from_secs(6) && !out.contains("warsha_pty_ok") {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(chunk) => out.push_str(&String::from_utf8_lossy(&chunk)),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            if !answered && out.contains("\x1b[6n") {
                let _ = writer.write_all(b"\x1b[1;1R");
                let _ = writer.flush();
                answered = true;
            }
        }
        let _ = child.kill();
        let _ = child.wait();
        assert!(
            out.contains("warsha_pty_ok"),
            "expected echo output within 6s, got: {out:?}"
        );
    }
}
