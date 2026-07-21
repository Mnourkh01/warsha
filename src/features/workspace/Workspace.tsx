import { Fragment } from "react";
import { SquareTerminal } from "lucide-react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { paneRows, useWorkspaces } from "../../store/workspaces";
import { Pane } from "./Pane";

const FILL = { height: "100%", width: "100%" } as const;

export function Workspace() {
  const ids = useWorkspaces((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    return ws ? ws.sessionIds : [];
  });
  const rows = paneRows(ids);

  if (ids.length === 0) {
    return (
      <div className="workspace">
        <div className="workspace-empty">
          <SquareTerminal size={26} />
          <div>
            This workspace is empty.
            <br />
            Press <kbd>Ctrl K</kbd> or the <b>+</b> button to start a session.
          </div>
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
