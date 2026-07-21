import { useEffect } from "react";
import { PanelLeftOpen } from "lucide-react";
import { SessionTree } from "./features/tree/SessionTree";
import { Workspace } from "./features/workspace/Workspace";
import { CommandPalette } from "./features/command-palette/CommandPalette";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import { NewSessionDialog } from "./features/new-session/NewSessionDialog";
import { useSettings, resolveTerminalTheme } from "./store/settings";
import { useUI } from "./store/ui";
import { useRuntime } from "./store/runtime";
import { applyTheme, resolveTheme } from "./lib/theme";
import { applySettingsToAll, getTerminal } from "./features/terminal/controller";
import { onPtyExit } from "./lib/ipc";

export default function App() {
  const theme = useSettings((s) => s.theme);
  const terminalTheme = useSettings((s) => s.terminalTheme);
  const sidebarOpen = useUI((s) => s.sidebarOpen);

  // Keep <html data-theme> synced with the app theme, and terminals synced with the
  // (independent) terminal color scheme.
  useEffect(() => {
    applyTheme(theme);
    applySettingsToAll({ theme: resolveTerminalTheme(terminalTheme, resolveTheme(theme)) });
  }, [theme, terminalTheme]);

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
    onPtyExit((id) => {
      useRuntime.getState().setStatus(id, "exited");
      getTerminal(id)?.notifyExit();
    })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {
        /* IPC unavailable (e.g. running the frontend outside Tauri) */
      });
    return () => unlisten?.();
  }, []);

  // Global shortcuts, capture phase so they beat the focused terminal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUI.getState();
      if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        e.stopPropagation();
        ui.setPalette(!ui.paletteOpen);
      } else if (e.ctrlKey && !e.shiftKey && !e.altKey && (e.key === "b" || e.key === "B")) {
        e.preventDefault();
        e.stopPropagation();
        ui.toggleSidebar();
      } else if (e.key === "Escape") {
        if (ui.paletteOpen) ui.setPalette(false);
        if (ui.settingsOpen) ui.setSettings(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <div className="app-shell">
      {sidebarOpen ? (
        <SessionTree />
      ) : (
        <button
          className="sidebar-show"
          title="Show sidebar (Ctrl+B)"
          onClick={() => useUI.getState().setSidebar(true)}
        >
          <PanelLeftOpen size={16} />
        </button>
      )}
      <Workspace />
      <CommandPalette />
      <SettingsDialog />
      <NewSessionDialog />
    </div>
  );
}
