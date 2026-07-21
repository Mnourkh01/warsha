import type { ReactElement } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { useLayout } from "../../store/layout";
import type { PaneNode } from "../../lib/types";
import { Pane } from "./Pane";

const FILL = { height: "100%", width: "100%" } as const;

function render(node: PaneNode): ReactElement {
  if (node.type === "leaf") {
    return <Pane key={node.id} paneId={node.id} sessionId={node.sessionId} />;
  }
  return (
    <Group
      key={node.id}
      id={node.id}
      orientation={node.dir === "row" ? "horizontal" : "vertical"}
      style={FILL}
    >
      <Panel id={`${node.id}-a`} minSize="12" defaultSize="50">
        {render(node.a)}
      </Panel>
      <Separator className={node.dir === "row" ? "rh-v" : "rh-h"} />
      <Panel id={`${node.id}-b`} minSize="12" defaultSize="50">
        {render(node.b)}
      </Panel>
    </Group>
  );
}

export function Workspace() {
  const root = useLayout((s) => s.root);
  return <div className="workspace">{render(root)}</div>;
}
