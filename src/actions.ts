// High-level orchestration over the workspace store + terminal registry + runtime status.

import { useWorkspaces } from "./store/workspaces";
import { useSettings, resolveTerminalTheme } from "./store/settings";
import { useRuntime } from "./store/runtime";
import { useTemplates } from "./store/templates";
import { usePlans } from "./store/plans";
import { useUI } from "./store/ui";
import { applySettingsToAll, disposeTerminal, getTerminal } from "./features/terminal/controller";
import { resolveTheme } from "./lib/theme";
import { ptyWrite } from "./lib/ipc";
import { SHELL_LABELS, type ShellKind } from "./lib/types";
import { autoTint } from "./lib/tints";

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
}): string | null {
  const settings = useSettings.getState();
  const ws = useWorkspaces.getState();
  const shell = spec.shell ?? settings.defaultShell;
  // Folder priority: explicit choice, then the workspace's project folder, then the
  // global default. This is what makes "workspace = project" actually hold.
  const wsId = spec.workspaceId ?? ws.activeWorkspaceId;
  const target = ws.workspaces.find((w) => w.id === wsId);
  const wsCwd = target?.defaultCwd;
  // Every new session starts with its own color (first one its workspace is not using),
  // so panes and sidebar rows are tellable-apart without manual cycling.
  const siblingIds = target?.sessionIds ?? [];
  const tint = autoTint(
    siblingIds.map((sid) => ws.sessions[sid]?.tint),
    siblingIds.length,
  );
  const id = ws.addSession(
    {
      shell,
      name: spec.name ?? shellDefaultName(shell),
      cwd: spec.cwd ?? wsCwd ?? settings.defaultCwd,
      typeId: spec.typeId,
      tint,
    },
    spec.workspaceId,
  );
  if (!id) return null; // workspace is full
  // A leftover maximized pane would render alone and keep the new session invisible
  // (its TerminalView never mounts, so the shell never even spawns).
  useUI.getState().setMaximized(null);
  useRuntime.getState().setStatus(id, "running");
  return id;
}

/** Focus a session, switching to its workspace if needed. */
export function openSession(id: string): void {
  const ui = useUI.getState();
  // Opening a session must actually show it: a stale maximized OTHER pane would keep
  // the clicked session hidden behind it.
  if (ui.maximizedSessionId && ui.maximizedSessionId !== id) ui.setMaximized(null);
  useWorkspaces.getState().setActiveSession(id);
  useRuntime.getState().clearAttention(id);
  queueMicrotask(() => getTerminal(id)?.focus());
}

/** Stop a session: remove it from its workspace and kill the PTY. */
export function closeSession(id: string): void {
  const ui = useUI.getState();
  if (ui.maximizedSessionId === id) ui.setMaximized(null);
  useWorkspaces.getState().removeSession(id);
  void disposeTerminal(id);
  useRuntime.getState().clearStatus(id);
}

/** Restart a session in place (dispose + remount its TerminalView via an epoch bump).
 *  Awaits the kill so the respawn under the SAME id cannot race the old PTY teardown. */
export async function restartSession(id: string): Promise<void> {
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
 * Point a session at a new folder WITHOUT restarting it: types a `cd` into the running
 * shell (scrollback and any running program survive); the stored cwd is updated too, so a
 * later restart also lands in the new folder. A `cd` typed while a foreground program
 * (e.g. an interactive CLI) is running goes to that program, not the shell - the user
 * quits it first, same as typing `cd` by hand.
 */
export function changeSessionFolder(id: string, cwd: string): void {
  const ws = useWorkspaces.getState();
  const session = ws.sessions[id];
  if (!session) return;
  ws.setSessionCwd(id, cwd);
  if (getTerminal(id)) void ptyWrite(id, cdCommand(session.shell, cwd)).catch(() => {});
}

export function newWorkspace(): string {
  const ui = useUI.getState();
  ui.setBroadcast(false);
  // Same rule as switchWorkspace: the planner was a view of the workspace being left.
  ui.setPlanner(false);
  return useWorkspaces.getState().addWorkspace();
}

/** Open a template as a NEW workspace: create it, restore its project folder, spawn
 *  every saved session. Returns the new workspace id, or null for an unknown template. */
export function openTemplate(templateId: string): string | null {
  const tpl = useTemplates.getState().templates.find((t) => t.id === templateId);
  if (!tpl) return null;
  useUI.getState().setBroadcast(false);
  useUI.getState().setPlanner(false);
  const ws = useWorkspaces.getState();
  const wsId = ws.addWorkspace(tpl.name);
  if (tpl.defaultCwd) ws.setWorkspaceCwd(wsId, tpl.defaultCwd);
  for (const spec of tpl.sessions) {
    newSession({ ...spec, workspaceId: wsId });
  }
  return wsId;
}

export function switchWorkspace(id: string): void {
  if (useWorkspaces.getState().activeWorkspaceId !== id) {
    const ui = useUI.getState();
    // Broadcast never follows a workspace change: typing into shells the user is no
    // longer looking at is exactly the accident the auto-off prevents.
    ui.setBroadcast(false);
    // Maximize is a view of the CURRENT grid; carrying it across a switch surprises the
    // user with a lone full-screen pane when they come back.
    ui.setMaximized(null);
    // Same rule for the planner: it is a view of the workspace being left.
    ui.setPlanner(false);
  }
  useWorkspaces.getState().setActiveWorkspace(id);
}

/** Open the plan canvas for a workspace (the active one by default). */
export function openPlanner(workspaceId?: string): void {
  if (workspaceId) switchWorkspace(workspaceId);
  useUI.getState().setPlanner(true);
}

export function deleteWorkspace(id: string): void {
  const wasActive = useWorkspaces.getState().activeWorkspaceId === id;
  const removed = useWorkspaces.getState().removeWorkspace(id);
  usePlans.getState().removePlanFor(id);
  const runtime = useRuntime.getState();
  const ui = useUI.getState();
  if (wasActive) {
    ui.setBroadcast(false);
    // The planner shown was this workspace's plan; falling through to another
    // workspace's plan unasked would be surprising.
    ui.setPlanner(false);
  }
  for (const sid of removed) {
    if (ui.maximizedSessionId === sid) ui.setMaximized(null);
    void disposeTerminal(sid);
    runtime.clearStatus(sid);
  }
}

/** Step the terminal font size and push it to every live terminal. */
export function bumpFontSize(delta: number): void {
  const settings = useSettings.getState();
  settings.setFontSize(settings.fontSize + delta);
  applySettingsToAll({ fontSize: useSettings.getState().fontSize });
}
