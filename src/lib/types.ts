// Shared domain types for the session tree, shells, and pane layout.

export type ShellKind =
  | { kind: "powershell" }
  | { kind: "cmd" }
  | { kind: "wsl" }
  | { kind: "custom"; program: string; args?: string[] };

export type NodeId = string;

export interface GroupNode {
  id: NodeId;
  type: "group";
  name: string;
  parentId: NodeId | null;
  children: NodeId[];
  collapsed?: boolean;
}

export interface SessionNode {
  id: NodeId;
  type: "session";
  name: string;
  parentId: NodeId | null;
  shell: ShellKind;
  cwd?: string;
  /** A command auto-run once after the shell starts (e.g. launch an AI CLI). */
  initCommand?: string;
  /** Which SESSION_TYPES entry this came from - drives the icon (brand logo for AI). */
  typeId?: string;
}

export type TreeNode = GroupNode | SessionNode;

export type SessionStatus = "idle" | "running" | "exited";

// A pane in the tiled workspace is a binary split tree of leaves.
export type PaneNode =
  | { type: "leaf"; id: string; sessionId: NodeId | null }
  | { type: "split"; id: string; dir: "row" | "col"; a: PaneNode; b: PaneNode };

export type ThemeMode = "dark" | "light" | "system";

export const SHELL_LABELS: Record<ShellKind["kind"], string> = {
  powershell: "PowerShell",
  cmd: "Command Prompt",
  wsl: "WSL",
  custom: "Custom",
};
