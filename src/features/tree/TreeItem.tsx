import { useEffect, useRef, useState } from "react";
import { ChevronDown, Folder, FolderPlus, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { GroupNode, NodeId, SessionNode } from "../../lib/types";
import { useTree } from "../../store/tree";
import { useRuntime } from "../../store/runtime";
import { deleteNode, newSession, openSession, restartSession } from "../../actions";
import { SessionIcon } from "../icons";

const DND_TYPE = "text/warsha-node";

function handleDrop(srcId: string, targetId: NodeId) {
  const st = useTree.getState();
  if (!srcId || srcId === targetId) return;
  const target = st.nodes[targetId];
  if (!target) return;
  if (target.type === "group") {
    st.move(srcId, targetId, target.children.length);
  } else {
    const parentId = target.parentId;
    const sibs = parentId ? (st.nodes[parentId] as GroupNode).children : st.rootIds;
    const idx = sibs.indexOf(targetId);
    st.move(srcId, parentId, idx + 1);
  }
}

export function TreeItem({
  id,
  depth,
  activeSessionId,
}: {
  id: NodeId;
  depth: number;
  activeSessionId: NodeId | null;
}) {
  const node = useTree((s) => s.nodes[id]);
  const toggleCollapse = useTree((s) => s.toggleCollapse);
  const rename = useTree((s) => s.rename);
  const status = useRuntime((s) => s.status[id]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [dropInto, setDropInto] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (!node) return null;
  const isGroup = node.type === "group";
  const isSelected = !isGroup && id === activeSessionId;

  const startRename = () => {
    setDraft(node.name);
    setEditing(true);
  };
  const commitRename = () => {
    const name = draft.trim();
    if (name) rename(id, name);
    setEditing(false);
  };

  const onRowClick = () => {
    if (editing) return;
    if (isGroup) toggleCollapse(id);
    else openSession(id);
  };

  return (
    <div>
      <div
        className={`tree-row${isSelected ? " selected" : ""}${dropInto ? " drop-into" : ""}`}
        style={{ paddingInlineStart: 6 + depth * 14 }}
        onClick={onRowClick}
        draggable={!editing}
        onDragStart={(e) => {
          e.dataTransfer.setData(DND_TYPE, id);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDropInto(true);
        }}
        onDragLeave={() => setDropInto(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDropInto(false);
          handleDrop(e.dataTransfer.getData(DND_TYPE), id);
        }}
        title={node.name}
      >
        {isGroup ? (
          <span className={`twist${(node as GroupNode).collapsed ? " collapsed" : ""}`}>
            <ChevronDown size={14} />
          </span>
        ) : (
          <span className="twist" />
        )}

        {isGroup ? (
          <span className="row-icon">
            <Folder size={14} />
          </span>
        ) : (
          <SessionIcon typeId={(node as SessionNode).typeId} size={18} />
        )}

        {!isGroup && <span className={`status-dot ${status ?? "idle"}`} />}

        {editing ? (
          <input
            ref={inputRef}
            className="rename-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setEditing(false);
            }}
            autoFocus
          />
        ) : (
          <span className="name bidi-auto">{node.name}</span>
        )}

        {!editing && (
          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
            {isGroup ? (
              <>
                <button
                  className="icon-btn sm"
                  title="New session here"
                  onClick={() => newSession({ parentId: id })}
                >
                  <Plus size={13} />
                </button>
                <button
                  className="icon-btn sm"
                  title="New group here"
                  onClick={() => useTree.getState().addGroup(id)}
                >
                  <FolderPlus size={13} />
                </button>
              </>
            ) : (
              <button className="icon-btn sm" title="Restart" onClick={() => restartSession(id)}>
                <RotateCcw size={13} />
              </button>
            )}
            <button className="icon-btn sm" title="Rename" onClick={startRename}>
              <Pencil size={13} />
            </button>
            <button className="icon-btn sm" title="Delete" onClick={() => deleteNode(id)}>
              <Trash2 size={13} />
            </button>
          </span>
        )}
      </div>

      {isGroup && !(node as GroupNode).collapsed && (
        <div>
          {(node as GroupNode).children.map((childId) => (
            <TreeItem
              key={childId}
              id={childId}
              depth={depth + 1}
              activeSessionId={activeSessionId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
