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

export interface UpdateInfo {
  version: string;
  url: string;
}

/** Newer GitHub release if one exists; null when up to date or unable to check. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  return (await invoke<UpdateInfo | null>("update_check")) ?? null;
}

/** Full path of a program if it is on PATH, else null. */
export async function whichProgram(program: string): Promise<string | null> {
  return (await invoke<string | null>("which_program", { program })) ?? null;
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
