import { Maximize2, Minimize2, X } from "lucide-react";
import { useWorkspaces } from "../../store/workspaces";
import { useRuntime } from "../../store/runtime";
import { useUI } from "../../store/ui";
import { TerminalView } from "../terminal/TerminalView";
import { FindBar } from "../terminal/FindBar";
import { closeSession, openSession } from "../../actions";
import { SessionIcon } from "../icons";

const STATUS_LABELS: Record<string, string> = {
  running: "Running",
  exited: "Exited",
  idle: "Idle",
};

export function Pane({ sessionId }: { sessionId: string }) {
  const session = useWorkspaces((s) => s.sessions[sessionId]);
  const active = useWorkspaces((s) => s.activeSessionId === sessionId);
  const status = useRuntime((s) => s.status[sessionId]);
  const attention = useRuntime((s) => Boolean(s.attention[sessionId]));
  const maximized = useUI((s) => s.maximizedSessionId === sessionId);
  const findOpen = useUI((s) => s.findOpen && active);

  if (!session) return null;

  const statusLabel = STATUS_LABELS[status ?? "idle"];

  return (
    <div className={`pane${active ? " active" : ""}`} onMouseDown={() => openSession(sessionId)}>
      <div className="pane-header">
        <SessionIcon typeId={session.typeId} size={18} />
        <span
          className={`status-dot ${status ?? "idle"}`}
          role="img"
          aria-label={statusLabel}
          title={statusLabel}
        />
        <span className="pane-title bidi-auto">{session.name}</span>
        {attention && (
          <span
            className="attention-dot"
            role="img"
            aria-label="Needs attention"
            title="Finished or waiting for input"
          />
        )}
        <span className="pane-actions">
          <button
            className="icon-btn sm"
            title={maximized ? "Restore pane (Ctrl+Shift+M)" : "Maximize pane (Ctrl+Shift+M)"}
            aria-label={maximized ? `Restore ${session.name}` : `Maximize ${session.name}`}
            onClick={(e) => {
              e.stopPropagation();
              useUI.getState().toggleMaximized(sessionId);
            }}
          >
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            className="icon-btn sm"
            title="Close session"
            aria-label={`Close ${session.name}`}
            onClick={(e) => {
              e.stopPropagation();
              closeSession(sessionId);
            }}
          >
            <X size={14} />
          </button>
        </span>
      </div>
      <div className="pane-body">
        {findOpen && <FindBar sessionId={sessionId} />}
        <TerminalView sessionId={sessionId} active={active} />
      </div>
    </div>
  );
}
