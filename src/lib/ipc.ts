// Typed bridge over Tauri commands + events. Nothing else in the app calls `invoke`
// or `listen` directly - all IPC goes through here so the surface stays one file.

import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { CloseRequestedEvent } from "@tauri-apps/api/window";
import { ask, open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
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

export interface AgentSendOpts {
  /** Chat session id (one in-flight request per session). */
  id: string;
  agent: "claude" | "gemini";
  prompt: string;
  /** Provider conversation id to continue (Claude resume). */
  resume?: string;
  cwd?: string;
}

/** Run one headless AI-CLI request; `onChunk` streams raw stdout text. Resolves with
 *  the exit code, rejects with `agent_*` errors (missing CLI, busy, cancelled, failed). */
export async function agentSend(
  opts: AgentSendOpts,
  onChunk: (text: string) => void,
): Promise<number> {
  const channel = new Channel<string>();
  channel.onmessage = (msg) => onChunk(String(msg));
  return await invoke<number>("agent_send", { opts, onOutput: channel });
}

/** Cancel a chat session's in-flight request (kills the CLI process). */
export async function agentCancel(id: string): Promise<void> {
  await invoke("agent_cancel", { id });
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

/** Native folder picker. Returns the chosen absolute path, or null if cancelled. */
export async function pickFolder(title?: string): Promise<string | null> {
  const res = await openDialog({ directory: true, multiple: false, title });
  return typeof res === "string" ? res : null;
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

/** Open a link in the SYSTEM browser, never inside the WebView. Terminal output is
 *  untrusted, so only http/https ever leaves the app. */
export async function openExternal(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) return;
  await openUrl(url);
}

/** Run `handler` when the user asks to close the window. Returns an unlisten fn. */
export function onWindowCloseRequested(
  handler: (event: CloseRequestedEvent) => void | Promise<void>,
): Promise<UnlistenFn> {
  return getCurrentWindow().onCloseRequested(handler);
}

/** Destroy the window immediately (bypasses close-requested handlers). */
export async function destroyAppWindow(): Promise<void> {
  await getCurrentWindow().destroy();
}
