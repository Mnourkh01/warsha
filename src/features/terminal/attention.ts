// Attention badges: a background session that produced a burst of output and then went
// quiet (or exited) is "done or waiting for you". The focused session never badges,
// the user watched it happen. This is the multiplexer's core signal when several AI
// agents run at once.

import { useRuntime } from "../../store/runtime";
import { useWorkspaces } from "../../store/workspaces";

/** Silence gap that ends an output burst. */
export const QUIET_MS = 1500;
/** Bursts smaller than this are cursor noise or stray control bytes, not "work done". */
export const MIN_BURST_BYTES = 64;

interface Track {
  bytes: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const tracks = new Map<string, Track>();

function watchingIt(id: string): boolean {
  // Window unfocused counts as "not watching" even for the active pane, so alt-tabbing
  // away and coming back still tells you the agent finished. (No document in unit tests.)
  const focused = typeof document === "undefined" || document.hasFocus();
  return focused && useWorkspaces.getState().activeSessionId === id;
}

/** Feed PTY output into the burst tracker (called from the terminal data channel). */
export function noteOutput(id: string, byteLen: number): void {
  let t = tracks.get(id);
  if (!t) {
    t = { bytes: 0, timer: null };
    tracks.set(id, t);
  }
  t.bytes += byteLen;
  if (t.timer) clearTimeout(t.timer);
  t.timer = setTimeout(() => settle(id), QUIET_MS);
}

// Decide at the QUIET moment, not the burst moment: switching away mid-burst still
// earns a badge, switching TO the pane mid-burst does not.
function settle(id: string): void {
  const t = tracks.get(id);
  if (!t) return;
  const bytes = t.bytes;
  t.bytes = 0;
  t.timer = null;
  if (bytes < MIN_BURST_BYTES) return;
  if (stillExists(id) && !watchingIt(id)) useRuntime.getState().setAttention(id);
}

/** Process exit is always attention-worthy for a background session. */
export function noteExit(id: string): void {
  dropTracking(id);
  // A user-initiated close also emits an exit event, after the session is already
  // gone from the store; setting attention then would leak a zombie entry.
  if (stillExists(id) && !watchingIt(id)) useRuntime.getState().setAttention(id);
}

function stillExists(id: string): boolean {
  return Boolean(useWorkspaces.getState().sessions[id]);
}

/** Stop tracking a session (closed or disposed). */
export function dropTracking(id: string): void {
  const t = tracks.get(id);
  if (t?.timer) clearTimeout(t.timer);
  tracks.delete(id);
}
