import { Eraser, FoldVertical, FolderInput, Maximize2, Minimize2, RadioTower, X } from "lucide-react";
import { useWorkspaces } from "../../store/workspaces";
import { useRuntime } from "../../store/runtime";
import { useUI } from "../../store/ui";
import { TerminalView } from "../terminal/TerminalView";
import { FindBar } from "../terminal/FindBar";
import { changeSessionFolder, closeSession, openSession } from "../../actions";
import { getTerminal } from "../terminal/controller";
import { tintClasses } from "../../lib/tints";
import { confirmDialog, pickFolder, ptyWrite } from "../../lib/ipc";
import { AI_CONTEXT_COMMANDS } from "../../lib/sessionTypes";
import { SessionIcon } from "../icons";
import { useStrings } from "../../lib/i18n";

export function Pane({ sessionId }: { sessionId: string }) {
  const session = useWorkspaces((s) => s.sessions[sessionId]);
  const active = useWorkspaces((s) => s.activeSessionId === sessionId);
  // Maximize is pointless with a single pane (it already fills the grid); hide it.
  const solo = useWorkspaces((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    return (ws?.sessionIds.length ?? 0) <= 1;
  });
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

  // Context-management buttons, only on sessions Warsha started with a known AI CLI
  // and only while the process runs. The command is TYPED into the session (plus
  // Enter); if the CLI died back to the shell, a stray "/clear" is a harmless
  // unknown-command error - nothing here executes real shell logic.
  const aiCmd =
    session.typeId && session.typeId in AI_CONTEXT_COMMANDS
      ? AI_CONTEXT_COMMANDS[session.typeId as keyof typeof AI_CONTEXT_COMMANDS]
      : undefined;
  const typeAiCommand = async (command: string, confirmText?: string) => {
    if (confirmText && !(await confirmDialog(confirmText).catch(() => false))) return;
    try {
      await ptyWrite(sessionId, `${command}\r`);
      getTerminal(sessionId)?.focus();
    } catch (e) {
      console.warn(`ai command ${command} failed for session ${sessionId}`, e);
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
          {aiCmd && status === "running" && (
            <>
              <button
                className="icon-btn sm"
                title={t.aiCompactTitle(aiCmd.compact)}
                aria-label={t.aiCompactTitle(aiCmd.compact)}
                onClick={(e) => {
                  e.stopPropagation();
                  void typeAiCommand(aiCmd.compact);
                }}
              >
                <FoldVertical size={14} />
              </button>
              <button
                className="icon-btn sm"
                title={t.aiClearTitle(aiCmd.clear)}
                aria-label={t.aiClearTitle(aiCmd.clear)}
                onClick={(e) => {
                  e.stopPropagation();
                  void typeAiCommand(aiCmd.clear, t.aiClearConfirm(session.name));
                }}
              >
                <Eraser size={14} />
              </button>
            </>
          )}
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
          {!solo && (
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
          )}
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
