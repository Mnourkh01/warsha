// One user turn: spawn the headless CLI, stream parsed markdown into the assistant
// message, keep the status dot honest, badge the pane when it finishes unwatched.

import { agentCancel, agentSend } from "../../lib/ipc";
import { strings } from "../../lib/i18n";
import { useChat } from "../../store/chat";
import { useRuntime } from "../../store/runtime";
import { useWorkspaces } from "../../store/workspaces";
import { noteAgentDone } from "../terminal/attention";
import { createParser } from "./parser";

export async function sendChatMessage(sessionId: string, prompt: string): Promise<void> {
  const session = useWorkspaces.getState().sessions[sessionId];
  const agent = session?.agent;
  const text = prompt.trim();
  if (!agent || !text) return;

  const chat = useChat.getState();
  if (chat.streaming[sessionId]) return;

  chat.append(sessionId, { role: "user", text });
  const assistantId = chat.append(sessionId, { role: "assistant", text: "" });
  chat.setStreaming(sessionId, true);
  useRuntime.getState().setStatus(sessionId, "running");

  const parse = createParser(agent);
  try {
    await agentSend(
      {
        id: sessionId,
        agent,
        prompt: text,
        resume: useChat.getState().resume[sessionId],
        cwd: session.cwd,
      },
      (chunk) => {
        const state = useChat.getState();
        for (const ev of parse(chunk)) {
          if (ev.resume) state.setResume(sessionId, ev.resume);
          if (ev.delta) state.appendText(sessionId, assistantId, ev.delta);
        }
      },
    );
  } catch (err) {
    const state = useChat.getState();
    const raw = String(err);
    const msg = raw.startsWith("agent_missing")
      ? strings().chatAgentMissing(agent)
      : raw === "agent_cancelled"
        ? strings().chatStopped
        : strings().chatFailed(raw);
    // Keep any partial text the CLI managed to stream before dying.
    const partial = state.messages[sessionId]?.find((m) => m.id === assistantId)?.text ?? "";
    state.markError(sessionId, assistantId, partial ? `${partial}\n\n${msg}` : msg);
  } finally {
    const state = useChat.getState();
    state.setStreaming(sessionId, false);
    // The session may have been closed mid-stream; do not resurrect its status.
    if (useWorkspaces.getState().sessions[sessionId]) {
      useRuntime.getState().setStatus(sessionId, "idle");
      noteAgentDone(sessionId);
    }
  }
}

export async function stopChatMessage(sessionId: string): Promise<void> {
  try {
    await agentCancel(sessionId);
  } catch (err) {
    console.warn(`agent cancel failed for ${sessionId}`, err);
  }
}
