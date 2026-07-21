import { loadState, saveState } from "../lib/ipc";
import { useTree } from "./tree";
import { useLayout, type Pane } from "./layout";
import { useSettings } from "./settings";
import type { NodeId, ShellKind, ThemeMode, TreeNode } from "../lib/types";

const VERSION = 2;

interface PersistBlob {
  version: number;
  tree: { nodes: Record<NodeId, TreeNode>; rootIds: NodeId[] };
  layout: { panes: Pane[]; activePaneId: string };
  settings: {
    theme: ThemeMode;
    fontSize: number;
    defaultShell: ShellKind;
    defaultCwd?: string;
    termForeground?: string;
    termBold?: boolean;
  };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let ready = false;

function stripSessions(layout: { panes: Pane[]; activePaneId: string }) {
  // Persist the grid STRUCTURE, but drop live session bindings (PTYs are not restored
  // in v1, so a restart opens to empty panes the user re-fills).
  return {
    panes: layout.panes.map((p) => ({ id: p.id, sessionId: null })),
    activePaneId: layout.activePaneId,
  };
}

function scheduleSave() {
  if (!ready) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const blob = {
      version: VERSION,
      tree: useTree.getState().serialize(),
      layout: stripSessions(useLayout.getState().serialize()),
      settings: useSettings.getState().serialize(),
    };
    saveState(blob).catch((err) => console.debug("workspace save skipped", err));
  }, 400);
}

/** Load saved workspace, hydrate stores, then wire debounced autosave. */
export async function initPersistence(): Promise<void> {
  try {
    const blob = await loadState<PersistBlob>();
    if (blob && blob.version === VERSION) {
      if (blob.tree) useTree.getState().hydrate(blob.tree);
      if (blob.layout) useLayout.getState().hydrate(blob.layout);
      if (blob.settings) useSettings.getState().hydrate(blob.settings);
    }
  } catch (err) {
    console.error("failed to load saved workspace", err);
  } finally {
    ready = true;
    useTree.subscribe(scheduleSave);
    useLayout.subscribe(scheduleSave);
    useSettings.subscribe(scheduleSave);
  }
}
