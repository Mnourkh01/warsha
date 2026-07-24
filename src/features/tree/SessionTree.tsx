import { useEffect, useRef, useState } from "react";
import {
  BookmarkPlus,
  ChevronDown,
  CopyPlus,
  FolderOpen,
  FolderPlus,
  Layers,
  LayoutTemplate,
  PaintBucket,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { MAX_PER_WS, useWorkspaces, type Workspace } from "../../store/workspaces";
import { useRuntime } from "../../store/runtime";
import { useTemplates } from "../../store/templates";
import { useUI } from "../../store/ui";
import { nextTint, tintClasses } from "../../lib/tints";
import type { ShellKind } from "../../lib/types";
import { confirmDialog, pickFolder } from "../../lib/ipc";
import {
  closeSession,
  deleteWorkspace,
  duplicateSession,
  newWorkspace,
  openPlanner,
  openSession,
  openTemplate,
  restartSession,
  switchWorkspace,
} from "../../actions";
import { SessionIcon } from "../icons";
import { primaryChord } from "../shortcuts/registry";
import { useSettings } from "../../store/settings";
import { useStrings } from "../../lib/i18n";

const DND = "text/warsha-session";

// Host-shell monogram for the row sub-line ("PS Running"): the icon tile already names
// the session type, so the missing information is WHICH shell it runs inside.
function shellMonogram(shell: ShellKind | undefined): string {
  switch (shell?.kind) {
    case "powershell":
      return "PS";
    case "cmd":
      return "CMD";
    case "wsl":
      return "WSL";
    case "custom": {
      const prog = (shell.program ?? "").toLowerCase();
      if (prog.includes("bash")) return "BASH";
      if (prog.includes("ssh")) return "SSH";
      return "SH";
    }
    default:
      return "PS";
  }
}

export function SessionTree() {
  const workspaces = useWorkspaces((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaces((s) => s.activeWorkspaceId);
  const activeSessionId = useWorkspaces((s) => s.activeSessionId);
  const shortcuts = useSettings((s) => s.shortcuts);
  const setNewSession = useUI((s) => s.setNewSession);
  const sidebarWidth = useUI((s) => s.sidebarWidth);
  const t = useStrings();

  return (
    <aside className="sidebar" style={{ width: sidebarWidth, minWidth: sidebarWidth }}>
      <div className="sidebar-header">
        <span className="sidebar-title">{t.workspacesGroup}</span>
        <span className="spacer" />
        <button
          className="icon-btn"
          title={t.newWorkspace}
          aria-label={t.newWorkspace}
          onClick={() => newWorkspace()}
        >
          <FolderPlus size={16} />
        </button>
        <button
          className="icon-btn"
          title={t.newSession}
          aria-label={t.newSession}
          onClick={() => setNewSession(true)}
        >
          <Plus size={16} />
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
          <div className="tree-empty">{t.treeEmpty(primaryChord("palette", shortcuts ?? {}))}</div>
        )}
        <TemplatesSection />
      </div>
    </aside>
  );
}

// Saved workspace templates: one click reopens the full layout as a new workspace.
// Hidden entirely while no template exists (zero sidebar clutter for new users).
function TemplatesSection() {
  const templates = useTemplates((s) => s.templates);
  const t = useStrings();
  if (templates.length === 0) return null;
  return (
    <div className="tpl-section">
      <div className="tree-group-label">{t.templatesGroup}</div>
      <div className="tpl-list">
      {templates.map((tpl) => (
        <div
          key={tpl.id}
          className="tree-row session-row"
          role="button"
          tabIndex={0}
          title={t.openTemplateTitle(tpl.name, tpl.sessions.length)}
          onClick={() => openTemplate(tpl.id)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openTemplate(tpl.id);
            }
          }}
        >
          <span className="row-badge">
            <LayoutTemplate size={15} />
          </span>
          <span className="row-lines">
            <span className="name bidi-auto">{tpl.name}</span>
            <span className="row-sub">{t.templateSessions(tpl.sessions.length)}</span>
          </span>
          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
            <button
              className="icon-btn sm"
              title={t.deleteTemplate}
              aria-label={t.deleteTemplateNamed(tpl.name)}
              onClick={async () => {
                const ok = await confirmDialog(
                  t.deleteTemplateConfirm(tpl.name),
                  t.deleteTemplate,
                ).catch(() => false);
                if (ok) useTemplates.getState().remove(tpl.id);
              }}
            >
              <Trash2 size={13} />
            </button>
          </span>
        </div>
      ))}
      </div>
    </div>
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
  const setWsCwd = useWorkspaces((s) => s.setWorkspaceCwd);
  const moveToWs = useWorkspaces((s) => s.moveSessionToWorkspace);
  const setNewSession = useUI((s) => s.setNewSession);
  const attentionCount = useRuntime((s) =>
    ws.sessionIds.reduce((n, id) => n + (s.attention[id] ? 1 : 0), 0),
  );
  const t = useStrings();
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

  const setFolder = async () => {
    try {
      const dir = await pickFolder(t.chooseWorkspaceFolder(ws.name));
      if (!dir) return;
      setWsCwd(ws.id, dir);
      // "workspace = project": an auto-named workspace takes the folder's name.
      if (/^Workspace \d+$/.test(ws.name)) {
        const base = dir.split(/[\\/]/).filter(Boolean).pop();
        if (base) rename(ws.id, base);
      }
    } catch (e) {
      console.warn("workspace folder picker failed", e);
    }
  };

  return (
    <div className="ws-group">
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
        title={ws.defaultCwd ? t.workspaceFolderTitle(ws.defaultCwd) : undefined}
      >
        <span
          className={`twist${collapsed ? " collapsed" : ""}`}
          role="button"
          tabIndex={0}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t.expandWorkspace : t.collapseWorkspace}
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
            aria-label={t.workspaceName}
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
        {attentionCount > 0 && (
          <span
            className="attention-dot"
            role="img"
            aria-label={t.sessionsNeedAttention(attentionCount)}
            title={t.sessionsNeedAttention(attentionCount)}
          />
        )}
        <span
          className={`ws-count${full ? " full" : ""}`}
          title={full ? t.workspaceFull(MAX_PER_WS) : undefined}
        >
          {ws.sessionIds.length}
        </span>
        {!editing && (
          <span className="row-actions" onClick={(e) => e.stopPropagation()}>
            <button
              className="icon-btn sm"
              title={full ? t.workspaceFull(MAX_PER_WS) : t.newSessionHere}
              aria-label={full ? t.workspaceFull(MAX_PER_WS) : t.newSessionIn(ws.name)}
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
              title={t.setWorkspaceFolder}
              aria-label={t.setWorkspaceFolderFor(ws.name)}
              onClick={() => void setFolder()}
            >
              <FolderOpen size={13} />
            </button>
            <button
              className="icon-btn sm"
              title={t.openPlanner}
              aria-label={t.openPlannerFor(ws.name)}
              onClick={() => openPlanner(ws.id)}
            >
              <Workflow size={13} />
            </button>
            <button
              className="icon-btn sm"
              title={t.saveAsTemplate}
              aria-label={t.saveAsTemplateNamed(ws.name)}
              disabled={ws.sessionIds.length === 0}
              onClick={() => useTemplates.getState().saveFromWorkspace(ws.id)}
            >
              <BookmarkPlus size={13} />
            </button>
            <button
              className="icon-btn sm"
              title={t.rename}
              aria-label={t.renameWorkspaceNamed(ws.name)}
              onClick={() => {
                setDraft(ws.name);
                setEditing(true);
              }}
            >
              <Pencil size={13} />
            </button>
            <button
              className="icon-btn sm"
              title={t.deleteWorkspace}
              aria-label={t.deleteWorkspaceNamed(ws.name)}
              onClick={async () => {
                // One hover-click next to Rename must not silently kill live shells.
                if (ws.sessionIds.length > 0) {
                  const ok = await confirmDialog(
                    t.deleteWorkspaceConfirm(ws.name, ws.sessionIds.length),
                    t.deleteWorkspace,
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

      {/* Always mounted so collapse can animate; the inner list hides via 0fr rows.
          An empty workspace renders no well at all. */}
      {ws.sessionIds.length > 0 && (
        <div className={`ws-sessions${collapsed ? " collapsed" : ""}`} aria-hidden={collapsed}>
          <div className="ws-sessions-inner">
            {ws.sessionIds.map((id) => (
              <SessionRow key={id} id={id} active={id === activeSessionId} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SessionRow({ id, active }: { id: string; active: boolean }) {
  const session = useWorkspaces((s) => s.sessions[id]);
  const reorder = useWorkspaces((s) => s.reorderSession);
  const renameSession = useWorkspaces((s) => s.renameSession);
  const wsFull = useWorkspaces((s) => s.isFull(s.workspaceOf(id) ?? undefined));
  const status = useRuntime((s) => s.status[id]);
  const attention = useRuntime((s) => Boolean(s.attention[id]));
  // Live detection wins over the launch-time type: typing `claude` into a plain shell
  // flips the icon; the CLI exiting flips it back (typeId is the fallback).
  const detectedAi = useRuntime((s) => s.detectedAi[id]);
  const t = useStrings();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [dropBefore, setDropBefore] = useState(false);
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
      className={`tree-row session-row${active ? " selected" : ""}${dropBefore ? " drop-before" : ""}${tintClasses(session.tint)}`}
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
        if (e.dataTransfer.types.includes(DND)) {
          e.preventDefault();
          setDropBefore(true);
        }
      }}
      onDragLeave={() => setDropBefore(false)}
      onDrop={(e) => {
        setDropBefore(false);
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
      <span className="row-badge" data-status={status ?? "idle"}>
        <SessionIcon typeId={detectedAi ?? session.typeId} size={16} />
        <span
          className="row-presence"
          role="img"
          aria-label={
            status === "running" ? t.statusRunning : status === "exited" ? t.statusExited : t.statusIdle
          }
        />
      </span>
      {editing ? (
        <input
          ref={inputRef}
          className="rename-input"
          dir="auto"
          aria-label={t.sessionName}
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
        <span className="row-lines">
          <span className="name bidi-auto">{session.name}</span>
          <span className="row-sub">
            <span className="shell-chip">{shellMonogram(session.shell)}</span>
            {status === "running" ? t.statusRunning : status === "exited" ? t.statusExited : t.statusIdle}
          </span>
        </span>
      )}
      {attention && !editing && (
        <span
          className="attention-dot"
          role="img"
          aria-label={t.needsAttention}
          title={t.attentionHint}
        />
      )}
      {!editing && (
        <span className="row-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className="icon-btn sm"
            title={t.changeColor}
            aria-label={t.changeColorNamed(session.name)}
            onClick={() => useWorkspaces.getState().setSessionTint(id, nextTint(session.tint))}
          >
            <PaintBucket size={13} />
          </button>
          <button
            className="icon-btn sm"
            title={wsFull ? t.workspaceFull(MAX_PER_WS) : t.duplicateSession}
            aria-label={t.duplicateNamed(session.name)}
            disabled={wsFull}
            onClick={() => duplicateSession(id)}
          >
            <CopyPlus size={13} />
          </button>
          <button
            className="icon-btn sm"
            title={t.restart}
            aria-label={t.restartNamed(session.name)}
            onClick={() => void restartSession(id)}
          >
            <RotateCcw size={13} />
          </button>
          <button
            className="icon-btn sm"
            title={t.rename}
            aria-label={t.renameNamed(session.name)}
            onClick={() => {
              setDraft(session.name);
              setEditing(true);
            }}
          >
            <Pencil size={13} />
          </button>
          <button
            className="icon-btn sm"
            title={t.closeSession}
            aria-label={t.closeNamed(session.name)}
            onClick={() => closeSession(id)}
          >
            <X size={13} />
          </button>
        </span>
      )}
    </div>
  );
}
