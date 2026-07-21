import { create } from "zustand";
import type { ShellKind } from "../lib/types";
import { uid } from "../lib/id";

// Workspace-centric model: a Workspace holds up to MAX_PER_WS sessions, tiled in the grid
// (PER_ROW per row). Switching workspaces swaps the grid; other workspaces keep their
// sessions. Sessions live in a global map keyed by id (the terminal registry + runtime
// status are keyed the same way).
export const MAX_PER_WS = 6;
export const PER_ROW = 3;

export interface Session {
  id: string;
  name: string;
  shell: ShellKind;
  cwd?: string;
  typeId?: string;
  /** Present = this is an AI chat session (rendered as a chat pane, no PTY). */
  agent?: "claude" | "gemini";
}

export interface Workspace {
  id: string;
  name: string;
  sessionIds: string[]; // order = grid order, capped at MAX_PER_WS
  /** Project folder for this workspace: new sessions here start in it by default. */
  defaultCwd?: string;
}

interface WsPersist {
  workspaces: Workspace[];
  sessions: Record<string, Session>;
  activeWorkspaceId: string;
}

interface WsState extends WsPersist {
  activeSessionId: string | null;
  addWorkspace: (name?: string) => string;
  removeWorkspace: (id: string) => string[];
  renameWorkspace: (id: string, name: string) => void;
  setWorkspaceCwd: (id: string, cwd: string | undefined) => void;
  setActiveWorkspace: (id: string) => void;
  addSession: (
    spec: { shell: ShellKind; name: string; cwd?: string; typeId?: string; agent?: "claude" | "gemini" },
    workspaceId?: string,
  ) => string | null;
  removeSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  setActiveSession: (id: string) => void;
  reorderSession: (sessionId: string, toIndex: number) => void;
  moveSessionToWorkspace: (sessionId: string, targetWsId: string) => boolean;
  workspaceOf: (sessionId: string) => string | null;
  isFull: (workspaceId?: string) => boolean;
  hydrate: (data: unknown) => void;
  serialize: () => WsPersist;
}

function makeWs(name: string): Workspace {
  return { id: uid(), name, sessionIds: [] };
}

export const useWorkspaces = create<WsState>((set, get) => {
  const first = makeWs("Workspace 1");
  return {
    workspaces: [first],
    sessions: {},
    activeWorkspaceId: first.id,
    activeSessionId: null,

    addWorkspace: (name) => {
      // Next free number, not count+1: after deletions "Workspace 2" may still exist.
      const taken = new Set(get().workspaces.map((w) => w.name));
      let n = get().workspaces.length + 1;
      while (taken.has(`Workspace ${n}`)) n += 1;
      const ws = makeWs(name ?? `Workspace ${n}`);
      set((s) => ({
        workspaces: [...s.workspaces, ws],
        activeWorkspaceId: ws.id,
        activeSessionId: null,
      }));
      return ws.id;
    },

    removeWorkspace: (id) => {
      const ws = get().workspaces.find((w) => w.id === id);
      const removed = ws ? [...ws.sessionIds] : [];
      set((s) => {
        let workspaces = s.workspaces.filter((w) => w.id !== id);
        if (workspaces.length === 0) workspaces = [makeWs("Workspace 1")];
        const sessions = { ...s.sessions };
        removed.forEach((sid) => delete sessions[sid]);
        const wasActive = !workspaces.some((w) => w.id === s.activeWorkspaceId);
        const activeWorkspaceId = wasActive ? workspaces[0].id : s.activeWorkspaceId;
        // Deleting a BACKGROUND workspace must not steal focus from the session the
        // user is looking at; only re-point focus when the active workspace died.
        const activeSessionId = wasActive
          ? (workspaces[0].sessionIds[0] ?? null)
          : removed.includes(s.activeSessionId ?? "")
            ? null
            : s.activeSessionId;
        return { workspaces, sessions, activeWorkspaceId, activeSessionId };
      });
      return removed;
    },

    renameWorkspace: (id, name) =>
      set((s) => ({
        workspaces: s.workspaces.map((w) => (w.id === id ? { ...w, name } : w)),
      })),

    setWorkspaceCwd: (id, cwd) =>
      set((s) => ({
        workspaces: s.workspaces.map((w) =>
          w.id === id ? { ...w, defaultCwd: cwd && cwd.trim() ? cwd : undefined } : w,
        ),
      })),

    setActiveWorkspace: (id) =>
      set((s) => {
        const ws = s.workspaces.find((w) => w.id === id);
        return { activeWorkspaceId: id, activeSessionId: ws?.sessionIds[0] ?? null };
      }),

    addSession: (spec, workspaceId) => {
      const wsId = workspaceId ?? get().activeWorkspaceId;
      const ws = get().workspaces.find((w) => w.id === wsId);
      if (!ws || ws.sessionIds.length >= MAX_PER_WS) return null;
      const id = uid();
      const session: Session = {
        id,
        name: spec.name,
        shell: spec.shell,
        cwd: spec.cwd,
        typeId: spec.typeId,
        agent: spec.agent,
      };
      set((s) => ({
        sessions: { ...s.sessions, [id]: session },
        workspaces: s.workspaces.map((w) =>
          w.id === wsId ? { ...w, sessionIds: [...w.sessionIds, id] } : w,
        ),
        activeWorkspaceId: wsId,
        activeSessionId: id,
      }));
      return id;
    },

    removeSession: (id) =>
      set((s) => {
        const sessions = { ...s.sessions };
        delete sessions[id];
        // Only rebuild the workspace that actually holds the session; untouched
        // workspaces keep their references (selector stability).
        const workspaces = s.workspaces.map((w) =>
          w.sessionIds.includes(id)
            ? { ...w, sessionIds: w.sessionIds.filter((x) => x !== id) }
            : w,
        );
        const activeSessionId =
          s.activeSessionId === id
            ? (workspaces.find((w) => w.id === s.activeWorkspaceId)?.sessionIds[0] ?? null)
            : s.activeSessionId;
        return { sessions, workspaces, activeSessionId };
      }),

    renameSession: (id, name) =>
      set((s) => {
        const session = s.sessions[id];
        if (!session) return s;
        return { sessions: { ...s.sessions, [id]: { ...session, name } } };
      }),

    setActiveSession: (id) => {
      const wsId = get().workspaceOf(id);
      set(wsId ? { activeSessionId: id, activeWorkspaceId: wsId } : { activeSessionId: id });
    },

    reorderSession: (sessionId, toIndex) =>
      set((s) => {
        const wsId = s.workspaces.find((w) => w.sessionIds.includes(sessionId))?.id;
        if (!wsId) return s;
        return {
          workspaces: s.workspaces.map((w) => {
            if (w.id !== wsId) return w;
            const ids = w.sessionIds.filter((x) => x !== sessionId);
            ids.splice(Math.max(0, Math.min(toIndex, ids.length)), 0, sessionId);
            return { ...w, sessionIds: ids };
          }),
        };
      }),

    moveSessionToWorkspace: (sessionId, targetWsId) => {
      const target = get().workspaces.find((w) => w.id === targetWsId);
      if (!target || target.sessionIds.length >= MAX_PER_WS || target.sessionIds.includes(sessionId)) {
        return false;
      }
      set((s) => {
        const workspaces = s.workspaces.map((w) => {
          if (w.id === targetWsId) return { ...w, sessionIds: [...w.sessionIds, sessionId] };
          if (w.sessionIds.includes(sessionId))
            return { ...w, sessionIds: w.sessionIds.filter((x) => x !== sessionId) };
          return w;
        });
        // If the focused session was dragged out of the visible workspace, focus falls
        // back to that workspace's first remaining session (no dangling pointer).
        let activeSessionId = s.activeSessionId;
        if (s.activeSessionId === sessionId && s.activeWorkspaceId !== targetWsId) {
          const current = workspaces.find((w) => w.id === s.activeWorkspaceId);
          activeSessionId = current?.sessionIds[0] ?? null;
        }
        return { workspaces, activeSessionId };
      });
      return true;
    },

    workspaceOf: (sessionId) =>
      get().workspaces.find((w) => w.sessionIds.includes(sessionId))?.id ?? null,

    isFull: (workspaceId) => {
      const wsId = workspaceId ?? get().activeWorkspaceId;
      const ws = get().workspaces.find((w) => w.id === wsId);
      return !!ws && ws.sessionIds.length >= MAX_PER_WS;
    },

    hydrate: (data) => {
      const d = data as Partial<WsPersist> | undefined;
      if (
        d &&
        Array.isArray(d.workspaces) &&
        d.workspaces.length > 0 &&
        d.sessions &&
        typeof d.sessions === "object"
      ) {
        const raw = d.sessions;
        // Same boundary discipline as settings.hydrate: the blob comes from disk, so
        // ids/names get type-checked and a session id may live in ONE workspace only
        // (a duplicated id would double-render and fight over the same PTY).
        const seen = new Set<string>();
        const workspaces = d.workspaces
          .filter((w) => !!w && typeof w.id === "string" && w.id.length > 0)
          .map((w) => {
            const sessionIds: string[] = [];
            for (const id of Array.isArray(w.sessionIds) ? w.sessionIds : []) {
              if (typeof id !== "string" || !raw[id] || seen.has(id)) continue;
              seen.add(id);
              sessionIds.push(id);
              if (sessionIds.length >= MAX_PER_WS) break;
            }
            return {
              id: w.id,
              name: typeof w.name === "string" && w.name.length > 0 ? w.name : "Workspace",
              sessionIds,
              defaultCwd:
                typeof w.defaultCwd === "string" && w.defaultCwd.trim() ? w.defaultCwd : undefined,
            };
          });
        if (workspaces.length === 0) {
          const f = makeWs("Workspace 1");
          set({ workspaces: [f], sessions: {}, activeWorkspaceId: f.id, activeSessionId: null });
          return;
        }
        // Drop orphan sessions (in the map but in no workspace) so a corrupt blob can't
        // leak entries that re-persist forever.
        const keep = new Set(workspaces.flatMap((w) => w.sessionIds));
        const sessions: Record<string, Session> = {};
        for (const [sid, sess] of Object.entries(raw)) {
          if (keep.has(sid)) sessions[sid] = sess;
        }
        // Restore the workspace the user was in, not always the first one.
        const activeWorkspaceId = workspaces.some((w) => w.id === d.activeWorkspaceId)
          ? (d.activeWorkspaceId as string)
          : workspaces[0].id;
        set({ workspaces, sessions, activeWorkspaceId, activeSessionId: null });
      } else {
        const f = makeWs("Workspace 1");
        set({ workspaces: [f], sessions: {}, activeWorkspaceId: f.id, activeSessionId: null });
      }
    },

    serialize: () => {
      const { workspaces, sessions, activeWorkspaceId } = get();
      return { workspaces, sessions, activeWorkspaceId };
    },
  };
});

/** Split an ordered session-id list into rows of PER_ROW for the grid. */
export function paneRows(ids: string[]): string[][] {
  const rows: string[][] = [];
  for (let i = 0; i < ids.length; i += PER_ROW) rows.push(ids.slice(i, i + PER_ROW));
  return rows;
}
