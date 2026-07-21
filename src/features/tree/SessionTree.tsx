import { FolderPlus, Hammer, Moon, PanelLeftClose, Plus, Settings, Sun } from "lucide-react";
import { useTree } from "../../store/tree";
import { useLayout } from "../../store/layout";
import { useSettings } from "../../store/settings";
import { useUI } from "../../store/ui";
import { resolveTheme } from "../../lib/theme";
import { TreeItem } from "./TreeItem";

export function SessionTree() {
  const rootIds = useTree((s) => s.rootIds);
  const addGroup = useTree((s) => s.addGroup);
  const move = useTree((s) => s.move);
  const activeSessionId = useLayout(
    (s) => s.panes.find((p) => p.id === s.activePaneId)?.sessionId ?? null,
  );
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
        <button className="icon-btn" title="New session" onClick={() => setNewSession(true)}>
          <Plus size={16} />
        </button>
        <button className="icon-btn" title="New group" onClick={() => addGroup(null)}>
          <FolderPlus size={16} />
        </button>
        <button
          className="icon-btn"
          title="Toggle theme"
          onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
        >
          {resolved === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button className="icon-btn" title="Settings" onClick={() => setSettings(true)}>
          <Settings size={16} />
        </button>
        <button
          className="icon-btn"
          title="Hide sidebar (Ctrl+B)"
          onClick={() => setSidebar(false)}
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      <div
        className="tree"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const src = e.dataTransfer.getData("text/warsha-node");
          if (src) move(src, null, useTree.getState().rootIds.length);
        }}
      >
        {rootIds.length === 0 ? (
          <div className="tree-empty">
            No sessions yet.
            <br />
            Press <b>+</b> to create your first session, or add a group to organize by
            project.
          </div>
        ) : (
          rootIds.map((id) => (
            <TreeItem key={id} id={id} depth={0} activeSessionId={activeSessionId} />
          ))
        )}
      </div>
    </aside>
  );
}
