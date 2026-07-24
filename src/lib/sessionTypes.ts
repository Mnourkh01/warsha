import type { ShellKind } from "./types";

// Catalogs for the new-session wizard: pick a SHELL, optionally an AI CLI to launch
// inside it, then a folder. buildShell() is the matrix that combines the two - every
// variant keeps the shell alive after the CLI exits, exactly like typing the command
// yourself in that shell.

export interface ShellType {
  id: "powershell" | "cmd" | "wsl" | "bash" | "ssh";
  label: string;
  shell: ShellKind;
  /** Program to check on PATH before offering the shell (absent = always available). */
  probe?: string;
  install?: string;
  /** Remote session: the wizard asks for a target instead of AI + folder, and the
   *  settings default-shell dropdown skips it (a default needs no per-use input). */
  remote?: true;
}

export interface AiType {
  id: "claude" | "gemini" | "codex";
  label: string;
  /** CLI command name; also the PATH probe on Windows-side shells. */
  cli: string;
  install: string;
}

export const SHELL_TYPES: ShellType[] = [
  { id: "powershell", label: "PowerShell", shell: { kind: "powershell" } },
  { id: "cmd", label: "Command Prompt", shell: { kind: "cmd" } },
  { id: "wsl", label: "WSL", shell: { kind: "wsl" }, probe: "wsl.exe" },
  {
    id: "bash",
    label: "Bash",
    shell: { kind: "custom", program: "bash.exe", args: ["-i", "-l"] },
    probe: "bash.exe",
    install: "Install Git for Windows (git-scm.com) or enable WSL to get bash.",
  },
  {
    id: "ssh",
    label: "SSH",
    // Placeholder shell; the real one comes from buildSshShell(target) in the wizard.
    shell: { kind: "custom", program: "ssh.exe" },
    probe: "ssh.exe",
    install: "Enable the OpenSSH Client optional feature (Settings > System > Optional features).",
    remote: true,
  },
];

export const AI_TYPES: AiType[] = [
  {
    id: "claude",
    label: "Claude Code",
    cli: "claude",
    install: "npm install -g @anthropic-ai/claude-code",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    cli: "gemini",
    install: "npm install -g @google/gemini-cli",
  },
  {
    id: "codex",
    label: "Codex",
    cli: "codex",
    install: "npm install -g @openai/codex",
  },
];

/** Conservative `user@host[:port]` parser for the SSH wizard step. One plain token:
 *  no spaces, no leading dash (it would parse as an ssh OPTION), no shell metachars -
 *  the target goes into a spawn args array, so this is defense in depth, not escaping. */
export function parseSshTarget(input: string): { target: string; port?: number } | null {
  const m = /^([\w.-]+@)?([\w][\w.-]*)(?::(\d{1,5}))?$/.exec(input.trim());
  if (!m) return null;
  const port = m[3] ? Number(m[3]) : undefined;
  if (port !== undefined && (port < 1 || port > 65535)) return null;
  return { target: `${m[1] ?? ""}${m[2]}`, port };
}

/** The ShellKind that connects to an SSH target, or null for an invalid target.
 *  Uses the Windows OpenSSH client, so the user's ~/.ssh config and keys apply. */
export function buildSshShell(input: string): ShellKind | null {
  const parsed = parseSshTarget(input);
  if (!parsed) return null;
  const args = parsed.port ? ["-p", String(parsed.port), parsed.target] : [parsed.target];
  return { kind: "custom", program: "ssh.exe", args };
}

/** The ShellKind that launches `ai` inside `shellType` (plain shell when ai is null). */
export function buildShell(shellType: ShellType, ai: AiType | null): ShellKind {
  if (!ai || shellType.remote) return shellType.shell;
  switch (shellType.id) {
    case "ssh": // unreachable (remote), kept for switch exhaustiveness
      return shellType.shell;
    case "powershell":
      // Runs the CLI at startup in the pane's cwd, keeps the shell alive when it exits.
      return {
        kind: "custom",
        program: "powershell.exe",
        args: ["-NoLogo", "-NoExit", "-Command", ai.cli],
      };
    case "cmd":
      return { kind: "custom", program: "cmd.exe", args: ["/K", ai.cli] };
    case "wsl":
      // `--` stops wsl.exe flag parsing; -lic gets login PATH (nvm installs); exec keeps
      // an interactive bash after the CLI exits. The CLI must be installed INSIDE WSL -
      // if missing, bash prints command-not-found and the shell stays usable.
      return {
        kind: "custom",
        program: "wsl.exe",
        args: ["--", "bash", "-lic", `${ai.cli}; exec bash`],
      };
    case "bash":
      return {
        kind: "custom",
        program: "bash.exe",
        args: ["-l", "-i", "-c", `${ai.cli}; exec bash -l -i`],
      };
  }
}

/** Display label for the session: the AI name when one was picked, else the shell name. */
export function sessionLabel(shellType: ShellType, ai: AiType | null): string {
  return ai ? ai.label : shellType.label;
}

/** Map a stored default-shell ShellKind back to its wizard ShellType (for preselects and
 *  the settings dropdown). Unknown custom shells fall back to PowerShell. */
export function shellTypeOf(shell: ShellKind): ShellType {
  const match = SHELL_TYPES.find((s) =>
    s.shell.kind === "custom" && shell.kind === "custom"
      ? s.shell.program === shell.program
      : s.shell.kind === shell.kind,
  );
  return match ?? SHELL_TYPES[0];
}
