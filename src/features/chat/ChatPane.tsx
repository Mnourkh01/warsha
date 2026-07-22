import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SendHorizontal, Square, ImagePlus, X, Paperclip } from "lucide-react";
import { useChat, type ChatMessage } from "../../store/chat";
import { useWorkspaces } from "../../store/workspaces";
import { useStrings } from "../../lib/i18n";
import { pickImages, stageChatImage, type StagedImage } from "../../lib/ipc";
import { sendChatMessage, stopChatMessage } from "./send";
import { registerChatDrop } from "./imageDrop";

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
  const [attachments, setAttachments] = useState<StagedImage[]>([]);
  const [attachError, setAttachError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Only Claude Code can see attached images in headless mode (verified); hide the whole
  // attach affordance for other agents so nothing looks broken.
  const supportsImages = session?.agent === "claude";

  // Follow the stream only while the user is already at the bottom; never yank the
  // scroll position away from someone reading an earlier answer.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Copy a source image into the app cache, then attach the staged path. One failure
  // (too large, unsupported type) is reported without dropping the successes.
  const attachPaths = async (paths: string[]) => {
    setAttachError("");
    for (const src of paths) {
      try {
        const staged = await stageChatImage(src);
        setAttachments((prev) => [...prev, staged]);
      } catch (err) {
        setAttachError(t.chatAttachFailed(String(err)));
      }
    }
  };

  // Register this pane as an OS-file-drop target (Claude sessions only).
  useEffect(() => {
    if (!supportsImages) return;
    return registerChatDrop(sessionId, {
      setOver: setDragOver,
      onDrop: (paths) => void attachPaths(paths),
    });
    // attachPaths is stable enough for this effect; re-registering per keystroke is wrong.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, supportsImages]);

  if (!session) return null;
  const label = session.name;

  const pickAndAttach = async () => {
    const paths = await pickImages(t.chatAttachTitle);
    if (paths.length) await attachPaths(paths);
  };

  const removeAttachment = (path: string) =>
    setAttachments((prev) => prev.filter((a) => a.path !== path));

  const canSend = (draft.trim().length > 0 || attachments.length > 0) && !streaming;

  const send = () => {
    if (!canSend) return;
    const text = draft.trim();
    const images = attachments;
    setDraft("");
    setAttachments([]);
    setAttachError("");
    stickToBottom.current = true;
    void sendChatMessage(sessionId, text, images);
  };

  return (
    <div className="chat-pane" data-chat-drop={supportsImages ? sessionId : undefined}>
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
            {m.images && m.images.length > 0 && (
              <div className="chat-msg-images">
                {m.images.map((name, i) => (
                  <span className="chat-img-tag" key={`${m.id}-${i}`} dir="auto">
                    <Paperclip size={12} />
                    {name}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {dragOver && (
        <div className="chat-drop-overlay">
          <ImagePlus size={22} />
          <span>{t.chatDropHint}</span>
        </div>
      )}

      {attachError && <div className="chat-attach-error">{attachError}</div>}

      {attachments.length > 0 && (
        <div className="chat-attachments">
          {attachments.map((a) => (
            <span className="chat-chip" key={a.path} dir="auto">
              <ImagePlus size={13} />
              <span className="chat-chip-name">{a.name}</span>
              <button
                className="chat-chip-remove"
                title={t.chatRemoveImage}
                aria-label={t.chatRemoveImage}
                onClick={() => removeAttachment(a.path)}
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="chat-input-row">
        {supportsImages && (
          <button
            className="icon-btn chat-attach"
            title={t.chatAttachImage}
            aria-label={t.chatAttachImage}
            onClick={() => void pickAndAttach()}
          >
            <ImagePlus size={16} />
          </button>
        )}
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
            disabled={!canSend}
            onClick={send}
          >
            <SendHorizontal size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
