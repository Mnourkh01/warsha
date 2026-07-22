import { create } from "zustand";
import { uid } from "../lib/id";

// Per-chat-session conversation state. NOT persisted in v1: a restart restores the
// chat session itself (from the workspace blob) with an empty transcript; Claude's own
// --resume id is runtime-only. Kept separate from workspaces so terminal sessions pay
// nothing for it.

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Attached image filenames (display only) for a user turn. */
  images?: string[];
  /** True when this bubble is an error notice, styled accordingly. */
  error?: boolean;
}

interface ChatState {
  messages: Record<string, ChatMessage[]>;
  streaming: Record<string, boolean>;
  /** Provider conversation id (Claude session id) to resume the next turn with. */
  resume: Record<string, string>;
  append: (sessionId: string, msg: Omit<ChatMessage, "id">) => string;
  appendText: (sessionId: string, messageId: string, delta: string) => void;
  markError: (sessionId: string, messageId: string, text: string) => void;
  setStreaming: (sessionId: string, on: boolean) => void;
  setResume: (sessionId: string, resumeId: string) => void;
  clear: (sessionId: string) => void;
}

export const useChat = create<ChatState>((set) => ({
  messages: {},
  streaming: {},
  resume: {},

  append: (sessionId, msg) => {
    const id = uid();
    set((s) => ({
      messages: {
        ...s.messages,
        [sessionId]: [...(s.messages[sessionId] ?? []), { ...msg, id }],
      },
    }));
    return id;
  },

  appendText: (sessionId, messageId, delta) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [sessionId]: (s.messages[sessionId] ?? []).map((m) =>
          m.id === messageId ? { ...m, text: m.text + delta } : m,
        ),
      },
    })),

  markError: (sessionId, messageId, text) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [sessionId]: (s.messages[sessionId] ?? []).map((m) =>
          m.id === messageId ? { ...m, text, error: true } : m,
        ),
      },
    })),

  setStreaming: (sessionId, on) =>
    set((s) => ({ streaming: { ...s.streaming, [sessionId]: on } })),

  setResume: (sessionId, resumeId) =>
    set((s) => ({ resume: { ...s.resume, [sessionId]: resumeId } })),

  clear: (sessionId) =>
    set((s) => {
      const messages = { ...s.messages };
      const streaming = { ...s.streaming };
      const resume = { ...s.resume };
      delete messages[sessionId];
      delete streaming[sessionId];
      delete resume[sessionId];
      return { messages, streaming, resume };
    }),
}));
