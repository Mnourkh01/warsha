// High-level orchestration over the workspace store + terminal registry + runtime status.

import { useWorkspaces } from "./store/workspaces";
import { useSettings, resolveTerminalTheme } from "./store/settings";
import { useRuntime } from "./store/runtime";
import { useChat } from "./store/chat";
import { useUI } from "./store/ui";
import { applySettingsToAll, disposeTerminal, getTerminal } from "./features/terminal/controller";
import { resolveTheme } from "./lib/theme";
import { agentCancel } from "./lib/ipc";
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
  const shell = spec.shell ?? settings.defaultShell;
  const id = useWorkspaces.getState().addSession(
    {
      shell,
      name: spec.name ?? shellDefaultName(shell),
      cwd: spec.cwd ?? settings.defaultCwd,
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
