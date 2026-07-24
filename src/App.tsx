import { useEffect, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDownToLine, X } from "lucide-react";
import { SessionTree } from "./features/tree/SessionTree";
import { TitleBar } from "./features/titlebar/TitleBar";
import { Workspace } from "./features/workspace/Workspace";
import { CommandPalette } from "./features/command-palette/CommandPalette";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import { NewSessionDialog } from "./features/new-session/NewSessionDialog";
import { ShortcutsDialog } from "./features/shortcuts/ShortcutsDialog";
import { useSettings, resolveTerminalTheme } from "./store/settings";
import { useWorkspaces } from "./store/workspaces";
import { useUI } from "./store/ui";
import { useRuntime } from "./store/runtime";
import { applyTheme, resolveTheme, setSystemTheme } from "./lib/theme";
import { applySettingsToAll, getTerminal } from "./features/terminal/controller";
import { noteExit } from "./features/terminal/attention";
import { useStrings } from "./lib/i18n";
import {
  onPtyExit,
  onWindowThemeChanged,
  openExternal,
  setWindowTheme,
  windowTheme,
} from "./lib/ipc";
import {
  checkForUpdate,
  installUpdate,
  RELEASES_URL,
  type AvailableUpdate,
} from "./lib/updater";

// Browser accelerators WebView2 would otherwise hijack from app chrome:
// print, find, view-source, save, downloads, find-next.
const BROWSER_CHORDS = new Set(["p", "f", "u", "s", "j", "g"]);

// Drag handle between the sidebar and the workspace. The sidebar is a flex sibling (not part
// of the terminal panel group), so it gets its own handle. Width comes from the pointer's
// distance to the app-shell's inline-start edge, which stays correct after a dir=rtl flip.
function SidebarResizer() {
  const setWidth = useUI((s) => s.setSidebarWidth);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    const shell = handle.closest(".app-shell") as HTMLElement | null;
    const rtl = document.documentElement.dir === "rtl";
    handle.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      setWidth(rtl ? rect.right - ev.clientX : ev.clientX - rect.left);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
    />
  );
}

// Physical keys WebView2 treats as zoom chords with Ctrl (any shift state).
const ZOOM_CODES = new Set(["Equal", "Minus", "Digit0", "NumpadAdd", "NumpadSubtract", "Numpad0"]);

export default function App() {
  const theme = useSettings((s) => s.theme);
  const terminalTheme = useSettings((s) => s.terminalTheme);
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const t = useStrings();
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);
  const [updatePhase, setUpdatePhase] = useState<"offer" | "installing" | "error">("offer");
  const [updateProgress, setUpdateProgress] = useState<number | null>(null);

  // Transparent-window styling only applies inside Tauri; a plain browser (tests,
  // Vite dev without the shell) keeps the opaque page background.
  useEffect(() => {
    if ("__TAURI_INTERNALS__" in window) document.documentElement.classList.add("in-tauri");
  }, []);

  // Keep <html data-theme> + terminals synced with the app theme. "System" must go through
  // the Tauri window API: wry pins the WebView2 color scheme to the window theme, so
  // matchMedia cannot see the OS preference (it reports the pin). setTheme(null) un-pins,
  // theme() reads the resolved OS value, onThemeChanged follows live OS switches.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const sync = () => {
      if (cancelled) return;
      const s = useSettings.getState();
      applyTheme(s.theme);
      // Route terminals through applySettingsToAll so paintBg() repaints viewport
      // backgrounds too, not just <html data-theme>.
      applySettingsToAll({ theme: resolveTerminalTheme(s.terminalTheme, resolveTheme(s.theme)) });
    };
    setWindowTheme(theme === "system" ? null : theme)
      .then(async () => {
        if (theme !== "system") return;
        const os = await windowTheme();
        if (os) setSystemTheme(os);
        const u = await onWindowThemeChanged((t2) => {
          setSystemTheme(t2);
          sync();
        });
        if (cancelled) u();
        else unlisten = u;
      })
      .catch(() => {
        /* outside Tauri (tests, plain browser): theme.ts matchMedia seed applies */
      })
      .finally(sync);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [theme, terminalTheme]);

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

  // One update check per launch, delayed so it never competes with session restore.
  // Silent on every failure path (offline, endpoint missing) by design; the settings
  // dialog has the loud, user-initiated check.
  useEffect(() => {
    const timer = setTimeout(() => {
      checkForUpdate()
        .then((info) => {
          if (info) {
            setUpdatePhase("offer");
            setUpdate(info);
          }
        })
        .catch(() => {});
    }, 5000);
    return () => clearTimeout(timer);
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
      } else if (e.ctrlKey && e.shiftKey && !e.altKey && key === "i") {
        // Broadcast typing to the whole workspace. Shift chord so plain Ctrl+I (Tab in
        // some TUIs) still reaches the terminal.
        e.preventDefault();
        e.stopPropagation();
        ui.toggleBroadcast();
      } else if (e.ctrlKey && e.shiftKey && !e.altKey && key === "d") {
        // Plan canvas mode for the active workspace.
        e.preventDefault();
        e.stopPropagation();
        ui.togglePlanner();
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
    <div className="app-frame">
      <TitleBar />
      <div className="app-shell">
        {sidebarOpen && (
          <>
            <SessionTree />
            <SidebarResizer />
          </>
        )}
        <Workspace />
      </div>
      <CommandPalette />
      <SettingsDialog />
      <NewSessionDialog />
      <ShortcutsDialog />
      {update && (
        <div className="update-toast" role="status">
          <span className="update-text">
            {updatePhase === "installing"
              ? updateProgress === 100
                ? t.updateInstalling
                : t.updateDownloading(updateProgress)
              : updatePhase === "error"
                ? t.updateFailed
                : t.updateAvailable(update.version)}
          </span>
          {updatePhase === "offer" && (
            <button
              className="update-btn"
              onClick={() => {
                setUpdatePhase("installing");
                setUpdateProgress(null);
                installUpdate(setUpdateProgress).catch((e) => {
                  console.warn("update install failed", e);
                  setUpdatePhase("error");
                });
              }}
            >
              <ArrowDownToLine size={14} />
              {t.updateInstall}
            </button>
          )}
          {updatePhase === "error" && (
            <button
              className="update-btn"
              onClick={() => {
                void openExternal(RELEASES_URL);
                setUpdate(null);
              }}
            >
              {t.updateOpenGithub}
            </button>
          )}
          {updatePhase !== "installing" && (
            <button
              className="icon-btn sm"
              title={t.updateLater}
              aria-label={t.updateLater}
              onClick={() => setUpdate(null)}
            >
              <X size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
