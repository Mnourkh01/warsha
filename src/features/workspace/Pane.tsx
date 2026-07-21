import { useState } from "react";
import { Columns2, Rows2, SquareTerminal, X } from "lucide-react";
import type { NodeId } from "../../lib/types";
import { useLayout } from "../../store/layout";
import { useTree } from "../../store/tree";
import { useRuntime } from "../../store/runtime";
import { TerminalView } from "../terminal/TerminalView";
import { closePaneAction, openSessionInPane } from "../../actions";
import { SessionIcon } from "../icons";

const DND_TYPE = "text/warsha-node";

export function Pane({ paneId, sessionId }: { paneId: string; sessionId: NodeId | null }) {
  const active = useLayout((s) => s.activePaneId === paneId);
  const focusPane = useLayout((s) => s.focusPane);
  const splitPane = useLayout((s) => s.splitPane);
  const node = useTree((s) => (sessionId ? s.nodes[sessionId] : undefined));
  const status = useRuntime((s) => (sessionId ? s.status[sessionId] : undefined));
  const name = node && node.type === "session" ? node.name : null;
  const [dropActive, setDropActive] = useState(false);

  return (
    <div
      className={`pane${active ? " active" : ""}${dropActive ? " drop-target" : ""}`}
      onMouseDown={() => focusPane(paneId)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DND_TYPE)) {
          e.preventDefault();
          setDropActive(true);
        }
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        setDropActive(false);
        const src = e.dataTransfer.getData(DND_TYPE);
        if (!src) return;
        const dropped = useTree.getState().nodes[src];
        if (dropped && dropped.type === "session") {
          e.preventDefault();
          openSessionInPane(src, paneId);
        }
      }}
    >
      <div className="pane-header">
        <SessionIcon typeId={node && node.type === "session" ? node.typeId : undefined} size={18} />
        {name !== null ? (
          <>
            <span className={`status-dot ${status ?? "idle"}`} />
            <span className="pane-title bidi-auto">{name}</span>
          </>
        ) : (
          <span className="pane-title" style={{ color: "var(--text-faint)" }}>
            Empty pane
          </span>
        )}
        <span className="pane-actions">
          <button
            className="icon-btn sm"
            title="Split right"
            onClick={(e) => {
              e.stopPropagation();
              splitPane(paneId, "row");
            }}
          >
            <Columns2 size={14} />
          </button>
          <button
            className="icon-btn sm"
            title="Split down"
            onClick={(e) => {
              e.stopPropagation();
              splitPane(paneId, "col");
            }}
          >
            <Rows2 size={14} />
          </button>
          <button
            className="icon-btn sm"
            title="Close pane"
            onClick={(e) => {
              e.stopPropagation();
              closePaneAction(paneId);
            }}
          >
            <X size={14} />
          </button>
        </span>
      </div>
      <div className="pane-body">
        {sessionId ? (
          <TerminalView sessionId={sessionId} active={active} />
        ) : (
          <div className="pane-empty">
            <SquareTerminal size={22} />
            <div>
              Open a session from the tree,
              <br />
              or press <kbd>Ctrl K</kbd>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
