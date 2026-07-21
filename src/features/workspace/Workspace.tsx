import { Fragment } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { paneRows, useLayout } from "../../store/layout";
import { Pane } from "./Pane";

const FILL = { height: "100%", width: "100%" } as const;

export function Workspace() {
  const panes = useLayout((s) => s.panes);
  const rows = paneRows(panes);

  return (
    <div className="workspace">
      <Group orientation="vertical" style={FILL}>
        {rows.map((row, ri) => (
          <Fragment key={`row-${ri}`}>
            {ri > 0 && <Separator className="rh-h" />}
            <Panel id={`row-${ri}`} minSize="15" defaultSize={`${100 / rows.length}`}>
              <Group orientation="horizontal" style={FILL}>
                {row.map((p, ci) => (
                  <Fragment key={p.id}>
                    {ci > 0 && <Separator className="rh-v" />}
                    <Panel id={p.id} minSize="12" defaultSize={`${100 / row.length}`}>
                      <Pane paneId={p.id} sessionId={p.sessionId} />
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
