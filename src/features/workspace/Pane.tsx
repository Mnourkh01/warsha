import { FolderInput, Maximize2, Minimize2, RadioTower, X } from "lucide-react";
import { useWorkspaces } from "../../store/workspaces";
import { useRuntime } from "../../store/runtime";
import { useUI } from "../../store/ui";
import { TerminalView } from "../terminal/TerminalView";
import { FindBar } from "../terminal/FindBar";
import { changeSessionFolder, closeSession, openSession } from "../../actions";
import { tintClasses } from "../../lib/tints";
import { pickFolder } from "../../lib/ipc";
import { SessionIcon } from "../icons";
import { useStrings } from "../../lib/i18n";

export function Pane({ sessionId }: { sessionId: string }) {
  const session = useWorkspaces((s) => s.sessions[sessionId]);
  const active = useWorkspaces((s) => s.activeSessionId === sessionId);
  const status = useRuntime((s) => s.status[sessionId]);
  const attention = useRuntime((s) => Boolean(s.attention[sessionId]));
  const maximized = useUI((s) => s.maximizedSessionId === sessionId);
  const findOpen = useUI((s) => s.findOpen && active);
  // The grid only renders the active workspace, so every visible pane broadcasts.
  const broadcast = useUI((s) => s.broadcast);
  const t = useStrings();

  if (!session) return null;

  const statusLabel =
    status === "running" ? t.statusRunning : status === "exited" ? t.statusExited : t.statusIdle;

  const changeFolder = async () => {
    try {
      const dir = await pickFolder(t.changeFolderTitle(session.name));
      if (dir) changeSessionFolder(sessionId, dir);
    } catch (e) {
      console.warn("folder picker failed", e);
    }
  };

  return (
    <div
      className={`pane${active ? " active" : ""}${tintClasses(session.tint)}`}
      onMouseDown={() => openSession(sessionId)}
    >
      <div className="pane-header">
        <SessionIcon typeId={session.typeId} size={18} />
        <span
          className={`status-dot ${status ?? "idle"}`}
          role="img"
          aria-label={statusLabel}
          title={statusLabel}
        />
        <span className="pane-title bidi-auto">{session.name}</span>
        {broadcast && (
          <span className="broadcast-chip" role="status" title={t.broadcastChipTitle}>
            <RadioTower size={11} />
            {t.broadcastChip}
          </span>
        )}
        {attention && (
          <span
            className="attention-dot"
            role="img"
            aria-label={t.needsAttention}
            title={t.attentionHint}
          />
        )}
        <span className="pane-actions">
          <button
            className="icon-btn sm"
            title={t.changeFolder}
            aria-label={t.changeFolderNamed(session.name)}
            onClick={(e) => {
              e.stopPropagation();
              void changeFolder();
            }}
          >
            <FolderInput size={14} />
          </button>
          <button
            className="icon-btn sm"
            title={maximized ? t.restorePane : t.maximizePane}
            aria-label={maximized ? t.restoreNamed(session.name) : t.maximizeNamed(session.name)}
            onClick={(e) => {
              e.stopPropagation();
              useUI.getState().toggleMaximized(sessionId);
            }}
          >
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button
            className="icon-btn sm"
            title={t.closeSession}
            aria-label={t.closeNamed(session.name)}
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
