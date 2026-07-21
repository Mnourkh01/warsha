// Typed bridge over Tauri commands + events. Nothing else in the app calls `invoke`
// or `listen` directly - all IPC goes through here so the surface stays one file.

import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
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

/** Subscribe to session-exit notifications. Returns an unlisten function. */
export function onPtyExit(cb: (id: string) => void): Promise<UnlistenFn> {
  return listen<{ id: string }>("pty://exit", (e) => cb(e.payload.id));
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

export async function loadState<T>(): Promise<T | null> {
  return (await invoke<T | null>("session_state_load")) ?? null;
}

export async function saveState(state: unknown): Promise<void> {
  await invoke("session_state_save", { state });
}
