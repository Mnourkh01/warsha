//! Deep shell availability checks. A PATH lookup alone lies on Windows: `wsl.exe`
//! ships with the OS before any Linux distribution is installed, and WSL can drop a
//! `bash.exe` stub into System32 that shadows a missing Git Bash. These checks run the
//! real binary, headless and with a hard timeout, so the wizard can give the user real
//! guidance instead of opening a pane that dies instantly.

use serde::Serialize;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
pub struct ShellCheck {
    pub ok: bool,
    /// Short human-readable reason when not ok (trimmed program output or spawn error).
    pub detail: Option<String>,
}

/// First WSL start after boot can be slow; a hung check must still never wedge the UI.
const TIMEOUT: Duration = Duration::from_secs(8);

pub fn check(kind: &str) -> Result<ShellCheck, String> {
    match kind {
        "wsl" => Ok(check_wsl()),
        "bash" => Ok(check_bash()),
        other => Err(format!("unknown shell check: {other}")),
    }
}

/// `wsl -l -q` prints one distro per line (in UTF-16LE, unlike almost everything else).
/// A failure exit OR an empty list both mean "WSL cannot host a session yet".
fn check_wsl() -> ShellCheck {
    match run("wsl.exe", &["-l", "-q"]) {
        Ok(out) => {
            let stdout = decode_console(&out.stdout);
            let ok = out.status.success() && has_nonempty_line(&stdout);
            let detail = (!ok).then(|| short(&decode_console(&out.stderr), &stdout));
            ShellCheck { ok, detail }
        }
        Err(e) => ShellCheck {
            ok: false,
            detail: Some(e),
        },
    }
}

/// Whatever `bash.exe` resolves to on PATH must actually run a trivial command; the
/// System32 stub fails here when no WSL distro exists, while Git Bash succeeds.
fn check_bash() -> ShellCheck {
    match run("bash.exe", &["-c", "exit 0"]) {
        Ok(out) if out.status.success() => ShellCheck {
            ok: true,
            detail: None,
        },
        Ok(out) => ShellCheck {
            ok: false,
            detail: Some(short(
                &decode_console(&out.stderr),
                &decode_console(&out.stdout),
            )),
        },
        Err(e) => ShellCheck {
            ok: false,
            detail: Some(e),
        },
    }
}

fn run(program: &str, args: &[&str]) -> Result<std::process::Output, String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let child = cmd.spawn().map_err(|e| e.to_string())?;
    let pid = child.id();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    match rx.recv_timeout(TIMEOUT) {
        Ok(Ok(out)) => Ok(out),
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => {
            // The checker must not leak a hung child; same tree-kill as PTY teardown.
            crate::pty::kill_tree(Some(pid));
            Err(format!("{program} did not answer within {}s", TIMEOUT.as_secs()))
        }
    }
}

/// Console output is UTF-8 from most tools but UTF-16LE from wsl.exe. Detection order:
/// NUL density in odd positions catches ASCII-heavy UTF-16LE (which IS valid UTF-8, so
/// it must be checked first); strict UTF-8 keeps normal tool output; an even-length
/// non-UTF-8 blob is UTF-16LE with non-ASCII text (e.g. CJK distro names).
fn decode_console(bytes: &[u8]) -> String {
    let utf16 = |bytes: &[u8]| {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    };
    let nul_odds = bytes.iter().skip(1).step_by(2).filter(|b| **b == 0).count();
    if bytes.len() >= 2 && nul_odds > bytes.len() / 4 {
        return utf16(bytes);
    }
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_owned(),
        Err(_) if bytes.len() % 2 == 0 => utf16(bytes),
        Err(_) => String::from_utf8_lossy(bytes).into_owned(),
    }
}

fn has_nonempty_line(text: &str) -> bool {
    text.lines()
        .any(|l| !l.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}' || c == '\0').is_empty())
}

/// One compact line for the UI: prefer stderr, fall back to stdout, cap the length.
fn short(primary: &str, fallback: &str) -> String {
    let s = if primary.trim().is_empty() { fallback } else { primary };
    s.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(160).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16le(s: &str) -> Vec<u8> {
        s.encode_utf16().flat_map(|u| u.to_le_bytes()).collect()
    }

    #[test]
    fn decodes_wsl_utf16_output() {
        let bytes = utf16le("Ubuntu\r\nDebian\r\n");
        assert_eq!(decode_console(&bytes), "Ubuntu\r\nDebian\r\n");
    }

    #[test]
    fn decodes_plain_utf8_output() {
        assert_eq!(decode_console(b"bash: not found"), "bash: not found");
    }

    #[test]
    fn decodes_non_ascii_utf16_output() {
        // CJK UTF-16LE has no NUL bytes, so the NUL-density sniff alone would miss it.
        let bytes = utf16le("中文\r\n");
        assert_eq!(decode_console(&bytes), "中文\r\n");
        // Non-ASCII UTF-8 (Arabic) must stay UTF-8 even though it is not plain ASCII.
        assert_eq!(decode_console("ورشة".as_bytes()), "ورشة");
    }

    #[test]
    fn empty_distro_list_is_not_ok() {
        assert!(!has_nonempty_line(""));
        assert!(!has_nonempty_line("\r\n\r\n"));
        assert!(!has_nonempty_line("\u{feff}\r\n"));
        assert!(has_nonempty_line("Ubuntu\r\n"));
    }

    #[test]
    fn short_prefers_stderr_and_caps_length() {
        assert_eq!(short("boom", "fallback"), "boom");
        assert_eq!(short("  ", "fallback"), "fallback");
        assert_eq!(short("a  b\r\nc", ""), "a b c");
        assert_eq!(short(&"x".repeat(500), "").len(), 160);
    }

    #[test]
    fn unknown_kind_is_an_error() {
        assert!(check("rocket").is_err());
    }
}
