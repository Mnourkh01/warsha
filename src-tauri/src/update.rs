//! Update check against the private GitHub repo. The standard updater endpoint cannot
//! read a private repo without shipping a token inside the app, so for now the check
//! rides the user's own authenticated `gh` CLI. No gh, offline, or no releases all
//! resolve to "no update" silently - the check must never bother the user with errors.

use std::process::Command;

use serde::Serialize;

const REPO: &str = "Mnourkh01/warsha";

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub url: String,
}

pub fn check() -> Option<UpdateInfo> {
    let gh = which::which("gh").ok()?;

    let mut cmd = Command::new(gh);
    cmd.args(["api", &format!("repos/{REPO}/releases/latest")]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let out = cmd.output().ok()?;
    if !out.status.success() {
        tracing::debug!(code = ?out.status.code(), "update check: gh api failed");
        return None;
    }
    let body: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
    let tag = body.get("tag_name")?.as_str()?;
    let url = body.get("html_url")?.as_str()?.to_string();
    let latest = tag.trim_start_matches('v');

    if is_newer(latest, env!("CARGO_PKG_VERSION")) {
        tracing::info!(latest, "update available");
        Some(UpdateInfo { version: latest.to_string(), url })
    } else {
        None
    }
}

/// Numeric x.y.z compare; malformed segments count as 0 so a weird tag never panics.
fn is_newer(candidate: &str, current: &str) -> bool {
    fn parts(v: &str) -> [u64; 3] {
        let mut out = [0u64; 3];
        for (i, seg) in v.split('.').take(3).enumerate() {
            out[i] = seg.trim().parse().unwrap_or(0);
        }
        out
    }
    parts(candidate) > parts(current)
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn version_compare_is_numeric_not_lexicographic() {
        assert!(is_newer("0.2.0", "0.1.0"));
        assert!(is_newer("0.10.0", "0.9.0")); // lexicographic would fail this
        assert!(is_newer("1.0.0", "0.99.99"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.0.9", "0.1.0"));
        assert!(!is_newer("garbage", "0.1.0"));
    }
}
