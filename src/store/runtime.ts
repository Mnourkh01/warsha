import { create } from "zustand";
import type { SessionStatus } from "../lib/types";

// Live per-session status + a restart epoch. NOT persisted.
interface RuntimeState {
  status: Record<string, SessionStatus>;
  /** Bumping a session's epoch remounts its TerminalView (used to restart it). */
  epoch: Record<string, number>;
  /** Background sessions that finished output or exited and want the user's eyes. */
  attention: Record<string, true>;
  setStatus: (id: string, status: SessionStatus) => void;
  clearStatus: (id: string) => void;
  bumpEpoch: (id: string) => void;
  setAttention: (id: string) => void;
  clearAttention: (id: string) => void;
}

export const useRuntime = create<RuntimeState>((set) => ({
  status: {},
  epoch: {},
  attention: {},
  setStatus: (id, status) => set((s) => ({ status: { ...s.status, [id]: status } })),
  clearStatus: (id) =>
    set((s) => {
      // Session is gone: drop its status AND its restart epoch (unbounded otherwise).
      const status = { ...s.status };
      const epoch = { ...s.epoch };
      const attention = { ...s.attention };
      delete status[id];
      delete epoch[id];
      delete attention[id];
      return { status, epoch, attention };
    }),
  bumpEpoch: (id) => set((s) => ({ epoch: { ...s.epoch, [id]: (s.epoch[id] ?? 0) + 1 } })),
  setAttention: (id) =>
    set((s) => (s.attention[id] ? s : { attention: { ...s.attention, [id]: true } })),
  clearAttention: (id) =>
    set((s) => {
      if (!s.attention[id]) return s;
      const attention = { ...s.attention };
      delete attention[id];
      return { attention };
    }),
}));
