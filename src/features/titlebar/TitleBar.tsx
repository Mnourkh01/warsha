import { useEffect, useState } from "react";
import {
  Copy,
  Minus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  Settings,
  Square,
  Sun,
  Workflow,
  X,
} from "lucide-react";
import { useSettings } from "../../store/settings";
import { useUI } from "../../store/ui";
import { useWorkspaces } from "../../store/workspaces";
import { useRadar, liveCount } from "../../store/radar";
import { resolveTheme } from "../../lib/theme";
import {
  closeAppWindow,
  isAppWindowMaximized,
  minimizeAppWindow,
  onWindowResized,
  toggleMaximizeAppWindow,
} from "../../lib/ipc";
import { WarshaMark } from "../icons";
import { primaryChord } from "../shortcuts/registry";
import { useStrings } from "../../lib/i18n";

/** Frameless-window title bar: drag region, brand, sidebar/theme/settings toggles and
 *  the window controls. Dragging + double-click maximize come from
 *  data-tauri-drag-region; every interactive child stays clickable because the drag
 *  handler only fires when the bar itself is the event target. */
export function TitleBar() {
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const plannerOpen = useUI((s) => s.plannerOpen);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const shortcuts = useSettings((s) => s.shortcuts);
  const sidebarChord = primaryChord("sidebar", shortcuts ?? {});
  const blueprintChord = primaryChord("blueprint", shortcuts ?? {});
  const resolved = resolveTheme(theme);
  const t = useStrings();
  const [maximized, setMaximized] = useState(false);
  const radarCount = useRadar((s) => liveCount(s.snapshot));
  // The Blueprint always opens the ACTIVE workspace's plan; say which one up front
  // so the global button placement stays unambiguous.
  const wsName = useWorkspaces(
    (s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId)?.name ?? "this workspace",
  );

  // Keep the maximize/restore glyph truthful across every path that resizes the
  // window (button, double-click, Win+Arrow snapping, window-state restore).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const sync = () => {
      isAppWindowMaximized()
        .then((m) => {
          if (!cancelled) setMaximized(m);
        })
        .catch(() => {});
    };
    sync();
    onWindowResized(sync)
      .then((u) => {
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {
        /* outside Tauri (tests, plain browser) the bar is inert chrome */
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <button
        className="icon-btn"
        title={sidebarOpen ? t.hideSidebar(sidebarChord) : t.showSidebar(sidebarChord)}
        aria-label={sidebarOpen ? t.hideSidebarAria : t.showSidebarAria}
        onClick={() => useUI.getState().toggleSidebar()}
      >
        {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      </button>
      <span className="brand">
        <span className="brand-mark">
          <WarshaMark size={14} />
        </span>
        Warsha
      </span>
      <span className="spacer" data-tauri-drag-region />
      <button
        className="icon-btn"
        title={
          plannerOpen
            ? t.closeBlueprintTb(wsName, blueprintChord)
            : t.openBlueprintTb(wsName, blueprintChord)
        }
        aria-label={plannerOpen ? t.closeBlueprintAria(wsName) : t.openBlueprintAria(wsName)}
        aria-pressed={plannerOpen}
        onClick={() => useUI.getState().togglePlanner()}
      >
        <Workflow size={16} />
      </button>
      <button
        className="icon-btn radar-btn"
        title={t.radarButton(radarCount)}
        aria-label={t.radarButton(radarCount)}
        onClick={() => useUI.getState().setRadar(true)}
      >
        <Radar size={16} />
        {radarCount > 0 && (
          <span className="radar-badge">{radarCount > 99 ? "99+" : radarCount}</span>
        )}
      </button>
      <button
        className="icon-btn"
        title={t.toggleTheme}
        aria-label={t.toggleThemeAria}
        onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
      >
        {resolved === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      </button>
      <button
        className="icon-btn"
        title={t.settings}
        aria-label={t.settings}
        onClick={() => useUI.getState().setSettings(true)}
      >
        <Settings size={16} />
      </button>
      <div className="tb-controls">
        <button
          className="tb-btn"
          title={t.minimizeWindow}
          aria-label={t.minimizeWindow}
          onClick={() => void minimizeAppWindow().catch(() => {})}
        >
          <Minus size={15} />
        </button>
        <button
          className="tb-btn"
          title={maximized ? t.restoreWindow : t.maximizeWindow}
          aria-label={maximized ? t.restoreWindow : t.maximizeWindow}
          onClick={() => void toggleMaximizeAppWindow().catch(() => {})}
        >
          {maximized ? <Copy size={13} /> : <Square size={13} />}
        </button>
        <button
          className="tb-btn tb-close"
          title={t.closeWindow}
          aria-label={t.closeWindow}
          onClick={() => void closeAppWindow().catch(() => {})}
        >
          <X size={16} />
        </button>
      </div>
    </header>
  );
}
