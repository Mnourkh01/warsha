import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SendHorizontal, Square } from "lucide-react";
import { useChat, type ChatMessage } from "../../store/chat";
import { useWorkspaces } from "../../store/workspaces";
import { useStrings } from "../../lib/i18n";
import { sendChatMessage, stopChatMessage } from "./send";

// Stable fallback: a selector returning a fresh [] every call re-renders forever
// (React "getSnapshot should be cached" - it took the whole app down on boot).
const NO_MESSAGES: ChatMessage[] = [];

// The chat pane is the Arabic reading surface: every block auto-directions itself
// (CSS unicode-bidi: plaintext), so Arabic answers flow RTL while code stays LTR.
export function ChatPane({ sessionId }: { sessionId: string }) {
  const session = useWorkspaces((s) => s.sessions[sessionId]);
  const messages = useChat((s) => s.messages[sessionId] ?? NO_MESSAGES);
  const streaming = useChat((s) => Boolean(s.streaming[sessionId]));
  const t = useStrings();
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Follow the stream only while the user is already at the bottom; never yank the
  // scroll position away from someone reading an earlier answer.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (!session) return null;
  const label = session.name;

  const send = () => {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft("");
    stickToBottom.current = true;
    void sendChatMessage(sessionId, text);
  };

  return (
    <div className="chat-pane">
      <div
        className="chat-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {messages.length === 0 && <div className="chat-empty">{t.chatEmpty(label)}</div>}
        {messages.map((m) => (
          <div
            key={m.id}
            className={`chat-msg ${m.role}${m.error ? " error" : ""}`}
            dir="auto"
          >
            {m.role === "assistant" ? (
              m.text ? (
                <div className="chat-md">
                  <Markdown remarkPlugins={[remarkGfm]}>{m.text}</Markdown>
                </div>
              ) : (
                <span className="chat-thinking">{t.chatThinking}</span>
              )
            ) : (
              m.text
            )}
          </div>
        ))}
      </div>
      <div className="chat-input-row">
        <textarea
          className="chat-input"
          dir="auto"
          rows={1}
          value={draft}
          placeholder={t.chatPlaceholder(label)}
          aria-label={t.chatPlaceholder(label)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {streaming ? (
          <button
            className="icon-btn chat-send"
            title={t.chatStop}
            aria-label={t.chatStop}
            onClick={() => void stopChatMessage(sessionId)}
          >
            <Square size={15} />
          </button>
        ) : (
          <button
            className="icon-btn chat-send"
            title={t.chatSend}
            aria-label={t.chatSend}
            disabled={!draft.trim()}
            onClick={send}
          >
            <SendHorizontal size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
