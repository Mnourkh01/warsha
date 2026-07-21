import { create } from "zustand";
import type { NodeId } from "../lib/types";
import { uid } from "../lib/id";

// Grid workspace: an ordered list of panes, wrapped into rows of PER_ROW, capped at
// MAX_PANES. 1-3 panes fill the first row; 4-6 start a second row. Equal widths by
// default, mouse-resizable. This replaces the old binary split tree.
export const MAX_PANES = 6;
export const PER_ROW = 3;

export interface Pane {
  id: string;
  sessionId: NodeId | null;
}

interface LayoutPersist {
  panes: Pane[];
  activePaneId: string;
}

interface LayoutState extends LayoutPersist {
  focusPane: (id: string) => void;
  assignSession: (paneId: string, sessionId: NodeId | null) => void;
  /** Add an empty pane. Returns its id, or null if the grid is full (6). */
  addPane: () => string | null;
  /** Close a pane. Returns the sessionId it held so the caller can kill it. */
  closePane: (paneId: string) => NodeId | null;
  firstEmptyPaneId: () => string | null;
  paneIdWithSession: (sessionId: NodeId) => string | null;
  clearSession: (sessionId: NodeId) => void;
  isFull: () => boolean;
  hydrate: (data: unknown) => void;
  serialize: () => LayoutPersist;
}

const seed = (): Pane => ({ id: uid(), sessionId: null });

export const useLayout = create<LayoutState>((set, get) => {
  const first = seed();
  return {
    panes: [first],
    activePaneId: first.id,

    focusPane: (id) => set({ activePaneId: id }),

    assignSession: (paneId, sessionId) =>
      set((s) => {
        // A session lives in at most one pane: clear it elsewhere.
        const panes = s.panes.map((p) => {
          if (p.id === paneId) return { ...p, sessionId };
          if (sessionId && p.sessionId === sessionId) return { ...p, sessionId: null };
          return p;
        });
        return { panes, activePaneId: paneId };
      }),

    addPane: () => {
      if (get().panes.length >= MAX_PANES) return null;
      const p = seed();
      set((s) => ({ panes: [...s.panes, p], activePaneId: p.id }));
      return p.id;
    },

    closePane: (paneId) => {
      const held = get().panes.find((p) => p.id === paneId)?.sessionId ?? null;
      set((s) => {
        let panes = s.panes.filter((p) => p.id !== paneId);
        if (panes.length === 0) panes = [seed()];
        const active = panes.some((p) => p.id === s.activePaneId)
          ? s.activePaneId
          : panes[0].id;
        return { panes, activePaneId: active };
      });
      return held;
    },

    firstEmptyPaneId: () => {
      const { panes, activePaneId } = get();
      const active = panes.find((p) => p.id === activePaneId);
      if (active && active.sessionId === null) return active.id;
      return panes.find((p) => p.sessionId === null)?.id ?? null;
    },

    paneIdWithSession: (sessionId) =>
      get().panes.find((p) => p.sessionId === sessionId)?.id ?? null,

    clearSession: (sessionId) =>
      set((s) => ({
        panes: s.panes.map((p) => (p.sessionId === sessionId ? { ...p, sessionId: null } : p)),
      })),

    isFull: () => get().panes.length >= MAX_PANES,

    hydrate: (data) => {
      const d = data as Partial<LayoutPersist> | undefined;
      if (d && Array.isArray(d.panes) && d.panes.length > 0) {
        // Restore the pane layout but not live sessions (PTYs are not resumed in v1).
        const panes = d.panes
          .slice(0, MAX_PANES)
          .map((p) => ({ id: p.id ?? uid(), sessionId: null }));
        set({ panes, activePaneId: panes[0].id });
      } else {
        const f = seed();
        set({ panes: [f], activePaneId: f.id });
      }
    },

    serialize: () => {
      const { panes, activePaneId } = get();
      return { panes, activePaneId };
    },
  };
});

/** Split panes into rows of PER_ROW for grid rendering. */
export function paneRows(panes: Pane[]): Pane[][] {
  const rows: Pane[][] = [];
  for (let i = 0; i < panes.length; i += PER_ROW) {
    rows.push(panes.slice(i, i + PER_ROW));
  }
  return rows;
}
