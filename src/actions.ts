// High-level orchestration: the only place that composes tree + layout + runtime stores
// with the terminal registry. UI calls these; stores stay pure.

import { useTree } from "./store/tree";
import { useLayout } from "./store/layout";
import { useSettings } from "./store/settings";
import { useRuntime } from "./store/runtime";
import {
  ensureTerminal,
  disposeTerminal,
  getTerminal,
} from "./features/terminal/controller";
import { resolveTheme } from "./lib/theme";
import { SHELL_LABELS, type NodeId, type ShellKind } from "./lib/types";

export function shellDefaultName(shell: ShellKind): string {
  if (shell.kind === "custom") {
    const base = shell.program.split(/[\\/]/).pop() || shell.program;
    return base.replace(/\.exe$/i, "");
  }
  return SHELL_LABELS[shell.kind];
}

/**
 * Open a session. If it is already visible, focus it. Otherwise place it in an empty pane
 * (the active one if empty, else any empty pane); if there is no empty pane, split the
 * active pane so the new session tiles alongside instead of replacing anything.
 */
export function openSession(sessionId: NodeId): void {
  const node = useTree.getState().nodes[sessionId];
  if (!node || node.type !== "session") return;

  const layout = useLayout.getState();
  const existing = layout.paneIdWithSession(sessionId);
  if (existing) {
    layout.focusPane(existing);
    getTerminal(sessionId)?.focus();
    return;
  }

  const target = layout.firstEmptyPaneId() ?? layout.splitPane(layout.activePaneId, "row");
  if (target) openSessionInPane(sessionId, target);
}

/** Open (or move) a session into a specific pane. Used by tree click and drag-to-pane. */
export function openSessionInPane(sessionId: NodeId, paneId: string): void {
  const node = useTree.getState().nodes[sessionId];
  if (!node || node.type !== "session") return;
  const settings = useSettings.getState();
  ensureTerminal(sessionId, {
    shell: node.shell,
    cwd: node.cwd,
    fontSize: settings.fontSize,
    theme: resolveTheme(settings.theme),
    foreground: settings.termForeground,
    bold: settings.termBold,
    initCommand: node.initCommand,
  });
  useRuntime.getState().setStatus(sessionId, "running");
  useLayout.getState().assignSession(paneId, sessionId);
  useLayout.getState().focusPane(paneId);
  getTerminal(sessionId)?.focus();
}

/** Create a new session node and open it. */
export interface NewSessionOpts {
  parentId?: NodeId | null;
  shell?: ShellKind;
  name?: string;
  cwd?: string;
  initCommand?: string;
  typeId?: string;
}

export function newSession(opts: NewSessionOpts = {}): NodeId {
  const settings = useSettings.getState();
  const sh = opts.shell ?? settings.defaultShell;
  const id = useTree
    .getState()
    .addSession(
      opts.parentId ?? null,
      sh,
      opts.name ?? shellDefaultName(sh),
      opts.cwd ?? settings.defaultCwd,
      opts.initCommand,
      opts.typeId,
    );
  openSession(id);
  return id;
}

/** Stop a session: remove from its pane and kill the PTY. The tree node stays. */
export function closeSession(sessionId: NodeId): void {
  useLayout.getState().clearSession(sessionId);
  disposeTerminal(sessionId);
  useRuntime.getState().clearStatus(sessionId);
}

/** Restart a running session in the same pane. */
export function restartSession(sessionId: NodeId): void {
  const layout = useLayout.getState();
  const pane = layout.paneIdWithSession(sessionId);
  disposeTerminal(sessionId);
  useRuntime.getState().clearStatus(sessionId);
  if (pane) {
    layout.assignSession(pane, null);
    queueMicrotask(() => openSessionInPane(sessionId, pane));
  }
}

/** Close a pane; kill whatever session it held. */
export function closePaneAction(paneId: string): void {
  const held = useLayout.getState().closePane(paneId);
  if (held) {
    disposeTerminal(held);
    useRuntime.getState().clearStatus(held);
  }
}

export function splitActivePane(dir: "row" | "col"): void {
  const layout = useLayout.getState();
  layout.splitPane(layout.activePaneId, dir);
}

/** Delete a tree node (and descendants); clean up any open sessions. */
export function deleteNode(id: NodeId): void {
  const removed = useTree.getState().remove(id);
  const layout = useLayout.getState();
  const runtime = useRuntime.getState();
  for (const sid of removed) {
    layout.clearSession(sid);
    disposeTerminal(sid);
    runtime.clearStatus(sid);
  }
}
