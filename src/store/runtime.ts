import { create } from "zustand";
import type { NodeId, SessionStatus } from "../lib/types";

// Live per-session status. NOT persisted - runtime only.
interface RuntimeState {
  status: Record<NodeId, SessionStatus>;
  setStatus: (id: NodeId, status: SessionStatus) => void;
  clearStatus: (id: NodeId) => void;
}

export const useRuntime = create<RuntimeState>((set) => ({
  status: {},
  setStatus: (id, status) => set((s) => ({ status: { ...s.status, [id]: status } })),
  clearStatus: (id) =>
    set((s) => {
      const next = { ...s.status };
      delete next[id];
      return { status: next };
    }),
}));
