import { loadState, saveState } from "../lib/ipc";
import { useWorkspaces, type Session, type Workspace } from "./workspaces";
import { useSettings, type TerminalTheme } from "./settings";
import type { ShellKind, ThemeMode } from "../lib/types";

const VERSION = 3;

interface PersistBlob {
  version: number;
  workspaces: {
    workspaces: Workspace[];
    sessions: Record<string, Session>;
    activeWorkspaceId: string;
  };
  settings: {
    theme: ThemeMode;
    terminalTheme: TerminalTheme;
    fontSize: number;
    defaultShell: ShellKind;
    defaultCwd?: string;
    termForeground?: string;
    termBold?: boolean;
  };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let ready = false;

function scheduleSave() {
  if (!ready) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const blob = {
      version: VERSION,
      // Persist workspaces + their session definitions (name/shell/cwd/typeId) so a
      // restart restores the workspaces and re-opens each session in its folder. Live
      // PTY output/scrollback is not persisted.
      workspaces: useWorkspaces.getState().serialize(),
      settings: useSettings.getState().serialize(),
    };
    saveState(blob).catch((err) => console.debug("workspace save skipped", err));
  }, 400);
}

/** Load saved workspaces + settings, hydrate stores, then wire debounced autosave. */
export async function initPersistence(): Promise<void> {
  try {
    const blob = await loadState<PersistBlob>();
    if (blob && blob.version === VERSION) {
      if (blob.workspaces) useWorkspaces.getState().hydrate(blob.workspaces);
      if (blob.settings) useSettings.getState().hydrate(blob.settings);
    }
  } catch (err) {
    console.error("failed to load saved workspace", err);
  } finally {
    ready = true;
    useWorkspaces.subscribe(scheduleSave);
    useSettings.subscribe(scheduleSave);
  }
}
