//! PTY manager - one ConPTY per session, streamed to the WebView over a Channel.
//!
//! Windows ConPTY note: the conout pipe does NOT return EOF while we still hold the
//! master handle, so a read-until-EOF loop can't detect the shell exiting on its own.
//! Instead each session runs a *waiter* thread on `child.wait()`; when the process ends
//! it removes the session (dropping the master closes the ConPTY, which makes the reader
//! thread's blocking read return) and emits `pty://exit`. A cloned `ChildKiller` kept in
//! the session map lets `kill()` terminate the process from another thread.
//!
//! Concurrency rules (hard-won, keep them):
//! - The session entry is inserted into the map BEFORE the waiter thread starts, and it
//!   carries a per-spawn `nonce`. The waiter removes the entry only if the nonce still
//!   matches, so a stale waiter (from a killed predecessor whose id was reused) can
//!   never remove or announce the death of a newer session.
//! - Input writes go through a per-session writer THREAD over a bounded channel. The
//!   map mutex is held only for the lookup; a stalled child (full conin pipe) makes
//!   `write` return a typed error instead of freezing every other session and the UI.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{SyncSender, TrySendError};
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Deserialize;
use tauri::ipc::{Channel, InvokeResponseBody};

/// Grid-size sanity bounds - ConPTY rejects 0 rows/cols and absurd sizes break TUIs.
const MIN_GRID: u16 = 2;
const MAX_GRID: u16 = 500;
/// Longest accepted session id (frontend uids are far shorter).
const MAX_ID_LEN: usize = 128;
/// Queued input writes per session before `write` errors instead of blocking.
const WRITE_QUEUE: usize = 256;

/// Monotonic spawn identity; lets a waiter know whether the map entry is still its own.
static NEXT_NONCE: AtomicU64 = AtomicU64::new(1);

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

/// One live pseudo-terminal. The child itself lives in its waiter thread; we keep a
/// cloned killer + pid here so `kill()` works from the command thread.
struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer_tx: SyncSender<Vec<u8>>,
    killer: Box<dyn ChildKiller + Send + Sync>,
    child_pid: Option<u32>,
    nonce: u64,
}

type Sessions = Arc<Mutex<HashMap<String, PtySession>>>;

/// Owns all live sessions. Registered as Tauri managed state.
#[derive(Default)]
pub struct PtyManager {
    sessions: Sessions,
}

impl PtyManager {
    /// Spawn a ConPTY, register it under `opts.id`, then start its reader, writer and
    /// waiter threads. Registration happens BEFORE the waiter starts (see module docs).
    ///
    /// `on_exit` fires with the session id and exit code when the child exits on its own
    /// (not when the user killed it). Taking a closure instead of an `AppHandle` keeps
    /// this module free of the Tauri event system, so tests drive it without any mock
    /// runtime.
    pub fn spawn(
        &self,
        on_exit: impl FnOnce(String, u32) + Send + 'static,
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

        if id.is_empty() || id.len() > MAX_ID_LEN {
            return Err("invalid session id".to_string());
        }
        let cols = cols.clamp(MIN_GRID, MAX_GRID);
        let rows = rows.clamp(MIN_GRID, MAX_GRID);

        // Fast-path check; the authoritative occupied check happens at insert below.
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
        let child_pid = child.process_id();
        let mut reader = pair.master.try_clone_reader().map_err(|e| {
            tracing::error!(session = %id, error = %e, "try_clone_reader failed");
            format!("could not read pty: {e}")
        })?;
        let mut writer = pair.master.take_writer().map_err(|e| {
            tracing::error!(session = %id, error = %e, "take_writer failed");
            format!("could not write pty: {e}")
        })?;

        let nonce = NEXT_NONCE.fetch_add(1, Ordering::Relaxed);
        let (writer_tx, writer_rx) = std::sync::mpsc::sync_channel::<Vec<u8>>(WRITE_QUEUE);

        // Register BEFORE any thread can observe the session. contains_key + insert under
        // one guard makes the duplicate check atomic (no TOCTOU with a concurrent spawn).
        {
            let mut sessions = self.sessions.lock();
            if sessions.contains_key(&id) {
                drop(sessions);
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("session '{id}' already running"));
            }
            sessions.insert(
                id.clone(),
                PtySession {
                    master: pair.master,
                    writer_tx,
                    killer,
                    child_pid,
                    nonce,
                },
            );
        }

        let cleanup_on_thread_error = |e: std::io::Error, what: &str| -> String {
            self.sessions.lock().remove(&id);
            tracing::error!(session = %id, error = %e, "could not start {what} thread");
            format!("could not start {what} thread: {e}")
        };

        // Reader thread: blocking reads -> raw bytes to the frontend Channel. Ends when
        // the master is dropped (on exit/kill) and the read returns 0 or errors.
        if let Err(e) = std::thread::Builder::new()
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
        {
            let msg = cleanup_on_thread_error(e, "reader");
            let _ = child.kill();
            return Err(msg);
        }

        // Writer thread: owns the conin writer. Exits when the session entry (and its
        // Sender) is dropped, or on a write error. Keeps blocking writes off the map lock.
        let write_id = id.clone();
        if let Err(e) = std::thread::Builder::new()
            .name(format!("pty-write-{id}"))
            .spawn(move || {
                while let Ok(data) = writer_rx.recv() {
                    if let Err(e) = writer.write_all(&data).and_then(|_| writer.flush()) {
                        tracing::warn!(session = %write_id, error = %e, "pty write failed");
                        break;
                    }
                }
            })
        {
            let msg = cleanup_on_thread_error(e, "writer");
            let _ = child.kill();
            return Err(msg);
        }

        // Waiter thread: owns the child, blocks until it exits, then cleans up + notifies.
        // Removes/announces ONLY if the map entry still carries this spawn's nonce; if the
        // entry is gone the user already killed it (frontend knows), if the nonce differs
        // a newer session reused the id and must be left alone.
        let wait_id = id.clone();
        let sessions_ref = self.sessions.clone();
        if let Err(e) = std::thread::Builder::new()
            .name(format!("pty-wait-{id}"))
            .spawn(move || {
                let code = child.wait().map(|s| s.exit_code()).unwrap_or(0);
                let owned = {
                    let mut sessions = sessions_ref.lock();
                    match sessions.get(&wait_id) {
                        Some(s) if s.nonce == nonce => {
                            // Dropping the entry drops the master, which closes the
                            // ConPTY and lets the reader thread finish.
                            sessions.remove(&wait_id);
                            true
                        }
                        _ => false,
                    }
                };
                if owned {
                    tracing::info!(session = %wait_id, code, "pty exited");
                    on_exit(wait_id, code);
                }
            })
        {
            let msg = cleanup_on_thread_error(e, "waiter");
            // The child was moved into the failed closure and dropped with it, and the
            // killer went down with the removed map entry - kill via pid instead.
            kill_tree(child_pid);
            return Err(msg);
        }

        tracing::info!(session = %id, "pty spawned");
        Ok(())
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let tx = {
            let sessions = self.sessions.lock();
            let session = sessions
                .get(id)
                .ok_or_else(|| format!("no session '{id}'"))?;
            session.writer_tx.clone()
        };
        // Send outside the lock: a stalled child must never block other sessions.
        // Stable machine-readable prefixes: the frontend matches on "queue_full:" to
        // surface a notice. Copy edits must keep the prefix intact.
        tx.try_send(data.to_vec()).map_err(|e| match e {
            TrySendError::Full(_) => {
                tracing::warn!(session = %id, "pty input queue full, write rejected");
                format!("queue_full: session '{id}' is not accepting input")
            }
            TrySendError::Disconnected(_) => format!("session_closed: session '{id}' closed"),
        })
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let cols = cols.clamp(MIN_GRID, MAX_GRID);
        let rows = rows.clamp(MIN_GRID, MAX_GRID);
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
        let removed = { self.sessions.lock().remove(id) };
        if let Some(mut session) = removed {
            kill_tree(session.child_pid);
            let _ = session.killer.kill();
            tracing::info!(session = %id, "pty killed");
        }
        Ok(())
    }

    /// Kill every live session. Called on app exit so no ConPTY children leak.
    pub fn kill_all(&self) {
        let drained: Vec<(String, PtySession)> = {
            let mut sessions = self.sessions.lock();
            sessions.drain().collect()
        };
        for (id, mut session) in drained {
            kill_tree(session.child_pid);
            let _ = session.killer.kill();
            tracing::debug!(session = %id, "pty killed on shutdown");
        }
    }

    #[cfg(test)]
    fn has_session(&self, id: &str) -> bool {
        self.sessions.lock().contains_key(id)
    }

    #[cfg(test)]
    fn session_count(&self) -> usize {
        self.sessions.lock().len()
    }
}

/// Best-effort kill of the whole process tree under the session's shell, so
/// grandchildren (node dev servers etc.) do not outlive a closed pane. The direct
/// child is then killed via `ChildKiller` regardless.
#[cfg(windows)]
fn kill_tree(pid: Option<u32>) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    if let Some(pid) = pid {
        let _ = std::process::Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }
}

#[cfg(not(windows))]
fn kill_tree(_pid: Option<u32>) {}

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
    use std::time::{Duration, Instant};

    fn test_channel() -> Channel<InvokeResponseBody> {
        Channel::new(|_| Ok(()))
    }

    fn spawn_opts(id: &str, shell: ShellSpec) -> SpawnOpts {
        SpawnOpts {
            id: id.to_string(),
            shell,
            cwd: None,
            cols: 80,
            rows: 24,
        }
    }

    fn fast_exit_shell() -> ShellSpec {
        ShellSpec::Custom {
            program: "cmd.exe".to_string(),
            args: vec!["/c".to_string(), "exit".to_string()],
        }
    }

    /// Poll until `cond` is true or the budget runs out.
    fn wait_until(budget: Duration, mut cond: impl FnMut() -> bool) -> bool {
        let start = Instant::now();
        while start.elapsed() < budget {
            if cond() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        cond()
    }

    // Verifies the PTY round-trip against a real ConPTY: spawn `cmd /c echo` and read its
    // output through the same reader path the app uses. The read runs on a helper thread
    // with a hard 6s budget so it can never hang the suite (ConPTY does not EOF the conout
    // while the master is held).
    #[test]
    fn spawns_conpty_and_reads_output() {
        use std::sync::mpsc::{channel, RecvTimeoutError};

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

    // A child that exits instantly must not leave a zombie map entry (the old bug: the
    // waiter ran before the insert, found nothing to remove, and the dead entry then
    // blocked the id forever). After it drains, the same id must be reusable, and the
    // exit callback must have fired exactly for the owned session.
    #[test]
    fn fast_exit_leaves_no_zombie_and_id_is_reusable() {
        let manager = PtyManager::default();
        let exits: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

        let sink = exits.clone();
        manager
            .spawn(
                move |id, _code| sink.lock().push(id),
                spawn_opts("fast1", fast_exit_shell()),
                test_channel(),
            )
            .expect("first spawn");
        // ConPTY blocks the child on its startup cursor-position query (ESC[6n) until
        // the "terminal" answers; xterm does that in the app, the test does it here.
        assert!(
            wait_until(Duration::from_secs(6), || {
                let _ = manager.write("fast1", b"\x1b[1;1R");
                !manager.has_session("fast1")
            }),
            "fast-exit session was never removed from the map (zombie entry)"
        );
        assert_eq!(exits.lock().as_slice(), ["fast1"], "exit callback must fire once");

        manager
            .spawn(|_, _| {}, spawn_opts("fast1", fast_exit_shell()), test_channel())
            .expect("respawn with the same id after fast exit");
        assert!(
            wait_until(Duration::from_secs(6), || {
                let _ = manager.write("fast1", b"\x1b[1;1R");
                manager.session_count() == 0
            }),
            "respawned fast-exit session was never removed"
        );
    }

    // kill() then an immediate respawn under the same id: the stale waiter from the
    // killed child must NOT remove the new session (the old bug: no nonce check), and
    // must NOT announce an exit for it either.
    #[test]
    fn kill_then_respawn_same_id_survives_stale_waiter() {
        let manager = PtyManager::default();
        let exits: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

        let sink = exits.clone();
        manager
            .spawn(
                move |id, _code| sink.lock().push(id),
                spawn_opts("re1", ShellSpec::Cmd),
                test_channel(),
            )
            .expect("first spawn");
        assert!(manager.has_session("re1"));

        manager.kill("re1").expect("kill");
        manager
            .spawn(|_, _| {}, spawn_opts("re1", ShellSpec::Cmd), test_channel())
            .expect("respawn after kill");

        // Give the stale waiter ample time to fire; the new session must survive it.
        std::thread::sleep(Duration::from_millis(1500));
        assert!(
            manager.has_session("re1"),
            "stale waiter removed the respawned session"
        );
        assert!(
            exits.lock().is_empty(),
            "user-killed session must not fire the exit callback"
        );
        manager.kill("re1").expect("cleanup kill");
    }

    // Unknown ids: write/resize return typed errors, kill is idempotent, and a write
    // after kill errors instead of hanging.
    #[test]
    fn unknown_id_paths_error_cleanly() {
        let manager = PtyManager::default();

        assert!(manager.write("ghost", b"x").unwrap_err().contains("no session"));
        assert!(manager.resize("ghost", 80, 24).unwrap_err().contains("no session"));
        assert!(manager.kill("ghost").is_ok());

        manager
            .spawn(|_, _| {}, spawn_opts("w1", ShellSpec::Cmd), test_channel())
            .expect("spawn");
        manager.kill("w1").expect("kill");
        let err = manager.write("w1", b"echo hi\r").unwrap_err();
        assert!(err.contains("no session"), "write after kill: {err}");
    }

    // Spawn-arg validation at the boundary.
    #[test]
    fn spawn_rejects_bad_ids() {
        let manager = PtyManager::default();
        assert!(manager
            .spawn(|_, _| {}, spawn_opts("", fast_exit_shell()), test_channel())
            .is_err());
        let long_id = "x".repeat(200);
        assert!(manager
            .spawn(|_, _| {}, spawn_opts(&long_id, fast_exit_shell()), test_channel())
            .is_err());
    }

    // build_command is pure: TERM is always set, missing/empty cwd is skipped, custom
    // args keep their order.
    #[test]
    fn build_command_sets_term_and_validates_cwd() {
        let cmd = build_command(&ShellSpec::Powershell, None);
        assert_eq!(cmd.get_env("TERM").and_then(|v| v.to_str()), Some("xterm-256color"));

        let cmd = build_command(&ShellSpec::Cmd, Some("C:\\warsha-definitely-missing-dir"));
        assert!(cmd.get_cwd().is_none(), "nonexistent cwd must be skipped");
        let cmd = build_command(&ShellSpec::Cmd, Some(""));
        assert!(cmd.get_cwd().is_none(), "empty cwd must be skipped");

        let cmd = build_command(
            &ShellSpec::Custom {
                program: "foo.exe".to_string(),
                args: vec!["a".to_string(), "b".to_string()],
            },
            None,
        );
        let argv: Vec<String> = cmd
            .get_argv()
            .iter()
            .map(|s| s.to_string_lossy().to_string())
            .collect();
        assert_eq!(argv, vec!["foo.exe", "a", "b"]);
    }
}
