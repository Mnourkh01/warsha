// High-level orchestration over the workspace store + terminal registry + runtime status.

import { useWorkspaces } from "./store/workspaces";
import { useSettings, resolveTerminalTheme } from "./store/settings";
import { useRuntime } from "./store/runtime";
import { useChat } from "./store/chat";
import { useUI } from "./store/ui";
import { applySettingsToAll, disposeTerminal, getTerminal } from "./features/terminal/controller";
import { resolveTheme } from "./lib/theme";
import { agentCancel, ptyWrite } from "./lib/ipc";
import { SHELL_LABELS, type ShellKind } from "./lib/types";

export function shellDefaultName(shell: ShellKind): string {
  if (shell.kind === "custom") {
    const base = shell.program.split(/[\\/]/).pop() || shell.program;
    return base.replace(/\.exe$/i, "");
  }
  return SHELL_LABELS[shell.kind];
}

/** Terminal color scheme (independent of the app chrome theme). */
export function termScheme(): "dark" | "light" {
  const s = useSettings.getState();
  return resolveTerminalTheme(s.terminalTheme, resolveTheme(s.theme));
}

/**
 * Create a session in a workspace (active by default). The grid renders it and its
 * TerminalView spawns the shell. Returns the id, or null if the workspace is full (6).
 */
export function newSession(spec: {
  shell?: ShellKind;
  name?: string;
  cwd?: string;
  typeId?: string;
  workspaceId?: string;
  agent?: "claude" | "gemini";
}): string | null {
  const settings = useSettings.getState();
  const ws = useWorkspaces.getState();
  const shell = spec.shell ?? settings.defaultShell;
  // Folder priority: explicit choice, then the workspace's project folder, then the
  // global default. This is what makes "workspace = project" actually hold.
  const wsId = spec.workspaceId ?? ws.activeWorkspaceId;
  const wsCwd = ws.workspaces.find((w) => w.id === wsId)?.defaultCwd;
  const id = ws.addSession(
    {
      shell,
      name: spec.name ?? shellDefaultName(shell),
      cwd: spec.cwd ?? wsCwd ?? settings.defaultCwd,
      typeId: spec.typeId,
      agent: spec.agent,
    },
    spec.workspaceId,
  );
  if (!id) return null; // workspace is full
  // Chat panes have no PTY; they idle until a message is in flight.
  useRuntime.getState().setStatus(id, spec.agent ? "idle" : "running");
  return id;
}

/** Focus a session, switching to its workspace if needed. */
export function openSession(id: string): void {
  useWorkspaces.getState().setActiveSession(id);
  useRuntime.getState().clearAttention(id);
  queueMicrotask(() => getTerminal(id)?.focus());
}

/** Stop a session: remove it from its workspace and kill the PTY (or chat request). */
export function closeSession(id: string): void {
  const ui = useUI.getState();
  const isChat = Boolean(useWorkspaces.getState().sessions[id]?.agent);
  if (ui.maximizedSessionId === id) ui.setMaximized(null);
  useWorkspaces.getState().removeSession(id);
  if (isChat) {
    void agentCancel(id).catch(() => {});
    useChat.getState().clear(id);
  } else {
    void disposeTerminal(id);
  }
  useRuntime.getState().clearStatus(id);
}

/** Restart a session in place (dispose + remount its TerminalView via an epoch bump).
 *  Awaits the kill so the respawn under the SAME id cannot race the old PTY teardown.
 *  For a chat session, restart means: stop the in-flight request, clear the transcript. */
export async function restartSession(id: string): Promise<void> {
  if (useWorkspaces.getState().sessions[id]?.agent) {
    await agentCancel(id).catch(() => {});
    useChat.getState().clear(id);
    useRuntime.getState().setStatus(id, "idle");
    useRuntime.getState().clearAttention(id);
    return;
  }
  await disposeTerminal(id);
  useRuntime.getState().setStatus(id, "running");
  useRuntime.getState().clearAttention(id);
  useRuntime.getState().bumpEpoch(id);
}

/** Windows path -> WSL mount path (C:\a\b -> /mnt/c/a/b). */
function toWslPath(p: string): string {
  const m = /^([A-Za-z]):[\\/]?(.*)$/.exec(p);
  if (!m) return p.replace(/\\/g, "/");
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
}

/** The line that changes directory in a live shell of this kind, terminated with Enter. */
function cdCommand(shell: ShellKind, path: string): string {
  switch (shell.kind) {
    case "powershell":
      // Single-quoted + doubled quotes so spaces and quotes in the path are literal.
      return `Set-Location -LiteralPath '${path.replace(/'/g, "''")}'\r`;
    case "cmd":
      // /d also switches drive; quotes cover spaces.
      return `cd /d "${path}"\r`;
    case "wsl":
      return `cd "${toWslPath(path)}"\r`;
    default:
      // Best-effort POSIX cd for an unknown custom shell (e.g. Git Bash). Backslashes stay
      // literal inside double quotes in a POSIX shell, so a Windows `C:\a\b` cd fails there;
      // forward-slash it. Git Bash accepts `cd "C:/a/b"` and cd is drive-aware.
      return `cd "${path.replace(/\\/g, "/")}"\r`;
  }
}

/**
 * Point a session at a new folder WITHOUT restarting it. For a terminal session this
 * types a `cd` into the running shell (scrollback and any running program survive); the
 * stored cwd is updated too, so a later restart also lands in the new folder. For a chat
 * session there is no PTY, so only the stored cwd changes and the next message runs there.
 * A `cd` typed while a foreground program (e.g. an interactive CLI) is running goes to that
 * program, not the shell - the user quits it first, same as typing `cd` by hand.
 */
export function changeSessionFolder(id: string, cwd: string): void {
  const ws = useWorkspaces.getState();
  const session = ws.sessions[id];
  if (!session) return;
  ws.setSessionCwd(id, cwd);
  if (session.agent) return; // chat pane: next request uses the new cwd
  if (getTerminal(id)) void ptyWrite(id, cdCommand(session.shell, cwd)).catch(() => {});
}

export function newWorkspace(): string {
  return useWorkspaces.getState().addWorkspace();
}

export function switchWorkspace(id: string): void {
  useWorkspaces.getState().setActiveWorkspace(id);
}

export function deleteWorkspace(id: string): void {
  const state = useWorkspaces.getState();
  const chatIds = new Set(
    state.workspaces
      .find((w) => w.id === id)
      ?.sessionIds.filter((sid) => state.sessions[sid]?.agent) ?? [],
  );
  const removed = state.removeWorkspace(id);
  const runtime = useRuntime.getState();
  const ui = useUI.getState();
  for (const sid of removed) {
    if (ui.maximizedSessionId === sid) ui.setMaximized(null);
    if (chatIds.has(sid)) {
      void agentCancel(sid).catch(() => {});
      useChat.getState().clear(sid);
    } else {
      void disposeTerminal(sid);
    }
    runtime.clearStatus(sid);
  }
}

/** Step the terminal font size and push it to every live terminal. */
export function bumpFontSize(delta: number): void {
  const settings = useSettings.getState();
  settings.setFontSize(settings.fontSize + delta);
  applySettingsToAll({ fontSize: useSettings.getState().fontSize });
}
