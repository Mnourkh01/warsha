// Routes OS file drops to the chat pane under the cursor. Tauri's drag-drop event is
// window-global (one stream, no per-element targeting), so a single module-level listener
// hit-tests the drop position against every registered chat pane and hands the image paths
// to the right one. Non-image files are ignored.

import { onWebviewFileDrop, IMAGE_EXTENSIONS, type FileDropEvent } from "../../lib/ipc";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface DropTarget {
  /** Toggle the pane's "drop here" highlight. */
  setOver: (over: boolean) => void;
  /** Receive the dropped image paths (already filtered to images). */
  onDrop: (paths: string[]) => void;
}

const IMAGE_RE = new RegExp(`\\.(${IMAGE_EXTENSIONS.join("|")})$`, "i");

const targets = new Map<string, DropTarget>();
let unlisten: Promise<UnlistenFn> | null = null;
let overId: string | null = null;

// Which registered chat pane sits under this (physical-pixel) cursor position, if any.
function hitTest(pos: { x: number; y: number }): string | null {
  const dpr = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(pos.x / dpr, pos.y / dpr);
  const host = el?.closest<HTMLElement>("[data-chat-drop]");
  const id = host?.dataset.chatDrop;
  return id && targets.has(id) ? id : null;
}

function setOver(id: string | null): void {
  if (overId === id) return;
  if (overId) targets.get(overId)?.setOver(false);
  overId = id;
  if (id) targets.get(id)?.setOver(true);
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
    if (!id) return;
    const images = e.paths.filter((p) => IMAGE_RE.test(p));
    if (images.length) targets.get(id)?.onDrop(images);
  }
}

/** Register a chat pane as a drop target for the lifetime of the returned unregister fn. */
export function registerChatDrop(sessionId: string, target: DropTarget): () => void {
  targets.set(sessionId, target);
  // Start the single global listener lazily, on the first pane that mounts.
  if (!unlisten) unlisten = onWebviewFileDrop(handle);
  return () => {
    if (overId === sessionId) overId = null;
    targets.delete(sessionId);
  };
}
