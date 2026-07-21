//! Headless AI-CLI runner for the chat pane. Each user message spawns one short-lived
//! process (`claude -p ... --output-format stream-json`, `gemini -p ...`) with piped
//! stdio - no ConPTY, no TUI. Rust owns the argument construction so the WebView can
//! only pick an agent and a prompt, never inject arbitrary args or programs.

use std::collections::HashMap;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Deserialize;
use tauri::ipc::Channel;

/// Longest prompt we will hand to a CLI argv (Windows command lines cap out around
/// 32K chars; stay far under it).
const MAX_PROMPT_CHARS: usize = 16_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSendOpts {
    /// Chat session id (one in-flight request per session).
    pub id: String,
    /// Which CLI to run - allowlisted, never a raw program name from the WebView.
    pub agent: String,
    pub prompt: String,
    /// Provider conversation id to continue (Claude `--resume`).
    pub resume: Option<String>,
    pub cwd: Option<String>,
}

#[derive(Default)]
pub struct AgentManager {
    running: Mutex<HashMap<String, Child>>,
}

impl AgentManager {
    pub fn kill_all(&self) {
        if let Ok(mut map) = self.running.lock() {
            for (id, child) in map.iter_mut() {
                if let Err(e) = child.kill() {
                    tracing::debug!(session = %id, error = %e, "agent kill on exit failed");
                }
            }
            map.clear();
        }
    }
}

fn build_command(opts: &AgentSendOpts) -> Result<Command, String> {
    let program = match opts.agent.as_str() {
        "claude" => "claude",
        "gemini" => "gemini",
        other => return Err(format!("unknown_agent: {other}")),
    };
    let path = which::which(program).map_err(|_| format!("agent_missing: {program}"))?;

    // npm shims are .cmd/.bat batch files; they only run under cmd.exe.
    let ext = path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mut cmd = if ext == "cmd" || ext == "bat" {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(&path);
        c
    } else {
        Command::new(&path)
    };

    match opts.agent.as_str() {
        "claude" => {
            cmd.args(["-p", &opts.prompt, "--output-format", "stream-json", "--verbose"]);
            if let Some(resume) = opts.resume.as_deref() {
                if !resume.is_empty() {
                    cmd.args(["--resume", resume]);
                }
            }
        }
        _ => {
            cmd.args(["-p", &opts.prompt]);
        }
    }

    if let Some(cwd) = opts.cwd.as_deref() {
        if !cwd.is_empty() {
            cmd.current_dir(cwd);
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    Ok(cmd)
}

/// Run one agent request and stream raw stdout chunks to the channel. Blocks until the
/// process exits (the command is `async`, so it runs on the thread pool). Returns the
/// exit code on success; a non-zero exit surfaces the stderr tail as the error.
pub fn send(
    manager: &AgentManager,
    opts: AgentSendOpts,
    on_output: Channel<String>,
) -> Result<i32, String> {
    if opts.prompt.trim().is_empty() {
        return Err("empty_prompt".into());
    }
    if opts.prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err("prompt_too_long".into());
    }

    let mut cmd = build_command(&opts)?;
    let mut child = cmd.spawn().map_err(|e| {
        tracing::warn!(session = %opts.id, agent = %opts.agent, error = %e, "agent spawn failed");
        format!("agent_spawn_failed: {e}")
    })?;

    let mut stdout = child.stdout.take().ok_or("agent_no_stdout")?;
    let mut stderr = child.stderr.take().ok_or("agent_no_stderr")?;

    {
        let mut map = self_lock(manager)?;
        if map.contains_key(&opts.id) {
            let _ = child.kill();
            return Err("agent_busy".into());
        }
        map.insert(opts.id.clone(), child);
    }

    // Drain stderr concurrently so a chatty CLI cannot deadlock on a full pipe.
    let stderr_thread = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = stderr.read_to_string(&mut buf);
        buf
    });

    let mut chunk = [0u8; 8192];
    let mut carry: Vec<u8> = Vec::new();
    loop {
        match stdout.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                // Chunks can split UTF-8 sequences; carry incomplete tails forward.
                carry.extend_from_slice(&chunk[..n]);
                match String::from_utf8(std::mem::take(&mut carry)) {
                    Ok(text) => {
                        if on_output.send(text).is_err() {
                            break; // WebView gone; stop streaming, still reap below.
                        }
                    }
                    Err(e) => {
                        let bytes = e.into_bytes();
                        let valid = valid_utf8_prefix_len(&bytes);
                        if valid > 0 {
                            let text = String::from_utf8_lossy(&bytes[..valid]).into_owned();
                            if on_output.send(text).is_err() {
                                break;
                            }
                        }
                        carry = bytes[valid..].to_vec();
                    }
                }
            }
            Err(e) => {
                tracing::warn!(session = %opts.id, error = %e, "agent stdout read failed");
                break;
            }
        }
    }

    let mut child = self_lock(manager)?
        .remove(&opts.id)
        .ok_or("agent_cancelled")?;
    let status = child.wait().map_err(|e| format!("agent_wait_failed: {e}"))?;
    let err_tail = stderr_thread.join().unwrap_or_default();
    let code = status.code().unwrap_or(-1);

    if code != 0 {
        let tail: String = err_tail.chars().rev().take(600).collect::<Vec<_>>().into_iter().rev().collect();
        tracing::warn!(session = %opts.id, agent = %opts.agent, code, stderr = %tail, "agent exited non-zero");
        return Err(format!("agent_failed({code}): {}", tail.trim()));
    }
    Ok(code)
}

/// Kill the in-flight request for a chat session, if any. Killing removes the map entry,
/// which the reader loop reports as `agent_cancelled`.
pub fn cancel(manager: &AgentManager, id: &str) -> Result<(), String> {
    let mut map = self_lock(manager)?;
    if let Some(mut child) = map.remove(id) {
        child.kill().map_err(|e| format!("agent_kill_failed: {e}"))?;
    }
    Ok(())
}

fn self_lock(manager: &AgentManager) -> Result<std::sync::MutexGuard<'_, HashMap<String, Child>>, String> {
    manager.running.lock().map_err(|_| "agent_lock_poisoned".to_string())
}

fn valid_utf8_prefix_len(bytes: &[u8]) -> usize {
    match std::str::from_utf8(bytes) {
        Ok(_) => bytes.len(),
        Err(e) => e.valid_up_to(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(agent: &str, prompt: &str) -> AgentSendOpts {
        AgentSendOpts {
            id: "t".into(),
            agent: agent.into(),
            prompt: prompt.into(),
            resume: None,
            cwd: None,
        }
    }

    #[test]
    fn unknown_agent_is_rejected() {
        assert!(build_command(&opts("rm", "hi")).unwrap_err().starts_with("unknown_agent"));
    }

    #[test]
    fn utf8_prefix_split_is_carried() {
        // "م" = 0xD9 0x85; split across chunks must not corrupt.
        let bytes = [b'a', 0xD9];
        assert_eq!(valid_utf8_prefix_len(&bytes), 1);
        assert_eq!(valid_utf8_prefix_len("مرحبا".as_bytes()), 10);
    }

    #[test]
    fn cancel_without_running_request_is_ok() {
        let m = AgentManager::default();
        assert!(cancel(&m, "nope").is_ok());
    }
}
