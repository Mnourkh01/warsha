import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  FolderPlus,
  Hammer,
  Layers,
  Moon,
  PanelLeftClose,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { MAX_PER_WS, useWorkspaces, type Workspace } from "../../store/workspaces";
import { useRuntime } from "../../store/runtime";
import { useSettings } from "../../store/settings";
import { useUI } from "../../store/ui";
import { resolveTheme } from "../../lib/theme";
import { confirmDialog } from "../../lib/ipc";
import {
  closeSession,
  deleteWorkspace,
  newWorkspace,
  openSession,
  restartSession,
  switchWorkspace,
} from "../../actions";
import { SessionIcon } from "../icons";

const DND = "text/warsha-session";

export function SessionTree() {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaces((s) => s.activeWorkspaceId);
  const activeSessionId = useWorkspaces((s) => s.activeSessionId);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const setSettings = useUI((s) => s.setSettings);
  const setNewSession = useUI((s) => s.setNewSession);
  const setSidebar = useUI((s) => s.setSidebar);
  const resolved = resolveTheme(theme);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="brand">
          <span className="brand-mark">
            <Hammer size={16} />
          </span>
          Warsha
        </span>
        <span className="spacer" />
        <button
          className="icon-btn"
          title="New workspace"
          aria-label="New workspace"
          onClick={() => newWorkspace()}
        >
          <FolderPlus size={16} />
        </button>
        <button
          className="icon-btn"
          title="New session"
          aria-label="New session"
          onClick={() => setNewSession(true)}
        >
          <Plus size={16} />
        </button>
        <button
          className="icon-btn"
          title="Toggle theme"
          aria-label="Toggle light or dark theme"
          onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
        >
          {resolved === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          className="icon-btn"
          title="Settings"
          aria-label="Settings"
          onClick={() => setSettings(true)}
        >
          <Settings size={16} />
        </button>
        <button
          className="icon-btn"
          title="Hide sidebar (Ctrl+Shift+B)"
          aria-label="Hide sidebar"
          onClick={() => setSidebar(false)}
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      <div className="tree">
        {workspaces.map((ws) => (
          <WorkspaceItem
            key={ws.id}
            ws={ws}
            active={ws.id === activeWorkspaceId}
            activeSessionId={activeSessionId}
          />
        ))}
        {workspaces.every((w) => w.sessionIds.length === 0) && (
          <div className="tree-empty">
            No sessions yet. Press the + button above, or Ctrl K, to open your first
            terminal.
          </div>
        )}
      </div>
    </aside>
  );
}

function WorkspaceItem({
  ws,
  active,
  activeSessionId,
}: {
  ws: Workspace;
  active: boolean;
  activeSessionId: string | null;
}) {
  const rename = useWorkspaces((s) => s.renameWorkspace);
  const moveToWs = useWorkspaces((s) => s.moveSessionToWorkspace);
  const setNewSession = useUI((s) => s.setNewSession);
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(ws.name);
  const [dropInto, setDropInto] = useState(false);
  const full = ws.sessionIds.length >= MAX_PER_WS;

  const commit = () => {
    const name = draft.trim();
    if (name) rename(ws.id, name);
    setEditing(false);
  };

  return (
    <div>
      <div
        className={`tree-row ws-row${active ? " active-ws" : ""}${dropInto ? " drop-into" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => switchWorkspace(ws.id)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            switchWorkspace(ws.id);
          }
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(DND)) {
            e.preventDefault();
            setDropInto(true);
          }
        }}
        onDragLeave={() => setDropInto(false)}
        onDrop={(e) => {
          setDropInto(false);
          const src = e.dataTransfer.getData(DND);
          if (src) {
            e.preventDefault();
            moveToWs(src, ws.id);
          }
        }}
      >
        <span
          className={`twist${collapsed ? " collapsed" : ""}`}
          role="button"
          tabIndex={0}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand workspace" : "Collapse workspace"}
          onClick={(e) => {
            e.stopPropagation();
            setCollapsed((c) => !c);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setCollapsed((c) => !c);
            }
          }}
        >
          <ChevronDown size={14} />
        </span>
        <span className="row-icon">
          <Layers size={14} />
        </span>
        {editing ? (
          <input
            className="rename-input"
            dir="auto"
            aria-label="Workspace name"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
          />
        ) : (
          <span className="name bidi-auto">{ws.name}</span>
        )}
        <span className="ws-count">{ws.sessionIds.length}/{MAX_PER_WS}</span>
        {!editing && (
          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
            <button
              className="icon-btn sm"
              title={full ? `Workspace full (${MAX_PER_WS})` : "New session here"}
              aria-label={full ? "Workspace full" : `New session in ${ws.name}`}
              disabled={full}
              onClick={() => {
                switchWorkspace(ws.id);
                setNewSession(true);
              }}
            >
              <Plus size={13} />
            </button>
            <button
              className="icon-btn sm"
              title="Rename"
              aria-label={`Rename workspace ${ws.name}`}
              onClick={() => {
                setDraft(ws.name);
                setEditing(true);
              }}
            >
              <Pencil size={13} />
            </button>
            <button
              className="icon-btn sm"
              title="Delete workspace"
              aria-label={`Delete workspace ${ws.name}`}
              onClick={async () => {
                // One hover-click next to Rename must not silently kill live shells.
                if (ws.sessionIds.length > 0) {
                  const ok = await confirmDialog(
                    `Delete "${ws.name}" and close its ${ws.sessionIds.length} session(s)?`,
                    "Delete workspace",
                  ).catch(() => false);
                  if (!ok) return;
                }
                deleteWorkspace(ws.id);
              }}
            >
              <Trash2 size={13} />
            </button>
          </span>
        )}
      </div>

      {!collapsed &&
        ws.sessionIds.map((id) => (
          <SessionRow key={id} id={id} active={id === activeSessionId} />
        ))}
    </div>
  );
}

function SessionRow({ id, active }: { id: string; active: boolean }) {
  const session = useWorkspaces((s) => s.sessions[id]);
  const reorder = useWorkspaces((s) => s.reorderSession);
  const renameSession = useWorkspaces((s) => s.renameSession);
  const status = useRuntime((s) => s.status[id]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  if (!session) return null;

  const commit = () => {
    const name = draft.trim();
    if (name) renameSession(id, name);
    setEditing(false);
  };

  return (
    <div
      className={`tree-row session-row${active ? " selected" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => openSession(id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openSession(id);
        }
      }}
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.setData(DND, id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(DND)) e.preventDefault();
      }}
      onDrop={(e) => {
        const src = e.dataTransfer.getData(DND);
        if (!src || src === id) return;
        e.preventDefault();
        e.stopPropagation();
        const ws = useWorkspaces.getState().workspaces.find((w) => w.sessionIds.includes(id));
        if (ws) {
          const idx = ws.sessionIds.indexOf(id);
          if (useWorkspaces.getState().workspaceOf(src) === ws.id) reorder(src, idx);
          else if (useWorkspaces.getState().moveSessionToWorkspace(src, ws.id)) reorder(src, idx);
        }
      }}
      title={session.name}
    >
      <span className="twist" />
      <SessionIcon typeId={session.typeId} size={18} />
      <span
        className={`status-dot ${status ?? "idle"}`}
        role="img"
        aria-label={status === "running" ? "Running" : status === "exited" ? "Exited" : "Idle"}
      />
      {editing ? (
        <input
          ref={inputRef}
          className="rename-input"
          dir="auto"
          aria-label="Session name"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <span className="name bidi-auto">{session.name}</span>
      )}
      {!editing && (
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="icon-btn sm"
            title="Restart"
            aria-label={`Restart ${session.name}`}
            onClick={() => void restartSession(id)}
          >
            <RotateCcw size={13} />
          </button>
          <button
            className="icon-btn sm"
            title="Rename"
            aria-label={`Rename ${session.name}`}
            onClick={() => {
              setDraft(session.name);
              setEditing(true);
            }}
          >
            <Pencil size={13} />
          </button>
          <button
            className="icon-btn sm"
            title="Close session"
            aria-label={`Close ${session.name}`}
            onClick={() => closeSession(id)}
          >
            <X size={13} />
          </button>
        </span>
      )}
    </div>
  );
}
