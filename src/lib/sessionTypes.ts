import type { ShellKind } from "./types";

// Catalog for the new-session picker: shells + AI CLIs. AI entries run their command
// inside a shell (initCommand) and carry a `probe`/`install` so we can show the install
// command when the CLI is not on PATH.
export interface SessionType {
  id: string;
  label: string;
  group: "shell" | "ai";
  shell: ShellKind;
  initCommand?: string;
  probe?: string;
  install?: string;
  accent?: string;
  badge?: string;
}

export const SESSION_TYPES: SessionType[] = [
  { id: "powershell", label: "PowerShell", group: "shell", shell: { kind: "powershell" } },
  { id: "cmd", label: "Command Prompt", group: "shell", shell: { kind: "cmd" } },
  { id: "wsl", label: "WSL", group: "shell", shell: { kind: "wsl" }, probe: "wsl.exe" },
  {
    id: "bash",
    label: "Bash",
    group: "shell",
    shell: { kind: "custom", program: "bash.exe" },
    probe: "bash.exe",
    install: "Install Git for Windows (git-scm.com) or enable WSL to get bash.",
  },
  {
    id: "claude",
    label: "Claude Code",
    group: "ai",
    shell: { kind: "powershell" },
    initCommand: "claude",
    probe: "claude",
    install: "npm install -g @anthropic-ai/claude-code",
    accent: "#c98a5b",
    badge: "C",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    group: "ai",
    shell: { kind: "powershell" },
    initCommand: "gemini",
    probe: "gemini",
    install: "npm install -g @google/gemini-cli",
    accent: "#6a8bef",
    badge: "G",
  },
  {
    id: "codex",
    label: "Codex",
    group: "ai",
    shell: { kind: "powershell" },
    initCommand: "codex",
    probe: "codex",
    install: "npm install -g @openai/codex",
    accent: "#4fb59a",
    badge: "X",
  },
];
