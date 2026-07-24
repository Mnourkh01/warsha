import { newSession } from "../../actions";
import { getTerminal } from "../terminal/controller";
import { clipboardWriteText, ptyWrite, whichProgram } from "../../lib/ipc";
import { AI_TYPES, SHELL_TYPES, buildShell } from "../../lib/sessionTypes";
import { useRuntime } from "../../store/runtime";
import { useUI } from "../../store/ui";

// One-button handoff: spawn a normal Claude Code terminal session (the user's
// logged-in CLI account, no API key) and paste the generated prompt into it.

/** How long the claude REPL gets to boot before the prompt is typed in. Tuned against
 *  a real spawn on this machine; the clipboard backstop covers slower cold starts. */
export const CLAUDE_READY_DELAY_MS = 2500;
const CHUNK_SIZE = 4096;
const CHUNK_GAP_MS = 10;

export type SendError = "claude-missing" | "workspace-full" | "spawn-failed";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Probe the CLI, copy the prompt to the clipboard (backstop: every failure below
 * degrades to a manual Ctrl+V), spawn the session, close the planner so the user
 * watches the terminal, then paste in the background. Returns null on success.
 */
export async function sendPlanToClaude(prompt: string): Promise<SendError | null> {
  const claude = AI_TYPES.find((a) => a.id === "claude");
  if (!claude) return "spawn-failed";
  const found = await whichProgram(claude.cli).catch(() => null);
  if (!found) return "claude-missing";
  await clipboardWriteText(prompt).catch(() => {});
  const id = newSession({
    shell: buildShell(SHELL_TYPES[0], claude),
    name: claude.label,
    typeId: claude.id,
  });
  if (!id) return "workspace-full";
  useUI.getState().setPlanner(false);
  void pastePromptWhenReady(id, prompt);
  return null;
}

/** Bracketed paste after the REPL boots. Bracketing is what keeps a multiline prompt
 *  as ONE paste instead of submitting at the first newline; newlines become \r to
 *  match what a real terminal paste sends. Deliberately NO trailing Enter: if claude
 *  failed to boot, the paste lands in the surviving PowerShell prompt, and an
 *  auto-submit would EXECUTE the plan text as shell commands. The user presses Enter
 *  once in a focused, visible terminal instead. */
async function pastePromptWhenReady(id: string, prompt: string): Promise<void> {
  await sleep(CLAUDE_READY_DELAY_MS);
  if (useRuntime.getState().status[id] === "exited") {
    // Session died before the paste; the prompt is on the clipboard.
    console.warn(`plan paste skipped: session ${id} exited during claude startup`);
    return;
  }
  const body = prompt
    .replace(/\r\n?/g, "\n")
    // Strip C0 controls (incl. ESC - an embedded end-bracket sequence would close the
    // bracketed paste early) except the newline and tab we intend to send.
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/\n/g, "\r");
  const data = `\u001b[200~${body}\u001b[201~`;
  try {
    let i = 0;
    while (i < data.length) {
      let end = Math.min(i + CHUNK_SIZE, data.length);
      // Never split a surrogate pair across ptyWrite calls: a lone surrogate is not
      // valid UTF-8 and the IPC layer would reject the whole chunk.
      const last = data.charCodeAt(end - 1);
      if (end < data.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
      await ptyWrite(id, data.slice(i, end));
      i = end;
      if (i < data.length) await sleep(CHUNK_GAP_MS);
    }
    // Focus the session so submitting is a single Enter press.
    getTerminal(id)?.focus();
  } catch (err) {
    // The session is visible and the prompt is on the clipboard; the user can paste.
    console.warn(`plan paste failed for session ${id}; prompt stays on the clipboard`, err);
  }
}
