// Shared domain types.

export type ShellKind =
  | { kind: "powershell" }
  | { kind: "cmd" }
  | { kind: "wsl" }
  | { kind: "custom"; program: string; args?: string[] };

export type SessionStatus = "idle" | "running" | "exited";

export type ThemeMode = "dark" | "light" | "system";

export const SHELL_LABELS: Record<ShellKind["kind"], string> = {
  powershell: "PowerShell",
  cmd: "Command Prompt",
  wsl: "WSL",
  custom: "Custom",
};
