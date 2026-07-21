import {
  destroyAppWindow,
  loadState,
  onWindowCloseRequested,
  saveState,
  sessionStateBackup,
} from "../lib/ipc";
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

function buildBlob(): PersistBlob {
  return {
    version: VERSION,
    // Persist workspaces + their session definitions (name/shell/cwd/typeId) so a
    // restart restores the workspaces and re-opens each session in its folder. Live
    // PTY output/scrollback is not persisted.
    workspaces: useWorkspaces.getState().serialize(),
    settings: useSettings.getState().serialize(),
  };
}

function scheduleSave() {
  if (!ready) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveState(buildBlob()).catch((err) => console.debug("workspace save skipped", err));
  }, 400);
}

/** Write the current state NOW (cancels the debounce). Bounded by `timeoutMs` so a hung
 *  save can never block quitting; losing one save beats a window that will not close. */
export async function flushSave(timeoutMs = 500): Promise<void> {
  if (!ready) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await Promise.race([
    saveState(buildBlob()).catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/** Load saved workspaces + settings, hydrate stores, then wire debounced autosave and
 *  a flush-on-close so the last ~400ms of edits survive quitting. */
export async function initPersistence(): Promise<void> {
  try {
    const blob = await loadState<PersistBlob>();
    if (blob && blob.version === VERSION) {
      if (blob.workspaces) useWorkspaces.getState().hydrate(blob.workspaces);
      if (blob.settings) useSettings.getState().hydrate(blob.settings);
    } else if (blob) {
      // Unknown version: back the file up BEFORE the next debounced save overwrites it,
      // then start fresh. Never silently destroy the user's saved workspaces.
      const label = typeof blob.version === "number" ? `v${blob.version}` : "unknown";
      await sessionStateBackup(label).catch(() => undefined);
      console.warn(`saved state version ${String(blob.version)} unsupported; backed up as ${label}`);
    }
  } catch (err) {
    console.error("failed to load saved workspace", err);
  } finally {
    ready = true;
    useWorkspaces.subscribe(scheduleSave);
    useSettings.subscribe(scheduleSave);
  }

  // Flush pending changes when the user closes the window: preventDefault, await the
  // bounded flush, then destroy. The window-state plugin's Rust handler sees the same
  // CloseRequested and saves geometry independently.
  let closing = false;
  onWindowCloseRequested(async (event) => {
    if (closing) return;
    closing = true;
    event.preventDefault();
    await flushSave(500);
    try {
      await destroyAppWindow();
    } catch (err) {
      // Destroy denied/failed: clear the guard so the next close attempt (including the
      // wrapper's own destroy on the early-return path) can still exit the app.
      closing = false;
      console.error("window destroy failed; close again to retry", err);
    }
  }).catch(() => {
    /* not running inside Tauri (e.g. plain Vite dev / tests) */
  });
}
