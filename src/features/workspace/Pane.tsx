import { X } from "lucide-react";
import { useWorkspaces } from "../../store/workspaces";
import { useRuntime } from "../../store/runtime";
import { TerminalView } from "../terminal/TerminalView";
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
        <span className="pane-actions">
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
        <TerminalView sessionId={sessionId} active={active} />
      </div>
    </div>
  );
}
