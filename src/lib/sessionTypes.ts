import type { ShellKind } from "./types";

// Catalog for the new-session picker: shells + AI CLIs. AI entries launch their CLI
// deterministically via `powershell -NoLogo -NoExit -Command <cli>` (runs at startup in
// the pane's working dir, then keeps the shell alive when the CLI exits) - far more
// reliable than typing the command after a delay. `probe`/`install` let us show the
// install command when the CLI is not on PATH.
export interface SessionType {
  id: string;
  label: string;
  group: "shell" | "ai";
  shell: ShellKind;
  probe?: string;
  install?: string;
}

function aiShell(cli: string): ShellKind {
  return { kind: "custom", program: "powershell.exe", args: ["-NoLogo", "-NoExit", "-Command", cli] };
}

export const SESSION_TYPES: SessionType[] = [
  { id: "powershell", label: "PowerShell", group: "shell", shell: { kind: "powershell" } },
  { id: "cmd", label: "Command Prompt", group: "shell", shell: { kind: "cmd" } },
  { id: "wsl", label: "WSL", group: "shell", shell: { kind: "wsl" }, probe: "wsl.exe" },
  {
    id: "bash",
    label: "Bash",
    group: "shell",
    shell: { kind: "custom", program: "bash.exe", args: ["-i", "-l"] },
    probe: "bash.exe",
    install: "Install Git for Windows (git-scm.com) or enable WSL to get bash.",
  },
  {
    id: "claude",
    label: "Claude Code",
    group: "ai",
    shell: aiShell("claude"),
    probe: "claude",
    install: "npm install -g @anthropic-ai/claude-code",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    group: "ai",
    shell: aiShell("gemini"),
    probe: "gemini",
    install: "npm install -g @google/gemini-cli",
  },
  {
    id: "codex",
    label: "Codex",
    group: "ai",
    shell: aiShell("codex"),
    probe: "codex",
    install: "npm install -g @openai/codex",
  },
];
