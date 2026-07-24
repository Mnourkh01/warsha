import { create } from "zustand";
import type { SessionStatus } from "../lib/types";

// Live per-session status + a restart epoch. NOT persisted.
interface RuntimeState {
  status: Record<string, SessionStatus>;
  /** Bumping a session's epoch remounts its TerminalView (used to restart it). */
  epoch: Record<string, number>;
  /** Background sessions that finished output or exited and want the user's eyes. */
  attention: Record<string, true>;
  /** AI CLI detected running inside each session right now ("claude" | "gemini" |
   *  "codex"), from the session_ai_probe poll. Missing key = plain shell. */
  detectedAi: Record<string, string>;
  setStatus: (id: string, status: SessionStatus) => void;
  clearStatus: (id: string) => void;
  bumpEpoch: (id: string) => void;
  setAttention: (id: string) => void;
  clearAttention: (id: string) => void;
  setDetectedAi: (list: { sessionId: string; ai: string | null }[]) => void;
}

export const useRuntime = create<RuntimeState>((set) => ({
  status: {},
  epoch: {},
  attention: {},
  detectedAi: {},
  setStatus: (id, status) => set((s) => ({ status: { ...s.status, [id]: status } })),
  clearStatus: (id) =>
    set((s) => {
      // Session is gone: drop its status AND its restart epoch (unbounded otherwise).
      const status = { ...s.status };
      const epoch = { ...s.epoch };
      const attention = { ...s.attention };
      const detectedAi = { ...s.detectedAi };
      delete status[id];
      delete epoch[id];
      delete attention[id];
      delete detectedAi[id];
      return { status, epoch, attention, detectedAi };
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
  setDetectedAi: (list) =>
    set((s) => {
      // Rebuild from the probe, but keep the SAME object when nothing changed so the
      // 5s poll never causes a render.
      const next: Record<string, string> = {};
      for (const { sessionId, ai } of list) if (ai) next[sessionId] = ai;
      const prevKeys = Object.keys(s.detectedAi);
      const same =
        prevKeys.length === Object.keys(next).length &&
        prevKeys.every((k) => s.detectedAi[k] === next[k]);
      return same ? s : { detectedAi: next };
    }),
}));
