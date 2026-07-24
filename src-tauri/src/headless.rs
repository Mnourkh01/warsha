//! One-shot headless helper process (claude -p) with piped stdio - NOT a PTY.
//! Plain pipes keep the CLI in non-interactive mode: no spinner, no ANSI, no ConPTY
//! line wrapping, and closing stdin is the natural end-of-prompt signal.

use serde::Serialize;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tracing::{info, warn};

const MAX_STDIN: usize = 1_000_000;
const MAX_CAPTURE: usize = 2_000_000;
const MAX_TIMEOUT_MS: u64 = 300_000;
const DEFAULT_TIMEOUT_MS: u64 = 180_000;

/// Programs the WebView may run headless. Boundary validation: the frontend is ours,
/// but IPC input is still treated as untrusted (project convention).
const ALLOWED_PROGRAMS: &[&str] = &["claude"];

#[derive(Serialize)]
pub struct HeadlessResult {
    pub ok: bool,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

/// Flags and small tokens only; the payload travels over stdin, never argv.
fn arg_ok(a: &str) -> bool {
    !a.is_empty()
        && a.len() <= 64
        && a.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '='))
}

#[tauri::command]
pub async fn run_headless(
    program: String,
    args: Vec<String>,
    stdin: String,
    timeout_ms: Option<u64>,
) -> Result<HeadlessResult, String> {
    if !ALLOWED_PROGRAMS.contains(&program.as_str()) {
        return Err(format!("program not allowed: {program}"));
    }
    if args.len() > 8 || !args.iter().all(|a| arg_ok(a)) {
        return Err("invalid arguments".into());
    }
    if stdin.len() > MAX_STDIN {
        return Err("stdin too large".into());
    }
    let timeout =
        Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).min(MAX_TIMEOUT_MS));
    let path = which::which(&program).map_err(|e| format!("{program} not found: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || run_process(path, args, stdin, timeout))
        .await
        .map_err(|e| format!("headless task failed: {e}"))?
}

fn run_process(
    path: PathBuf,
    args: Vec<String>,
    stdin: String,
    timeout: Duration,
) -> Result<HeadlessResult, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    // npm shims are batch files; CreateProcess cannot exec them directly.
    let mut cmd = if ext == "cmd" || ext == "bat" {
        let mut c = Command::new("cmd.exe");
        c.arg("/C").arg(&path).args(&args);
        c
    } else {
        let mut c = Command::new(&path);
        c.args(&args);
        c
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flash
    }
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn failed: {e}"))?;
    let pid = child.id();

    // Writer + readers on their own threads so a full pipe can never deadlock the wait.
    let mut child_stdin = child.stdin.take();
    let writer = std::thread::spawn(move || {
        if let Some(mut si) = child_stdin.take() {
            let _ = si.write_all(stdin.as_bytes());
            // Dropping the handle closes the pipe: EOF = "prompt complete".
        }
    });
    let stdout_pipe = child.stdout.take();
    let out_reader = std::thread::spawn(move || read_capped(stdout_pipe));
    let stderr_pipe = child.stderr.take();
    let err_reader = std::thread::spawn(move || read_capped(stderr_pipe));

    let started = Instant::now();
    let mut timed_out = false;
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {
                if started.elapsed() >= timeout {
                    timed_out = true;
                    // Kill the whole tree: killing only cmd.exe would orphan the node
                    // child, which keeps the pipes open and the readers blocked forever.
                    kill_tree(pid);
                    let _ = child.wait();
                    break None;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(format!("wait failed: {e}")),
        }
    };
    let _ = writer.join();
    let stdout = out_reader.join().unwrap_or_default();
    let stderr = err_reader.join().unwrap_or_default();
    let ok = !timed_out && code == Some(0);
    if ok {
        info!(elapsed_ms = started.elapsed().as_millis() as u64, "headless run finished");
    } else {
        warn!(?code, timed_out, "headless run did not succeed");
    }
    Ok(HeadlessResult { ok, code, stdout, stderr, timed_out })
}

#[cfg(windows)]
fn kill_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    let _ = Command::new("taskkill")
        .args(["/T", "/F", "/PID", &pid.to_string()])
        .creation_flags(0x0800_0000)
        .status();
}

#[cfg(not(windows))]
fn kill_tree(_pid: u32) {}

fn read_capped(pipe: Option<impl Read>) -> String {
    let Some(mut p) = pipe else {
        return String::new();
    };
    let mut buf: Vec<u8> = Vec::new();
    let mut chunk = [0u8; 8192];
    loop {
        match p.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                if buf.len() < MAX_CAPTURE {
                    let take = n.min(MAX_CAPTURE - buf.len());
                    buf.extend_from_slice(&chunk[..take]);
                }
                // Keep draining past the cap so the child never blocks on a full pipe.
            }
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&buf).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_programs_off_the_allowlist() {
        let err = tauri::async_runtime::block_on(run_headless(
            "cmd".into(),
            vec![],
            String::new(),
            None,
        ));
        assert!(err.is_err());
    }

    #[test]
    fn rejects_shell_metacharacter_arguments() {
        let err = tauri::async_runtime::block_on(run_headless(
            "claude".into(),
            vec!["-p; del *".into()],
            String::new(),
            None,
        ));
        assert!(err.is_err());
    }

    #[cfg(windows)]
    #[test]
    fn stdin_round_trips_through_a_piped_process() {
        // findstr with a match-anything pattern echoes stdin back on stdout.
        let out = run_process(
            PathBuf::from("cmd.exe"),
            vec!["/C".into(), "findstr .".into()],
            "hello headless\r\n".into(),
            Duration::from_secs(20),
        )
        .expect("run_process");
        assert!(out.ok, "stderr: {}", out.stderr);
        assert!(out.stdout.contains("hello headless"));
    }

    #[cfg(windows)]
    #[test]
    fn timeout_kills_the_process_tree_and_returns() {
        let started = Instant::now();
        let out = run_process(
            PathBuf::from("cmd.exe"),
            vec!["/C".into(), "ping -n 30 127.0.0.1 > nul".into()],
            String::new(),
            Duration::from_secs(1),
        )
        .expect("run_process");
        assert!(out.timed_out);
        assert!(!out.ok);
        // Must come back promptly, not after ping's ~30s.
        assert!(started.elapsed() < Duration::from_secs(10));
    }
}
