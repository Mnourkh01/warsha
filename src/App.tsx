import { useEffect } from "react";
import { PanelLeftOpen } from "lucide-react";
import { SessionTree } from "./features/tree/SessionTree";
import { Workspace } from "./features/workspace/Workspace";
import { CommandPalette } from "./features/command-palette/CommandPalette";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import { NewSessionDialog } from "./features/new-session/NewSessionDialog";
import { ShortcutsDialog } from "./features/shortcuts/ShortcutsDialog";
import { useSettings, resolveTerminalTheme } from "./store/settings";
import { useWorkspaces } from "./store/workspaces";
import { useUI } from "./store/ui";
import { useRuntime } from "./store/runtime";
import { applyTheme, resolveTheme } from "./lib/theme";
import { applySettingsToAll, getTerminal } from "./features/terminal/controller";
import { noteExit } from "./features/terminal/attention";
import { useStrings } from "./lib/i18n";
import { onPtyExit } from "./lib/ipc";

// Browser accelerators WebView2 would otherwise hijack from app chrome:
// print, find, view-source, save, downloads, find-next.
const BROWSER_CHORDS = new Set(["p", "f", "u", "s", "j", "g"]);

// Physical keys WebView2 treats as zoom chords with Ctrl (any shift state).
const ZOOM_CODES = new Set(["Equal", "Minus", "Digit0", "NumpadAdd", "NumpadSubtract", "Numpad0"]);

export default function App() {
  const theme = useSettings((s) => s.theme);
  const terminalTheme = useSettings((s) => s.terminalTheme);
  const locale = useSettings((s) => s.locale);
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const t = useStrings();

  // Keep <html data-theme> synced with the app theme, and terminals synced with the
  // (independent) terminal color scheme.
  useEffect(() => {
    applyTheme(theme);
    applySettingsToAll({ theme: resolveTerminalTheme(terminalTheme, resolveTheme(theme)) });
  }, [theme, terminalTheme]);

  // App chrome direction follows the locale; the terminal grid itself stays LTR (a CSS
  // rule on .term-host, xterm cannot render RTL).
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === "ar" ? "rtl" : "ltr";
  }, [locale]);

  // Follow the OS theme while in "system" mode.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const s = useSettings.getState();
      if (s.theme === "system") {
        applyTheme("system");
        applySettingsToAll({
          theme: resolveTerminalTheme(s.terminalTheme, resolveTheme("system")),
        });
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Mark sessions exited and print a notice when their process ends.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onPtyExit((id, code) => {
      useRuntime.getState().setStatus(id, "exited");
      getTerminal(id)?.notifyExit(code);
      noteExit(id);
    })
      .then((u) => {
        // If the effect was cleaned up before listen() resolved (StrictMode dev
        // remount), unlisten immediately or the listener leaks forever.
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {
        /* IPC unavailable (e.g. running the frontend outside Tauri) */
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  // Coming back to the window means the user is looking at the active pane again.
  useEffect(() => {
    const onFocus = () => {
      const sid = useWorkspaces.getState().activeSessionId;
      if (sid) useRuntime.getState().clearAttention(sid);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Global shortcuts, capture phase so they beat the focused terminal.
  // Ctrl+B is deliberately NOT intercepted (tmux prefix); sidebar uses Ctrl+Shift+B.
  // Ctrl+Shift+P is a palette alias for muscle memory from other terminals.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState();
      const key = e.key.toLowerCase();
      const paletteChord =
        e.ctrlKey && !e.altKey && ((!e.shiftKey && key === "k") || (e.shiftKey && key === "p"));
      if (paletteChord) {
        e.preventDefault();
        e.stopPropagation();
        ui.setPalette(!ui.paletteOpen);
      } else if (e.ctrlKey && e.shiftKey && !e.altKey && key === "b") {
        e.preventDefault();
        e.stopPropagation();
        ui.toggleSidebar();
      } else if (e.ctrlKey && e.shiftKey && !e.altKey && key === "f") {
        e.preventDefault();
        e.stopPropagation();
        if (useWorkspaces.getState().activeSessionId) ui.setFind(true);
      } else if (e.ctrlKey && e.shiftKey && !e.altKey && key === "m") {
        e.preventDefault();
        e.stopPropagation();
        const sid = useWorkspaces.getState().activeSessionId;
        if (sid) ui.toggleMaximized(sid);
      } else if (e.key === "Escape") {
        // Close topmost-first, one layer per press. (The find bar handles its own
        // Escape while its input is focused; this covers focus elsewhere.)
        if (ui.paletteOpen) ui.setPalette(false);
        else if (ui.newSessionOpen) ui.setNewSession(false);
        else if (ui.settingsOpen) ui.setSettings(false);
        else if (ui.shortcutsOpen) ui.setShortcuts(false);
        else if (ui.findOpen) ui.setFind(false);
      } else if (
        e.ctrlKey &&
        !e.altKey &&
        !e.shiftKey &&
        BROWSER_CHORDS.has(key) &&
        !(e.target as HTMLElement | null)?.closest?.(".xterm")
      ) {
        // WebView2 leaks browser accelerators (print/find/save dialogs). Inside a
        // terminal xterm suppresses them itself; block them for the app chrome too.
        e.preventDefault();
      } else if (e.ctrlKey && !e.altKey && ZOOM_CODES.has(e.code)) {
        // Browser zoom desyncs the terminal grid from its cell metrics. Match on
        // physical codes so shift variants (Ctrl+Shift+=) and non-US layouts are
        // covered too. Font size changes go through Settings instead.
        e.preventDefault();
      } else if (e.key === "F7") {
        e.preventDefault(); // caret-browsing prompt
      } else if (import.meta.env.PROD && (e.key === "F5" || (e.ctrlKey && key === "r"))) {
        e.preventDefault(); // a reload would orphan every live terminal
      }
    };
    // Ctrl+wheel is WebView2 zoom; same grid-desync problem as keyboard zoom.
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("wheel", onWheel, true);
    };
  }, []);

  return (
    <div className="app-shell">
      {sidebarOpen ? (
        <SessionTree />
      ) : (
        <button
          className="sidebar-show"
          title={t.showSidebar}
          aria-label={t.showSidebarAria}
          onClick={() => useUI.getState().setSidebar(true)}
        >
          <PanelLeftOpen size={16} />
        </button>
      )}
      <Workspace />
      <CommandPalette />
      <SettingsDialog />
      <NewSessionDialog />
      <ShortcutsDialog />
    </div>
  );
}
