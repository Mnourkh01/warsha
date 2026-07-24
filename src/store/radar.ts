import { create } from "zustand";
import {
  radarSnapshot,
  type RadarMcpProc,
  type RadarPortListener,
  type RadarProcEntry,
  type RadarSnapshot,
} from "../lib/ipc";

// Live radar data (what is running right now). NOT persisted. App.tsx owns the poll
// loop (slow while the dialog is closed, fast while open); this store only holds the
// latest snapshot so the TitleBar badge and the dialog read the same data.
interface RadarState {
  snapshot: RadarSnapshot | null;
  /** Last refresh failure; null while things work. Old snapshot is kept on failure. */
  error: string | null;
  refresh: () => Promise<void>;
}

let inFlight = false;

export const useRadar = create<RadarState>((set) => ({
  snapshot: null,
  error: null,
  refresh: async () => {
    // A slow probe (docker warming up) must not stack a second one behind it.
    if (inFlight) return;
    inFlight = true;
    try {
      const snapshot = await radarSnapshot();
      set({ snapshot, error: null });
    } catch (e) {
      // Outside Tauri (tests, plain browser) there is no IPC; stay quietly empty.
      if ("__TAURI_INTERNALS__" in window) {
        console.warn("radar refresh failed", e);
        set({ error: String(e) });
      }
    } finally {
      inFlight = false;
    }
  },
}));

/** Things worth the user's attention: listeners, MCP hosts, containers. Session
 *  process trees are normal work, so they do not count toward the badge. */
export function liveCount(snapshot: RadarSnapshot | null): number {
  if (!snapshot) return 0;
  return snapshot.ports.length + snapshot.mcp.length + snapshot.docker.containers.length;
}

/** A process older than this is probably forgotten, not in active use. */
export const OLD_AFTER_SECONDS = 6 * 60 * 60;

/** Compact age from a unix-seconds start time: "2m", "3h", "5d". Empty when the OS
 *  gave no start time (0) or the clock looks wrong (start in the future). */
export function ageLabel(startedAtSecs: number, nowMs: number): string {
  if (startedAtSecs <= 0) return "";
  const secs = Math.floor(nowMs / 1000) - startedAtSecs;
  if (secs < 0) return "";
  if (secs < 60) return "now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

/** True when the process has been alive long enough to deserve the "old" tint. */
export function isOld(startedAtSecs: number, nowMs: number): boolean {
  if (startedAtSecs <= 0) return false;
  return Math.floor(nowMs / 1000) - startedAtSecs >= OLD_AFTER_SECONDS;
}

/* ---- display grouping: workspace -> session -> what it started ---------------- */

/** Everything one live session started: its listeners, MCP hosts, and processes. */
export interface RadarSessionBucket {
  sessionId: string;
  ports: RadarPortListener[];
  mcp: RadarMcpProc[];
  procs: RadarProcEntry[];
}

export interface RadarWorkspaceGroup {
  id: string;
  name: string;
  buckets: RadarSessionBucket[];
}

export interface RadarGrouping {
  groups: RadarWorkspaceGroup[];
  /** Live sessions no workspace claims (closed between poll and render). */
  orphanBuckets: RadarSessionBucket[];
  /** Listeners and MCP hosts attributed to no session at all. */
  loosePorts: RadarPortListener[];
  looseMcp: RadarMcpProc[];
}

/** Regroup the flat snapshot into the workspace -> session hierarchy the dialog
 *  shows. Quiet sessions (nothing running) are dropped: radar lists what runs,
 *  not the whole tree. Pure so it is testable without a live snapshot. */
export function groupSnapshot(
  snapshot: RadarSnapshot,
  workspaces: { id: string; name: string; sessionIds: string[] }[],
): RadarGrouping {
  const buckets = new Map<string, RadarSessionBucket>();
  for (const s of snapshot.sessions) {
    buckets.set(s.sessionId, { sessionId: s.sessionId, ports: [], mcp: [], procs: s.procs });
  }
  const loosePorts: RadarPortListener[] = [];
  for (const p of snapshot.ports) {
    const b = p.sessionId ? buckets.get(p.sessionId) : undefined;
    if (b) b.ports.push(p);
    else loosePorts.push(p);
  }
  const looseMcp: RadarMcpProc[] = [];
  for (const m of snapshot.mcp) {
    const b = m.sessionId ? buckets.get(m.sessionId) : undefined;
    if (b) b.mcp.push(m);
    else looseMcp.push(m);
  }

  const hasWork = (b: RadarSessionBucket) =>
    b.ports.length + b.mcp.length + b.procs.length > 0;
  const claimed = new Set<string>();
  const groups = workspaces
    .map((w) => ({
      id: w.id,
      name: w.name,
      buckets: w.sessionIds
        .map((sid) => {
          claimed.add(sid);
          return buckets.get(sid);
        })
        .filter((b): b is RadarSessionBucket => !!b && hasWork(b)),
    }))
    .filter((g) => g.buckets.length > 0);
  const orphanBuckets = [...buckets.values()].filter(
    (b) => !claimed.has(b.sessionId) && hasWork(b),
  );
  return { groups, orphanBuckets, loosePorts, looseMcp };
}
