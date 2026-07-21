import { create } from "zustand";
import type { NodeId, PaneNode } from "../lib/types";
import { uid } from "../lib/id";

interface LayoutPersist {
  root: PaneNode;
  activePaneId: string;
}

interface LayoutState extends LayoutPersist {
  focusPane: (id: string) => void;
  assignSession: (paneId: string, sessionId: NodeId | null) => void;
  /** Split a leaf pane; returns the new empty leaf's id (and focuses it). */
  splitPane: (paneId: string, dir: "row" | "col") => string | null;
  /** Close a leaf pane. Returns the sessionId it held (so the caller can kill it). */
  closePane: (paneId: string) => NodeId | null;
  paneIdWithSession: (sessionId: NodeId) => string | null;
  /** An empty leaf to reuse (the active one if empty, else the first empty). */
  firstEmptyPaneId: () => string | null;
  clearSession: (sessionId: NodeId) => void;
  hydrate: (data: LayoutPersist) => void;
  serialize: () => LayoutPersist;
}

function makeLeaf(): PaneNode {
  return { type: "leaf", id: uid(), sessionId: null };
}

function firstLeafId(node: PaneNode): string {
  return node.type === "leaf" ? node.id : firstLeafId(node.a);
}

function mapLeaf(node: PaneNode, paneId: string, fn: (leaf: PaneNode) => PaneNode): PaneNode {
  if (node.type === "leaf") return node.id === paneId ? fn(node) : node;
  return { ...node, a: mapLeaf(node.a, paneId, fn), b: mapLeaf(node.b, paneId, fn) };
}

function clearSessionInTree(node: PaneNode, sessionId: NodeId): PaneNode {
  if (node.type === "leaf") {
    return node.sessionId === sessionId ? { ...node, sessionId: null } : node;
  }
  return {
    ...node,
    a: clearSessionInTree(node.a, sessionId),
    b: clearSessionInTree(node.b, sessionId),
  };
}

function findSessionPane(node: PaneNode, sessionId: NodeId): string | null {
  if (node.type === "leaf") return node.sessionId === sessionId ? node.id : null;
  return findSessionPane(node.a, sessionId) ?? findSessionPane(node.b, sessionId);
}

// Remove a leaf; the split that held it collapses to its sibling. Returns the new
// subtree, or null if this whole subtree was exactly the removed leaf.
function removeLeaf(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === "leaf") return node.id === paneId ? null : node;
  const a = removeLeaf(node.a, paneId);
  const b = removeLeaf(node.b, paneId);
  if (a === null) return b;
  if (b === null) return a;
  return { ...node, a, b };
}

function sessionInLeaf(node: PaneNode, paneId: string): NodeId | null {
  if (node.type === "leaf") return node.id === paneId ? node.sessionId : null;
  return sessionInLeaf(node.a, paneId) ?? sessionInLeaf(node.b, paneId);
}

function firstEmptyLeaf(node: PaneNode): string | null {
  if (node.type === "leaf") return node.sessionId === null ? node.id : null;
  return firstEmptyLeaf(node.a) ?? firstEmptyLeaf(node.b);
}

function isEmptyLeaf(node: PaneNode, paneId: string): boolean {
  if (node.type === "leaf") return node.id === paneId && node.sessionId === null;
  return isEmptyLeaf(node.a, paneId) || isEmptyLeaf(node.b, paneId);
}

const initialLeaf = makeLeaf();

export const useLayout = create<LayoutState>((set, get) => ({
  root: initialLeaf,
  activePaneId: initialLeaf.id,

  focusPane: (id) => set({ activePaneId: id }),

  assignSession: (paneId, sessionId) =>
    set((s) => {
      // A session lives in at most one pane: clear it elsewhere first.
      const cleared = sessionId ? clearSessionInTree(s.root, sessionId) : s.root;
      const root = mapLeaf(cleared, paneId, (leaf) => ({ ...leaf, sessionId }));
      return { root, activePaneId: paneId };
    }),

  splitPane: (paneId, dir) => {
    const newLeaf = makeLeaf();
    let ok = false;
    set((s) => {
      const root = mapLeaf(s.root, paneId, (leaf) => {
        ok = true;
        return { type: "split", id: uid(), dir, a: leaf, b: newLeaf };
      });
      return { root, activePaneId: newLeaf.id };
    });
    return ok ? newLeaf.id : null;
  },

  closePane: (paneId) => {
    const held = sessionInLeaf(get().root, paneId);
    set((s) => {
      const root = removeLeaf(s.root, paneId) ?? makeLeaf(); // never leave zero panes
      return { root, activePaneId: firstLeafId(root) };
    });
    return held;
  },

  paneIdWithSession: (sessionId) => findSessionPane(get().root, sessionId),

  firstEmptyPaneId: () => {
    const { root, activePaneId } = get();
    if (isEmptyLeaf(root, activePaneId)) return activePaneId; // prefer the active pane
    return firstEmptyLeaf(root);
  },

  clearSession: (sessionId) => set((s) => ({ root: clearSessionInTree(s.root, sessionId) })),

  hydrate: (data) => {
    const root = data?.root ?? makeLeaf();
    set({ root, activePaneId: firstLeafId(root) });
  },
  serialize: () => {
    const { root, activePaneId } = get();
    return { root, activePaneId };
  },
}));
