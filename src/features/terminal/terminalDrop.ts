// Makes a terminal pane behave like a native terminal on file drop: the dropped path(s) are
// typed into that pane's shell, quoted if they contain spaces, with no Enter, so the user
// adds text and submits themselves. Tauri intercepts OS file drops at the window level (the
// grid never gets an HTML5 `drop`), so, like the chat drop router, one module-level listener
// hit-tests the drop position against every registered terminal pane and writes to the PTY of
// the one under the cursor. Any file type is accepted, exactly as Windows Terminal drops any
// path.

import { onWebviewFileDrop, ptyWrite, type FileDropEvent } from "../../lib/ipc";
import { getTerminal } from "./controller";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface TermDropTarget {
  /** Toggle the pane's "drop here" highlight. */
  setOver: (over: boolean) => void;
}

const targets = new Map<string, TermDropTarget>();
let unlisten: Promise<UnlistenFn> | null = null;
let overId: string | null = null;

// Which registered terminal pane sits under this (physical-pixel) cursor position, if any.
function hitTest(pos: { x: number; y: number }): string | null {
  const dpr = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(pos.x / dpr, pos.y / dpr);
  const host = el?.closest<HTMLElement>("[data-term-drop]");
  const id = host?.dataset.termDrop;
  return id && targets.has(id) ? id : null;
}

function setOver(id: string | null): void {
  if (overId === id) return;
  if (overId) targets.get(overId)?.setOver(false);
  overId = id;
  if (id) targets.get(id)?.setOver(true);
}

// Quote a path the way a native terminal does: leave it bare only when every char is
// plainly shell-safe; anything else (spaces, but also &;$^() etc, all legal in NTFS names)
// gets double quotes so the path stays one inert argument in cmd/PowerShell/bash alike.
// (No inner-quote escaping - Windows file paths cannot contain a double quote.)
const SHELL_SAFE_PATH = /^[\w.:\\/-]+$/;
export function quotePath(p: string): string {
  return SHELL_SAFE_PATH.test(p) ? p : `"${p}"`;
}

function handle(e: FileDropEvent): void {
  if (e.kind === "leave") {
    setOver(null);
    return;
  }
  const id = hitTest(e.position);
  if (e.kind === "enter" || e.kind === "over") {
    setOver(id);
    return;
  }
  if (e.kind === "drop") {
    setOver(null);
    if (!id || !e.paths.length) return;
    // Trailing space separates the path from whatever the user types next (or the next path).
    const text = e.paths.map(quotePath).join(" ") + " ";
    void ptyWrite(id, text).catch(() => {});
    getTerminal(id)?.focus();
  }
}

/** Register a terminal pane as a drop target for the lifetime of the returned unregister fn. */
export function registerTerminalDrop(sessionId: string, target: TermDropTarget): () => void {
  targets.set(sessionId, target);
  // Start the single global listener lazily, on the first terminal that mounts.
  // Outside Tauri (plain browser, tests) the subscription rejects: no OS drops there.
  if (!unlisten) unlisten = onWebviewFileDrop(handle).catch(() => () => {});
  return () => {
    if (overId === sessionId) overId = null;
    targets.delete(sessionId);
  };
}
