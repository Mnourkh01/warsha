import { create } from "zustand";
import type { SessionStatus } from "../lib/types";

// Live per-session status + a restart epoch. NOT persisted.
interface RuntimeState {
  status: Record<string, SessionStatus>;
  /** Bumping a session's epoch remounts its TerminalView (used to restart it). */
  epoch: Record<string, number>;
  setStatus: (id: string, status: SessionStatus) => void;
  clearStatus: (id: string) => void;
  bumpEpoch: (id: string) => void;
}

export const useRuntime = create<RuntimeState>((set) => ({
  status: {},
  epoch: {},
  setStatus: (id, status) => set((s) => ({ status: { ...s.status, [id]: status } })),
  clearStatus: (id) =>
    set((s) => {
      // Session is gone: drop its status AND its restart epoch (unbounded otherwise).
      const status = { ...s.status };
      const epoch = { ...s.epoch };
      delete status[id];
      delete epoch[id];
      return { status, epoch };
    }),
  bumpEpoch: (id) => set((s) => ({ epoch: { ...s.epoch, [id]: (s.epoch[id] ?? 0) + 1 } })),
}));
