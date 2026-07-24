import { useEffect, useState } from "react";
import {
  Copy,
  Minus,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Square,
  Sun,
  X,
} from "lucide-react";
import { useSettings } from "../../store/settings";
import { useUI } from "../../store/ui";
import { resolveTheme } from "../../lib/theme";
import {
  closeAppWindow,
  isAppWindowMaximized,
  minimizeAppWindow,
  onWindowResized,
  toggleMaximizeAppWindow,
} from "../../lib/ipc";
import { WarshaMark } from "../icons";
import { useStrings } from "../../lib/i18n";

/** Frameless-window title bar: drag region, brand, sidebar/theme/settings toggles and
 *  the window controls. Dragging + double-click maximize come from
 *  data-tauri-drag-region; every interactive child stays clickable because the drag
 *  handler only fires when the bar itself is the event target. */
export function TitleBar() {
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const resolved = resolveTheme(theme);
  const t = useStrings();
  const [maximized, setMaximized] = useState(false);

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
        title={sidebarOpen ? t.hideSidebar : t.showSidebar}
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
