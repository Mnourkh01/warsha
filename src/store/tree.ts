import { create } from "zustand";
import type { GroupNode, NodeId, SessionNode, ShellKind, TreeNode } from "../lib/types";
import { uid } from "../lib/id";

interface TreePersist {
  nodes: Record<NodeId, TreeNode>;
  rootIds: NodeId[];
}

interface TreeState extends TreePersist {
  addGroup: (parentId: NodeId | null, name?: string) => NodeId;
  addSession: (
    parentId: NodeId | null,
    shell: ShellKind,
    name?: string,
    cwd?: string,
    initCommand?: string,
    typeId?: string,
  ) => NodeId;
  rename: (id: NodeId, name: string) => void;
  setCwd: (id: NodeId, cwd: string) => void;
  toggleCollapse: (id: NodeId) => void;
  /** Remove a node (and descendants). Returns the removed SESSION ids so callers can kill PTYs. */
  remove: (id: NodeId) => NodeId[];
  /** Reparent/reorder a node. No-op if it would create a cycle. */
  move: (id: NodeId, newParentId: NodeId | null, index: number) => void;
  hydrate: (data: TreePersist) => void;
  serialize: () => TreePersist;
}

// Sibling list for a parent (root when null).
function siblings(state: TreePersist, parentId: NodeId | null): NodeId[] {
  if (parentId === null) return state.rootIds;
  const parent = state.nodes[parentId];
  return parent && parent.type === "group" ? parent.children : state.rootIds;
}

function isDescendant(nodes: Record<NodeId, TreeNode>, maybeAncestor: NodeId, id: NodeId): boolean {
  let cur: NodeId | null = id;
  while (cur) {
    if (cur === maybeAncestor) return true;
    cur = nodes[cur]?.parentId ?? null;
  }
  return false;
}

export const useTree = create<TreeState>((set, get) => ({
  nodes: {},
  rootIds: [],

  addGroup: (parentId, name = "New group") => {
    const id = uid();
    set((s) => {
      const group: GroupNode = { id, type: "group", name, parentId, children: [] };
      const nodes = { ...s.nodes, [id]: group };
      if (parentId === null) return { nodes, rootIds: [...s.rootIds, id] };
      const parent = nodes[parentId];
      if (parent && parent.type === "group") {
        nodes[parentId] = { ...parent, children: [...parent.children, id] };
      }
      return { nodes };
    });
    return id;
  },

  addSession: (parentId, shell, name = "New session", cwd, initCommand, typeId) => {
    const id = uid();
    set((s) => {
      const session: SessionNode = { id, type: "session", name, parentId, shell, cwd, initCommand, typeId };
      const nodes = { ...s.nodes, [id]: session };
      if (parentId === null) return { nodes, rootIds: [...s.rootIds, id] };
      const parent = nodes[parentId];
      if (parent && parent.type === "group") {
        nodes[parentId] = { ...parent, children: [...parent.children, id] };
      }
      return { nodes };
    });
    return id;
  },

  rename: (id, name) =>
    set((s) => {
      const node = s.nodes[id];
      if (!node) return s;
      return { nodes: { ...s.nodes, [id]: { ...node, name } } };
    }),

  setCwd: (id, cwd) =>
    set((s) => {
      const node = s.nodes[id];
      if (!node || node.type !== "session") return s;
      return { nodes: { ...s.nodes, [id]: { ...node, cwd } } };
    }),

  toggleCollapse: (id) =>
    set((s) => {
      const node = s.nodes[id];
      if (!node || node.type !== "group") return s;
      return { nodes: { ...s.nodes, [id]: { ...node, collapsed: !node.collapsed } } };
    }),

  remove: (id) => {
    const removedSessions: NodeId[] = [];
    set((s) => {
      const nodes = { ...s.nodes };
      const toDelete: NodeId[] = [];
      const walk = (nid: NodeId) => {
        const n = nodes[nid];
        if (!n) return;
        toDelete.push(nid);
        if (n.type === "session") removedSessions.push(nid);
        if (n.type === "group") n.children.forEach(walk);
      };
      walk(id);

      const target = nodes[id];
      const parentId = target?.parentId ?? null;
      for (const d of toDelete) delete nodes[d];

      if (parentId === null) {
        return { nodes, rootIds: s.rootIds.filter((r) => r !== id) };
      }
      const parent = nodes[parentId];
      if (parent && parent.type === "group") {
        nodes[parentId] = { ...parent, children: parent.children.filter((c) => c !== id) };
      }
      return { nodes };
    });
    return removedSessions;
  },

  move: (id, newParentId, index) => {
    set((s) => {
      if (id === newParentId) return s;
      if (newParentId && isDescendant(s.nodes, id, newParentId)) return s; // no cycles
      const node = s.nodes[id];
      if (!node) return s;

      const nodes = { ...s.nodes };
      let rootIds = s.rootIds;
      const oldParentId = node.parentId;

      // Remove from old location.
      if (oldParentId === null) {
        rootIds = rootIds.filter((r) => r !== id);
      } else {
        const op = nodes[oldParentId];
        if (op && op.type === "group") {
          nodes[oldParentId] = { ...op, children: op.children.filter((c) => c !== id) };
        }
      }

      // Insert into new location.
      nodes[id] = { ...node, parentId: newParentId } as TreeNode;
      if (newParentId === null) {
        const next = [...rootIds];
        next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
        rootIds = next;
      } else {
        const np = nodes[newParentId];
        if (np && np.type === "group") {
          const next = [...np.children];
          next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
          nodes[newParentId] = { ...np, children: next };
        } else {
          // Target is not a group; drop at root instead.
          const next = [...rootIds];
          next.splice(Math.max(0, Math.min(index, next.length)), 0, id);
          rootIds = next;
          nodes[id] = { ...node, parentId: null } as TreeNode;
        }
      }
      return { nodes, rootIds };
    });
  },

  hydrate: (data) => set({ nodes: data.nodes ?? {}, rootIds: data.rootIds ?? [] }),
  serialize: () => {
    const { nodes, rootIds } = get();
    return { nodes, rootIds };
  },
}));

// Helper used by the tree UI (not part of the store to keep it serializable).
export function childIds(state: TreePersist, parentId: NodeId | null): NodeId[] {
  return siblings(state, parentId);
}
