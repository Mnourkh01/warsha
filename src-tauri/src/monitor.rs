//! Radar - a read-only snapshot of what is running right now: the process tree under
//! each live session, listening TCP ports, docker containers, and MCP server
//! processes. The WebView polls `radar_snapshot`; the only mutations are the explicit
//! `radar_kill_process` / `radar_docker_stop` commands.
//!
//! Attribution: a process belongs to a session when it is a descendant of that
//! session's shell pid (with a start-time sanity check, because Windows reuses pids).
//! Everything else that still looks dev-relevant (a node/python/php listener, an MCP
//! host) is shown as "outside" so forgotten processes stay visible.

use std::collections::{HashMap, HashSet};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::State;

use crate::pty::{kill_tree, PtyManager};

/// Longest command line sent to the WebView per process (display only).
const MAX_CMD_CHARS: usize = 240;
/// netstat/docker must answer within this budget or the snapshot moves on.
const NETSTAT_TIMEOUT: Duration = Duration::from_secs(5);
const DOCKER_TIMEOUT: Duration = Duration::from_secs(6);
/// `docker stop` waits for the container's grace period (10s default) before SIGKILL.
const DOCKER_STOP_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcEntry {
    pub pid: u32,
    pub name: String,
    pub cmd: String,
    /// Unix seconds the process started; 0 = unknown. Lets the UI age-flag
    /// long-forgotten processes (an MCP host from three days ago).
    pub started_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionProcs {
    pub session_id: String,
    pub shell_pid: u32,
    /// Descendants of the shell, the shell itself excluded (it is the pane).
    pub procs: Vec<ProcEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortListener {
    pub port: u16,
    pub pid: u32,
    pub name: String,
    /// Session whose shell tree owns the listening process, if any.
    pub session_id: Option<String>,
    /// Unix seconds the owning process started; 0 = unknown.
    pub started_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProc {
    pub pid: u32,
    pub name: String,
    /// Friendly server label derived from the command line (e.g. "chrome-devtools").
    pub label: String,
    pub cmd: String,
    pub session_id: Option<String>,
    /// Unix seconds the process started; 0 = unknown.
    pub started_at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub ports: String,
}

/// "ok" | "notInstalled" | "engineOff" | "error" - stable strings the frontend matches.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerInfo {
    pub status: String,
    pub containers: Vec<ContainerInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarSnapshot {
    pub sessions: Vec<SessionProcs>,
    pub ports: Vec<PortListener>,
    pub mcp: Vec<McpProc>,
    pub docker: DockerInfo,
}

/// One row of the OS process table, decoupled from sysinfo so the tree/attribution
/// logic stays a pure function testable without live processes.
#[derive(Debug, Clone)]
struct RawProc {
    pid: u32,
    ppid: Option<u32>,
    name: String,
    cmd: String,
    start_time: u64,
}

#[tauri::command(async)]
pub fn radar_snapshot(manager: State<'_, PtyManager>) -> Result<RadarSnapshot, String> {
    Ok(build_snapshot(
        &process_table(),
        &manager.session_pids(),
        &listening_ports(),
        docker_info(),
    ))
}

/// Which AI CLI a session is running right now, by session id. `ai` is one of the
/// wizard type ids ("claude" | "gemini" | "codex") or None for a plain shell. Lets the
/// UI swap a session's icon live when the user launches an AI by typing its name into
/// a plain terminal instead of going through the wizard.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionAi {
    pub session_id: String,
    pub ai: Option<String>,
}

/// Lightweight sibling of `radar_snapshot`: ONE process-table pass, no netstat, no
/// docker. Cheap enough for the frontend to poll every few seconds.
#[tauri::command(async)]
pub fn session_ai_probe(manager: State<'_, PtyManager>) -> Vec<SessionAi> {
    detect_session_ai(&process_table(), &manager.session_pids())
}

#[tauri::command(async)]
pub fn radar_kill_process(manager: State<'_, PtyManager>, pid: u32) -> Result<(), String> {
    // Boundary validation: the pid comes from the WebView; refuse anything that would
    // take Warsha itself or a whole pane down through the side door.
    if pid <= 4 {
        return Err("refusing to touch a system process".to_string());
    }
    if pid == std::process::id() {
        return Err("that is Warsha itself".to_string());
    }
    if manager.session_pids().iter().any(|(_, p)| *p == pid) {
        return Err("that is a session's shell. Close its pane instead".to_string());
    }
    taskkill_tree(pid)
}

#[tauri::command(async)]
pub fn radar_docker_stop(id: String) -> Result<(), String> {
    if id.is_empty() || id.len() > 64 || !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("invalid container id".to_string());
    }
    let docker = which::which("docker").map_err(|_| "docker is not installed".to_string())?;
    let out = run_capture(docker.to_string_lossy().as_ref(), &["stop", &id], DOCKER_STOP_TIMEOUT)?;
    if out.code != Some(0) {
        tracing::warn!(container = %id, stderr = %out.stderr, "docker stop failed");
        return Err(short_reason(&out.stderr, "docker stop failed"));
    }
    tracing::info!(container = %id, "docker container stopped from radar");
    Ok(())
}

/* ---- snapshot assembly (pure over RawProc rows) ------------------------------- */

/// Pure assembly over already-probed inputs, so tests never touch the live OS.
fn build_snapshot(
    table: &[RawProc],
    session_pids: &[(String, u32)],
    port_pairs: &[(u16, u32)],
    docker: DockerInfo,
) -> RadarSnapshot {
    let by_pid: HashMap<u32, &RawProc> = table.iter().map(|p| (p.pid, p)).collect();
    let owner = session_owner_map(table, session_pids);

    let mut ports: Vec<PortListener> = port_pairs
        .iter()
        .filter_map(|&(port, pid)| {
            let proc_ = by_pid.get(&pid)?;
            if is_system_noise(&proc_.name) || is_own_surface(&proc_.name) {
                return None;
            }
            let session_id = owner.get(&pid).cloned();
            // Unattributed listeners only show when they look dev-made, so the list
            // never fills with Windows services the user cannot act on.
            if session_id.is_none() && !is_dev_listener(&proc_.name) {
                return None;
            }
            Some(PortListener {
                port,
                pid,
                name: proc_.name.clone(),
                session_id,
                started_at: proc_.start_time,
            })
        })
        .collect();
    ports.sort_by_key(|p| p.port);

    // An npx-launched server is a cmd.exe wrapper AND its node child, both matching
    // "mcp". Listing both doubles the count and offers two kill buttons for one
    // server; keep only the top-most process of each chain (killing it takes the
    // whole tree down anyway).
    let mcp_pids: HashSet<u32> = table
        .iter()
        .filter(|p| p.pid != std::process::id() && looks_like_mcp(&p.cmd))
        .filter(|p| !is_system_noise(&p.name) && !is_own_surface(&p.name))
        .map(|p| p.pid)
        .collect();
    let ppid_of: HashMap<u32, u32> = table
        .iter()
        .filter_map(|p| p.ppid.map(|pp| (p.pid, pp)))
        .collect();
    let has_mcp_ancestor = |pid: u32| -> bool {
        let mut cur = pid;
        // Bounded walk: parent chains are short and a ppid cycle must not hang us.
        for _ in 0..32 {
            match ppid_of.get(&cur) {
                Some(&pp) if mcp_pids.contains(&pp) => return true,
                Some(&pp) if pp != cur => cur = pp,
                _ => return false,
            }
        }
        false
    };

    let mut mcp: Vec<McpProc> = table
        .iter()
        .filter(|p| mcp_pids.contains(&p.pid) && !has_mcp_ancestor(p.pid))
        .map(|p| McpProc {
            pid: p.pid,
            name: p.name.clone(),
            label: mcp_label(&p.cmd),
            cmd: clip(&p.cmd, MAX_CMD_CHARS),
            session_id: owner.get(&p.pid).cloned(),
            started_at: p.start_time,
        })
        .collect();
    // Oldest first: the whole point of the list is spotting the forgotten ones
    // (a three-day-old MCP host nobody is talking to anymore). 0 = unknown, last.
    mcp.sort_by(|a, b| {
        let ka = if a.started_at == 0 { u64::MAX } else { a.started_at };
        let kb = if b.started_at == 0 { u64::MAX } else { b.started_at };
        ka.cmp(&kb).then(a.pid.cmp(&b.pid))
    });

    // A session's process list must not repeat what the port and MCP rows already
    // show: the listener pid, every MCP host, and everything an MCP host spawned
    // (its npx wrapper children, its automation chrome). Duplicated rows were the
    // main reason the dialog felt overwhelming.
    let port_pids: HashSet<u32> = ports.iter().map(|p| p.pid).collect();
    let sessions = session_pids
        .iter()
        .map(|(sid, shell_pid)| SessionProcs {
            session_id: sid.clone(),
            shell_pid: *shell_pid,
            procs: owner
                .iter()
                .filter(|(pid, owner_sid)| *owner_sid == sid && **pid != *shell_pid)
                .filter_map(|(pid, _)| by_pid.get(pid))
                .filter(|p| !is_console_plumbing(&p.name))
                .filter(|p| {
                    !port_pids.contains(&p.pid)
                        && !mcp_pids.contains(&p.pid)
                        && !has_mcp_ancestor(p.pid)
                })
                .map(|p| ProcEntry {
                    pid: p.pid,
                    name: p.name.clone(),
                    cmd: clip(&p.cmd, MAX_CMD_CHARS),
                    started_at: p.start_time,
                })
                .collect::<Vec<_>>(),
        })
        .map(|mut s| {
            s.procs.sort_by_key(|p| p.pid);
            s
        })
        .collect();

    RadarSnapshot {
        sessions,
        ports,
        mcp,
        docker,
    }
}

/// Pure core of `session_ai_probe`. Newest matching process wins so the CLI the user
/// just launched beats an older stray match deeper in the tree. MCP hosts are skipped:
/// an AI's helper server (whose cmd often names the AI's install path) must not keep
/// the icon lit after the CLI itself exited.
fn detect_session_ai(table: &[RawProc], session_pids: &[(String, u32)]) -> Vec<SessionAi> {
    let owner = session_owner_map(table, session_pids);
    let mut candidates: Vec<&RawProc> = table
        .iter()
        .filter(|p| owner.contains_key(&p.pid) && !looks_like_mcp(&p.cmd))
        .collect();
    candidates.sort_by_key(|p| std::cmp::Reverse(p.start_time));
    session_pids
        .iter()
        .map(|(sid, shell_pid)| SessionAi {
            session_id: sid.clone(),
            ai: candidates
                .iter()
                .filter(|p| p.pid != *shell_pid && owner.get(&p.pid) == Some(sid))
                .find_map(|p| classify_ai(&p.name, &p.cmd)),
        })
        .collect()
}

/// Match a process to an AI CLI id. Name and command line both count: on Windows the
/// CLIs usually run as `node.exe` with the product name only in the command line.
fn classify_ai(name: &str, cmd: &str) -> Option<String> {
    let hay = format!("{} {}", base_name(name), cmd.to_ascii_lowercase());
    for id in ["claude", "gemini", "codex"] {
        if hay.contains(id) {
            return Some((*id).to_string());
        }
    }
    None
}

/// pid -> owning session id, for every descendant of every live session shell.
/// The shell pid itself is included (it belongs to its session).
fn session_owner_map(
    table: &[RawProc],
    session_pids: &[(String, u32)],
) -> HashMap<u32, String> {
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    let by_pid: HashMap<u32, &RawProc> = table.iter().map(|p| (p.pid, p)).collect();
    for p in table {
        if let Some(ppid) = p.ppid {
            // Windows reuses pids: a stale ppid can point at an unrelated newer
            // process. A real child never started before its parent (0 = unknown,
            // let it pass rather than hide live work).
            let parent_ok = by_pid
                .get(&ppid)
                .map(|par| p.start_time == 0 || par.start_time == 0 || p.start_time >= par.start_time)
                .unwrap_or(false);
            if parent_ok {
                children.entry(ppid).or_default().push(p.pid);
            }
        }
    }

    let mut owner: HashMap<u32, String> = HashMap::new();
    for (sid, shell_pid) in session_pids {
        let mut queue = vec![*shell_pid];
        let mut seen: HashSet<u32> = HashSet::new();
        while let Some(pid) = queue.pop() {
            if !seen.insert(pid) {
                continue;
            }
            owner.insert(pid, sid.clone());
            if let Some(kids) = children.get(&pid) {
                queue.extend(kids.iter().copied());
            }
        }
    }
    owner
}

/* ---- classification helpers --------------------------------------------------- */

fn base_name(name: &str) -> String {
    name.to_ascii_lowercase()
        .trim_end_matches(".exe")
        .to_string()
}

/// Windows services and infrastructure the user can never act on from Warsha.
fn is_system_noise(name: &str) -> bool {
    matches!(
        base_name(name).as_str(),
        "system" | "svchost" | "services" | "wininit" | "lsass" | "spoolsv"
            | "memory compression" | "smss" | "csrss" | "winlogon"
    )
}

/// Warsha's own surface: the app and its WebView children must never list themselves.
fn is_own_surface(name: &str) -> bool {
    let base = base_name(name);
    base == "warsha" || base.starts_with("msedgewebview2")
}

/// ConPTY plumbing that exists under every session and means nothing to the user.
fn is_console_plumbing(name: &str) -> bool {
    matches!(base_name(name).as_str(), "conhost" | "openconsole")
}

/// Names that make an unattributed listener worth showing (dev servers, runtimes,
/// databases). Everything else outside a session tree is Windows background noise.
fn is_dev_listener(name: &str) -> bool {
    matches!(
        base_name(name).as_str(),
        "node" | "bun" | "deno" | "python" | "pythonw" | "py" | "php" | "php-cgi"
            | "ruby" | "java" | "javaw" | "dotnet" | "caddy" | "nginx" | "httpd"
            | "go" | "cargo" | "uvicorn" | "gunicorn" | "mysqld" | "postgres"
            | "redis-server" | "mongod" | "meilisearch" | "stripe" | "ngrok"
            | "docker-proxy" | "com.docker.backend" | "wslrelay"
    )
}

/// An MCP host is any process whose command line mentions mcp - npx wrappers,
/// python -m servers, packaged exes. Substring on purpose: server names vary too
/// much for an allowlist, and a rare false positive is visible and harmless.
fn looks_like_mcp(cmd: &str) -> bool {
    cmd.to_ascii_lowercase().contains("mcp")
}

/// Friendly label for known MCP servers; falls back to the mcp-ish token itself.
fn mcp_label(cmd: &str) -> String {
    let lower = cmd.to_ascii_lowercase();
    const KNOWN: &[(&str, &str)] = &[
        ("chrome-devtools-mcp", "chrome-devtools"),
        ("playwright", "playwright"),
        ("firecrawl", "firecrawl"),
        ("@21st-dev/magic", "21st magic"),
        ("mempalace", "mempalace"),
        ("context7", "context7"),
        ("notebooklm", "notebooklm"),
        ("sentry", "sentry"),
    ];
    for (needle, label) in KNOWN {
        if lower.contains(needle) {
            return (*label).to_string();
        }
    }
    // First whitespace token that mentions mcp, reduced to its file name.
    lower
        .split_whitespace()
        .find(|tok| tok.contains("mcp"))
        .map(|tok| {
            tok.rsplit(['\\', '/'])
                .next()
                .unwrap_or(tok)
                .trim_end_matches(".exe")
                .trim_end_matches(".js")
                .trim_end_matches(".py")
                .to_string()
        })
        .unwrap_or_else(|| "mcp server".to_string())
}

fn clip(s: &str, max_chars: usize) -> String {
    match s.char_indices().nth(max_chars) {
        Some((idx, _)) => format!("{}...", &s[..idx]),
        None => s.to_string(),
    }
}

fn short_reason(stderr: &str, fallback: &str) -> String {
    let line = stderr.lines().find(|l| !l.trim().is_empty()).unwrap_or("");
    if line.trim().is_empty() {
        fallback.to_string()
    } else {
        clip(line.trim(), 160)
    }
}

/* ---- OS probes ----------------------------------------------------------------- */

fn process_table() -> Vec<RawProc> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
    );
    sys.processes()
        .iter()
        .map(|(pid, p)| RawProc {
            pid: pid.as_u32(),
            ppid: p.parent().map(|pp| pp.as_u32()),
            name: p.name().to_string_lossy().to_string(),
            cmd: p
                .cmd()
                .iter()
                .map(|a| a.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" "),
            start_time: p.start_time(),
        })
        .collect()
}

/// Listening TCP sockets as (port, pid). netstat instead of raw iphlpapi bindings:
/// boring, present on every Windows, and trivially parseable.
fn listening_ports() -> Vec<(u16, u32)> {
    match run_capture("netstat", &["-ano", "-p", "TCP"], NETSTAT_TIMEOUT) {
        Ok(out) if out.code == Some(0) => parse_netstat(&out.stdout),
        Ok(out) => {
            tracing::warn!(code = ?out.code, "netstat failed");
            Vec::new()
        }
        Err(e) => {
            tracing::warn!(error = %e, "netstat could not run");
            Vec::new()
        }
    }
}

/// Parse `netstat -ano` output into deduped (port, pid) listener pairs. Kept pure for
/// tests. The LISTENING literal is not localized on the shipped en-US target; the
/// foreign-address 0.0.0.0:0 form is accepted too as a locale-safe fallback.
fn parse_netstat(output: &str) -> Vec<(u16, u32)> {
    let mut seen: HashSet<(u16, u32)> = HashSet::new();
    let mut out: Vec<(u16, u32)> = Vec::new();
    for line in output.lines() {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 5 || !cols[0].eq_ignore_ascii_case("tcp") {
            continue;
        }
        let listening = cols[3].eq_ignore_ascii_case("listening")
            || cols[2] == "0.0.0.0:0"
            || cols[2] == "[::]:0";
        if !listening {
            continue;
        }
        let Some(port) = cols[1].rsplit(':').next().and_then(|p| p.parse::<u16>().ok()) else {
            continue;
        };
        let Ok(pid) = cols[4].parse::<u32>() else {
            continue;
        };
        if seen.insert((port, pid)) {
            out.push((port, pid));
        }
    }
    out
}

fn docker_info() -> DockerInfo {
    let Ok(docker) = which::which("docker") else {
        return DockerInfo {
            status: "notInstalled".to_string(),
            containers: Vec::new(),
        };
    };
    let program = docker.to_string_lossy().to_string();
    match run_capture(&program, &["ps", "--format", "{{json .}}"], DOCKER_TIMEOUT) {
        Ok(out) if out.code == Some(0) => DockerInfo {
            status: "ok".to_string(),
            containers: out.stdout.lines().filter_map(parse_docker_line).collect(),
        },
        Ok(out) => {
            // The classic engine-off messages; anything else is a real error.
            let err = out.stderr.to_ascii_lowercase();
            let engine_off = err.contains("error during connect")
                || err.contains("cannot connect to the docker daemon")
                || err.contains("docker daemon is not running");
            if !engine_off {
                tracing::warn!(stderr = %short_reason(&out.stderr, "?"), "docker ps failed");
            }
            DockerInfo {
                status: if engine_off { "engineOff" } else { "error" }.to_string(),
                containers: Vec::new(),
            }
        }
        Err(e) => {
            tracing::warn!(error = %e, "docker ps could not run");
            DockerInfo {
                status: "error".to_string(),
                containers: Vec::new(),
            }
        }
    }
}

/// One `docker ps --format "{{json .}}"` line -> container row. Pure for tests.
fn parse_docker_line(line: &str) -> Option<ContainerInfo> {
    let v: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    let field = |key: &str| v.get(key).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let id = field("ID");
    if id.is_empty() {
        return None;
    }
    Some(ContainerInfo {
        id,
        name: field("Names"),
        image: field("Image"),
        status: field("Status"),
        ports: field("Ports"),
    })
}

/* ---- process execution --------------------------------------------------------- */

struct Captured {
    code: Option<i32>,
    stdout: String,
    stderr: String,
}

/// Run a short-lived probe with no window, a hard timeout, and captured output.
fn run_capture(program: &str, args: &[&str], timeout: Duration) -> Result<Captured, String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let mut child = cmd.spawn().map_err(|e| format!("{program} spawn failed: {e}"))?;
    let pid = child.id();

    let stdout_pipe = child.stdout.take();
    let out_reader = std::thread::spawn(move || read_all(stdout_pipe));
    let stderr_pipe = child.stderr.take();
    let err_reader = std::thread::spawn(move || read_all(stderr_pipe));

    let started = Instant::now();
    let code = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status.code(),
            Ok(None) => {
                if started.elapsed() >= timeout {
                    kill_tree(Some(pid));
                    let _ = child.wait();
                    return Err(format!("{program} timed out"));
                }
                std::thread::sleep(Duration::from_millis(30));
            }
            Err(e) => return Err(format!("{program} wait failed: {e}")),
        }
    };
    let stdout = out_reader.join().unwrap_or_default();
    let stderr = err_reader.join().unwrap_or_default();
    Ok(Captured { code, stdout, stderr })
}

fn read_all(pipe: Option<impl std::io::Read>) -> String {
    let mut buf = String::new();
    if let Some(mut p) = pipe {
        let _ = p.read_to_string(&mut buf);
    }
    buf
}

/// Kill a process tree and surface the failure reason (unlike the fire-and-forget
/// `pty::kill_tree`, radar kills are user-initiated and deserve a real error).
fn taskkill_tree(pid: u32) -> Result<(), String> {
    let out = run_capture(
        "taskkill",
        &["/T", "/F", "/PID", &pid.to_string()],
        Duration::from_secs(10),
    )?;
    if out.code == Some(0) {
        tracing::info!(pid, "process tree killed from radar");
        Ok(())
    } else {
        tracing::warn!(pid, stderr = %out.stderr, "radar taskkill failed");
        // taskkill reports its reason on stderr ("Access is denied.", "not found").
        Err(short_reason(&out.stderr, "could not stop the process"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(pid: u32, ppid: Option<u32>, name: &str, cmd: &str, start: u64) -> RawProc {
        RawProc {
            pid,
            ppid,
            name: name.to_string(),
            cmd: cmd.to_string(),
            start_time: start,
        }
    }

    #[test]
    fn netstat_parse_keeps_listeners_and_dedupes() {
        let sample = "\nActive Connections\n\n  Proto  Local Address          Foreign Address        State           PID\n  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1234\n  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4242\n  TCP    192.168.1.5:54321      142.250.74.110:443     ESTABLISHED     8888\n  TCP    [::]:135               [::]:0                 LISTENING       1234\n  TCP    [::1]:8080             [::]:0                 LISTENING       9001\n  UDP    0.0.0.0:5050           *:*                                    5555\n";
        let got = parse_netstat(sample);
        assert_eq!(got, vec![(135, 1234), (5173, 4242), (8080, 9001)]);
    }

    #[test]
    fn netstat_parse_survives_garbage() {
        assert!(parse_netstat("").is_empty());
        assert!(parse_netstat("TCP notaport whatever LISTENING xyz").is_empty());
        assert!(parse_netstat("  TCP 0.0.0.0:99999 0.0.0.0:0 LISTENING 1").is_empty());
    }

    #[test]
    fn docker_line_parses_and_rejects_junk() {
        let line = r#"{"ID":"abc123","Names":"web","Image":"nginx:latest","Status":"Up 2 hours","Ports":"0.0.0.0:8080->80/tcp"}"#;
        let c = parse_docker_line(line).expect("parses");
        assert_eq!(c.id, "abc123");
        assert_eq!(c.name, "web");
        assert_eq!(c.image, "nginx:latest");
        assert!(parse_docker_line("not json").is_none());
        assert!(parse_docker_line(r#"{"Names":"no-id"}"#).is_none());
    }

    #[test]
    fn mcp_detection_and_labels() {
        assert!(looks_like_mcp("npx -y chrome-devtools-mcp@latest"));
        assert!(looks_like_mcp("python -m mempalace.mcp_server"));
        assert!(!looks_like_mcp("node C:\\app\\server.js"));
        assert_eq!(mcp_label("npx -y chrome-devtools-mcp@latest"), "chrome-devtools");
        assert_eq!(mcp_label("node x\\firecrawl-mcp\\dist\\index.js"), "firecrawl");
        assert_eq!(mcp_label("node C:\\tools\\my-weird-mcp.js"), "my-weird-mcp");
    }

    #[test]
    fn owner_map_walks_descendants_and_blocks_pid_reuse() {
        // shell(10) -> claude(20) -> node(30); stale ppid: 40 claims parent 10 but
        // started BEFORE it (reused pid), so it must not be attributed.
        let table = vec![
            raw(10, Some(1), "powershell.exe", "", 100),
            raw(20, Some(10), "claude.exe", "claude", 110),
            raw(30, Some(20), "node.exe", "node server.js", 120),
            raw(40, Some(10), "old.exe", "", 50),
        ];
        let owner = session_owner_map(&table, &[("s1".to_string(), 10)]);
        assert_eq!(owner.get(&10).map(String::as_str), Some("s1"));
        assert_eq!(owner.get(&20).map(String::as_str), Some("s1"));
        assert_eq!(owner.get(&30).map(String::as_str), Some("s1"));
        assert!(!owner.contains_key(&40), "pid-reuse ghost must stay out");
    }

    #[test]
    fn snapshot_filters_noise_and_attributes_ports() {
        let table = vec![
            raw(10, Some(1), "powershell.exe", "", 100),
            raw(20, Some(10), "node.exe", "node vite", 110),
            raw(21, Some(10), "conhost.exe", "", 110),
            raw(22, Some(10), "python.exe", "python worker.py", 115),
            raw(50, Some(1), "svchost.exe", "", 10),
            raw(60, Some(1), "python.exe", "python -m http.server", 90),
            raw(70, Some(1), "cmd.exe", "cmd.exe /c npx -y firecrawl-mcp", 95),
            // node child of the firecrawl wrapper: same server, must be collapsed.
            raw(71, Some(70), "node.exe", "node firecrawl-mcp\\dist\\index.js", 96),
            raw(80, Some(1), "node.exe", "npx chrome-devtools-mcp", 30),
            // MCP host inside the session tree, with a child: shown once as MCP,
            // never repeated in the session's process rows.
            raw(90, Some(10), "cmd.exe", "cmd.exe /c npx -y context7-mcp", 112),
            raw(91, Some(90), "node.exe", "node context7-mcp\\index.js", 113),
        ];
        let sessions = vec![("s1".to_string(), 10u32)];
        let docker = DockerInfo { status: "notInstalled".to_string(), containers: Vec::new() };
        let snap = build_snapshot(&table, &sessions, &[(5173, 20), (8000, 60), (445, 50)], docker);

        // Session tree: only the plain worker remains. conhost is plumbing, the shell
        // is the pane, the vite listener lives in the ports rows, and the context7
        // host + its node child live in the MCP rows.
        assert_eq!(snap.sessions.len(), 1);
        let procs: Vec<&str> = snap.sessions[0].procs.iter().map(|p| p.cmd.as_str()).collect();
        assert_eq!(procs, vec!["python worker.py"]);

        // MCP: one row per server (the wrapper's node child is collapsed into it),
        // oldest first so the forgotten one surfaces on top.
        assert_eq!(snap.mcp.len(), 3);
        assert_eq!(snap.mcp[0].label, "chrome-devtools");
        assert_eq!(snap.mcp[0].started_at, 30);
        assert_eq!(snap.mcp[1].label, "firecrawl");
        assert_eq!(snap.mcp[1].pid, 70, "the top-most process represents the server");
        assert_eq!(snap.mcp[1].session_id, None);
        assert_eq!(snap.mcp[2].label, "context7");
        assert_eq!(snap.mcp[2].session_id.as_deref(), Some("s1"));

        // Ports: 5173 attributed to s1, 8000 kept as an outside dev listener,
        // 445 (svchost) filtered as system noise. Sorted by port.
        let got: Vec<(u16, Option<&str>)> = snap
            .ports
            .iter()
            .map(|p| (p.port, p.session_id.as_deref()))
            .collect();
        assert_eq!(got, vec![(5173, Some("s1")), (8000, None)]);
    }

    #[test]
    fn ai_detection_finds_manual_claude_and_clears_on_exit() {
        // shell(10) -> node running claude (20) -> its helper node child (30).
        // Second session (40) runs a plain vite dev server: no AI.
        let table = vec![
            raw(10, Some(1), "powershell.exe", "", 100),
            raw(20, Some(10), "node.exe", r"node C:\Users\x\AppData\npm\claude\cli.js", 110),
            raw(30, Some(20), "node.exe", "node ripgrep-helper", 120),
            raw(40, Some(1), "powershell.exe", "", 100),
            raw(50, Some(40), "node.exe", "node vite", 105),
        ];
        let sessions = vec![("s1".to_string(), 10u32), ("s2".to_string(), 40u32)];
        let got = detect_session_ai(&table, &sessions);
        assert_eq!(got[0].ai.as_deref(), Some("claude"));
        assert_eq!(got[1].ai, None);

        // Claude exited (rows gone): the session must read as a plain shell again.
        let after = vec![
            raw(10, Some(1), "powershell.exe", "", 100),
            raw(40, Some(1), "powershell.exe", "", 100),
            raw(50, Some(40), "node.exe", "node vite", 105),
        ];
        let got = detect_session_ai(&after, &sessions);
        assert_eq!(got[0].ai, None);
    }

    #[test]
    fn ai_detection_matches_exe_names_and_skips_mcp_hosts() {
        let table = vec![
            raw(10, Some(1), "cmd.exe", "", 100),
            raw(20, Some(10), "gemini.exe", "gemini", 110),
            // An MCP host whose path mentions claude must NOT light the claude icon.
            raw(60, Some(1), "powershell.exe", "", 100),
            raw(61, Some(60), "node.exe", r"node C:\x\claude\mcp-server.js", 130),
        ];
        let sessions = vec![("s1".to_string(), 10u32), ("s2".to_string(), 60u32)];
        let got = detect_session_ai(&table, &sessions);
        assert_eq!(got[0].ai.as_deref(), Some("gemini"));
        assert_eq!(got[1].ai, None, "mcp host alone must not count as a running AI");
        assert_eq!(classify_ai("codex.exe", ""), Some("codex".to_string()));
        assert_eq!(classify_ai("node.exe", "node something-else"), None);
    }

    #[test]
    fn kill_guard_reasons_are_typed() {
        // Pure-logic pieces of the guard (the taskkill path needs a live process).
        assert!(clip("abc", 10) == "abc");
        assert_eq!(clip(&"x".repeat(300), 5), "xxxxx...");
        assert_eq!(short_reason("", "fallback"), "fallback");
        assert_eq!(short_reason("\nAccess is denied.\n", "f"), "Access is denied.");
    }

    // Live round-trip against the real OS: bind a socket, then confirm the same
    // probes the app uses (netstat parse + sysinfo table + docker status) see it.
    #[test]
    fn live_probes_see_a_real_listener() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind test socket");
        let port = listener.local_addr().expect("local addr").port();
        let me = std::process::id();

        let ports = listening_ports();
        assert!(
            ports.iter().any(|&(p, pid)| p == port && pid == me),
            "netstat must report the test listener ({port} pid {me})"
        );

        let table = process_table();
        let own = table.iter().find(|p| p.pid == me).expect("process table must contain us");
        assert!(own.start_time > 0, "start_time must be real (age display depends on it)");

        let docker = docker_info();
        assert!(
            ["ok", "notInstalled", "engineOff", "error"].contains(&docker.status.as_str()),
            "docker status must be a known value, got {}",
            docker.status
        );
    }

    #[test]
    fn classifiers_cover_the_expected_names() {
        assert!(is_system_noise("svchost.exe"));
        assert!(!is_system_noise("node.exe"));
        assert!(is_own_surface("warsha.exe"));
        assert!(is_own_surface("msedgewebview2.exe"));
        assert!(is_console_plumbing("OpenConsole.exe"));
        assert!(is_dev_listener("Node.exe"));
        assert!(is_dev_listener("postgres.exe"));
        assert!(!is_dev_listener("explorer.exe"));
    }
}
