// Typed bridge over Tauri commands + events. Nothing else in the app calls `invoke`
// or `listen` directly - all IPC goes through here so the surface stays one file.

import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { CloseRequestedEvent } from "@tauri-apps/api/window";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl, revealItemInDir } from "@tauri-apps/plugin-opener";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import type { ShellKind } from "./types";

export interface SpawnOpts {
  id: string;
  shell: ShellKind;
  cwd?: string;
  cols: number;
  rows: number;
}

// The Rust reader thread sends raw bytes (InvokeResponseBody::Raw). Depending on the
// transport that arrives as an ArrayBuffer, a typed array, or a number[]; normalize.
function toBytes(msg: unknown): Uint8Array {
  if (msg instanceof ArrayBuffer) return new Uint8Array(msg);
  if (msg instanceof Uint8Array) return msg;
  if (ArrayBuffer.isView(msg)) {
    const v = msg as ArrayBufferView;
    return new Uint8Array(v.buffer as ArrayBuffer, v.byteOffset, v.byteLength);
  }
  if (Array.isArray(msg)) return Uint8Array.from(msg as number[]);
  return new Uint8Array(0);
}

/** Spawn a PTY. `onData` receives raw output bytes; feed them straight to xterm.write. */
export async function ptySpawn(
  opts: SpawnOpts,
  onData: (bytes: Uint8Array) => void,
): Promise<void> {
  const channel = new Channel<unknown>();
  channel.onmessage = (msg) => onData(toBytes(msg));
  await invoke("pty_spawn", { opts, onData: channel });
}

export async function ptyWrite(id: string, data: string): Promise<void> {
  await invoke("pty_write", { id, data });
}

export async function ptyResize(id: string, cols: number, rows: number): Promise<void> {
  await invoke("pty_resize", { id, cols, rows });
}

export async function ptyKill(id: string): Promise<void> {
  await invoke("pty_kill", { id });
}

/** Subscribe to session-exit notifications (id + process exit code). */
export function onPtyExit(cb: (id: string, code: number) => void): Promise<UnlistenFn> {
  return listen<{ id: string; code: number }>("pty://exit", (e) =>
    cb(e.payload.id, e.payload.code),
  );
}

/** Full path of a program if it is on PATH, else null. */
export async function whichProgram(program: string): Promise<string | null> {
  return (await invoke<string | null>("which_program", { program })) ?? null;
}

export interface HeadlessResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
}

/** Run an allowlisted CLI (claude) once with piped stdio: `stdin` carries the payload,
 *  stdout comes back when the process exits. Plain pipes, not a PTY, so the CLI stays
 *  in clean non-interactive mode. */
export async function runHeadless(
  program: string,
  args: string[],
  stdin: string,
  timeoutMs?: number,
): Promise<HeadlessResult> {
  return await invoke<HeadlessResult>("run_headless", { program, args, stdin, timeoutMs });
}

/** Mirror the plan's markdown to `<dir>/.warsha/plan.md` (atomic write in Rust) so
 *  any AI CLI working in that folder can read the current plan. Returns the full
 *  path of the written file. */
export async function planFileSave(dir: string, markdown: string): Promise<string> {
  return await invoke<string>("plan_file_save", { dir, markdown });
}

/** Contents of `<dir>/.warsha/plan.draft.json` (a whole-plan JSON written by an AI
 *  CLI), or null when no draft is waiting. Safe to poll - a missing folder is null. */
export async function planDraftRead(dir: string): Promise<string | null> {
  return (await invoke<string | null>("plan_draft_read", { dir })) ?? null;
}

/** Mark the draft as loaded (renames it to plan.draft.applied.json). */
export async function planDraftConsume(dir: string): Promise<void> {
  await invoke("plan_draft_consume", { dir });
}

/** Drop the draft-format spec at `<dir>/.warsha/BLUEPRINT.md` so AIs without a skill
 *  system (codex, gemini) can learn the contract the ask-for-a-plan prompt cites. */
export async function planSpecSave(dir: string, spec: string): Promise<void> {
  await invoke("plan_spec_save", { dir, spec });
}

export interface ShellCheckResult {
  ok: boolean;
  /** Short reason when not ok (trimmed program output). */
  detail?: string;
}

/** Deep availability check for launchers that exist even when broken: WSL without a
 *  Linux distribution, a bash.exe stub without a real bash. Can take a few seconds. */
export async function checkShell(kind: "wsl" | "bash"): Promise<ShellCheckResult> {
  return await invoke<ShellCheckResult>("shell_check", { kind });
}

/** Native folder picker. Returns the chosen absolute path, or null if cancelled. */
export async function pickFolder(title?: string): Promise<string | null> {
  const res = await openDialog({ directory: true, multiple: false, title });
  return typeof res === "string" ? res : null;
}

export interface FileDropEvent {
  kind: "enter" | "over" | "drop" | "leave";
  /** Absolute paths being dropped (present on enter/drop). */
  paths: string[];
  /** Cursor position in PHYSICAL pixels (divide by devicePixelRatio for CSS coords). */
  position: { x: number; y: number };
}

/** OS file drag-and-drop onto the window. Tauri intercepts native file drops (the WebView
 *  never sees an HTML5 `drop` for real files), so this event is the only way to get them.
 *  `async` on purpose: outside Tauri getCurrentWebview() THROWS synchronously, and the
 *  async wrapper turns that into a rejection callers can absorb (a throw inside a React
 *  effect would unmount the whole app). */
export async function onWebviewFileDrop(handler: (e: FileDropEvent) => void): Promise<UnlistenFn> {
  return getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload as {
      type: FileDropEvent["kind"];
      paths?: string[];
      position?: { x: number; y: number };
    };
    handler({
      kind: p.type,
      paths: p.paths ?? [],
      position: p.position ?? { x: 0, y: 0 },
    });
  });
}

/** Native yes/no confirmation. Returns true when the user confirms. */
export async function confirmDialog(message: string, title?: string): Promise<boolean> {
  return ask(message, { title, kind: "warning" });
}

export async function loadState<T>(): Promise<T | null> {
  return (await invoke<T | null>("session_state_load")) ?? null;
}

export async function saveState(state: unknown): Promise<void> {
  await invoke("session_state_save", { state });
}

/** Back up the current state file as state.<label>.bak.json (label sanitized in Rust). */
export async function sessionStateBackup(label: string): Promise<void> {
  await invoke("session_state_backup", { label });
}

/** Read the OS clipboard as text. Goes through the Rust clipboard plugin, not the
 *  WebView `navigator.clipboard` (which WebView2 blocks on read without a prompt UI).
 *  Returns "" when the clipboard holds no text. */
export async function clipboardReadText(): Promise<string> {
  try {
    return (await readText()) ?? "";
  } catch {
    // Clipboard held a non-text payload (e.g. an image), or is empty. Not an error.
    return "";
  }
}

/** Write text to the OS clipboard through the Rust clipboard plugin. */
export async function clipboardWriteText(text: string): Promise<void> {
  await writeText(text);
}

/** Open a link in the SYSTEM browser, never inside the WebView. Terminal output is
 *  untrusted, so only http/https ever leaves the app. */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  await openUrl(url);
}

/** Show a local path in Explorer (select the item in its folder). Deliberately NEVER
 *  opens the file with its default handler - terminal output is untrusted and a path
 *  can point at an executable. */
export async function revealPath(path: string): Promise<void> {
  await revealItemInDir(path);
}

/** Pin the window (and the WebView2 color scheme with it) to a theme; null = follow the OS.
 *  On Windows this is the ONLY reliable way to track the OS theme - see src/lib/theme.ts. */
export async function setWindowTheme(theme: "dark" | "light" | null): Promise<void> {
  await getCurrentWindow().setTheme(theme);
}

/** The window's resolved theme ("dark"/"light"), or null when unknown. */
export async function windowTheme(): Promise<"dark" | "light" | null> {
  return await getCurrentWindow().theme();
}

/** Fires when the resolved window theme changes (only while not pinned by setWindowTheme). */
export function onWindowThemeChanged(
  cb: (theme: "dark" | "light") => void,
): Promise<UnlistenFn> {
  return getCurrentWindow().onThemeChanged(({ payload }) => cb(payload));
}

/** Run `handler` when the user asks to close the window. Returns an unlisten fn.
 *  `async` on purpose: outside Tauri getCurrentWindow() THROWS synchronously, and the
 *  async wrapper turns that into a rejection the caller's .catch can absorb. */
export async function onWindowCloseRequested(
  handler: (event: CloseRequestedEvent) => void | Promise<void>,
): Promise<UnlistenFn> {
  return getCurrentWindow().onCloseRequested(handler);
}

/** Destroy the window immediately (bypasses close-requested handlers). */
export async function destroyAppWindow(): Promise<void> {
  await getCurrentWindow().destroy();
}

/* ---- custom title bar (frameless window) ------------------------------------ */

export async function minimizeAppWindow(): Promise<void> {
  await getCurrentWindow().minimize();
}

export async function toggleMaximizeAppWindow(): Promise<void> {
  await getCurrentWindow().toggleMaximize();
}

/** Close via the normal close-requested flow (session backup + PTY teardown run). */
export async function closeAppWindow(): Promise<void> {
  await getCurrentWindow().close();
}

export async function isAppWindowMaximized(): Promise<boolean> {
  return await getCurrentWindow().isMaximized();
}

/** Fires on any window resize; used to keep the maximize/restore icon truthful. */
export async function onWindowResized(cb: () => void): Promise<UnlistenFn> {
  return getCurrentWindow().onResized(() => cb());
}
