import { Fragment, useState } from "react";
import { SquareTerminal } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { paneRows, useWorkspaces } from "../../store/workspaces";
import { useSettings } from "../../store/settings";
import { useUI } from "../../store/ui";
import { newSession } from "../../actions";
import { whichProgram } from "../../lib/ipc";
import { SESSION_TYPES } from "../../lib/sessionTypes";
import { SessionIcon } from "../icons";
import { Pane } from "./Pane";
import { useStrings } from "../../lib/i18n";

const FILL = { height: "100%", width: "100%" } as const;

/** Launch Claude Code in the default folder if the CLI exists; otherwise fall back to
 *  the new-session dialog, which shows the install command. */
function StartClaudeButton() {
  const [busy, setBusy] = useState(false);
  const t = useStrings();
  const start = async () => {
    const claude = SESSION_TYPES.find((t) => t.id === "claude");
    if (!claude) return;
    setBusy(true);
    try {
      const found = claude.probe ? await whichProgram(claude.probe) : "ok";
      if (found) {
        newSession({
          shell: claude.shell,
          name: claude.label,
          cwd: useSettings.getState().defaultCwd || undefined,
          typeId: claude.id,
        });
        return;
      }
    } catch (e) {
      console.warn("claude probe failed", e);
    } finally {
      setBusy(false);
    }
    useUI.getState().setNewSession(true);
  };
  return (
    <button className="empty-cta" disabled={busy} onClick={() => void start()}>
      <SessionIcon typeId="claude" size={16} />
      {t.startClaudeHere}
    </button>
  );
}

export function Workspace() {
  const ids = useWorkspaces((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    return ws ? ws.sessionIds : [];
  });
  const maximizedId = useUI((s) => s.maximizedSessionId);
  const rows = paneRows(ids);
  const t = useStrings();

  if (ids.length === 0) {
    return (
      <div className="workspace">
        <div className="workspace-empty">
          <SquareTerminal size={26} />
          <div>
            {t.emptyWorkspaceTitle}
            <br />
            {t.emptyHintPress} <kbd>Ctrl K</kbd> {t.emptyHintOr} <b>+</b> {t.emptyHintEnd}
          </div>
          <StartClaudeButton />
        </div>
      </div>
    );
  }

  // Maximized view: one pane fills the grid. The other panes unmount, which only
  // detaches their terminals; PTYs and buffers keep running in the registry (same
  // model as switching workspaces).
  if (maximizedId && ids.includes(maximizedId)) {
    return (
      <div className="workspace">
        <div style={FILL}>
          <Pane sessionId={maximizedId} />
        </div>
      </div>
    );
  }

  return (
    <div className="workspace">
      <Group orientation="vertical" style={FILL}>
        {rows.map((row, ri) => (
          <Fragment key={`row-${ri}`}>
            {ri > 0 && <Separator className="rh-h" />}
            <Panel id={`row-${ri}`} minSize="15" defaultSize={`${100 / rows.length}`}>
              <Group orientation="horizontal" style={FILL}>
                {row.map((id, ci) => (
                  <Fragment key={id}>
                    {ci > 0 && <Separator className="rh-v" />}
                    <Panel id={id} minSize="12" defaultSize={`${100 / row.length}`}>
                      <Pane sessionId={id} />
                    </Panel>
                  </Fragment>
                ))}
              </Group>
            </Panel>
          </Fragment>
        ))}
      </Group>
    </div>
  );
}
