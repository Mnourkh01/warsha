import { loadState, saveState } from "../lib/ipc";
import { useTree } from "./tree";
import { useLayout } from "./layout";
import { useSettings } from "./settings";
import type { PaneNode, NodeId, ShellKind, ThemeMode, TreeNode } from "../lib/types";

const VERSION = 1;

interface PersistBlob {
  version: number;
  tree: { nodes: Record<NodeId, TreeNode>; rootIds: NodeId[] };
  layout: { root: PaneNode; activePaneId: string };
  settings: {
    theme: ThemeMode;
    fontSize: number;
    defaultShell: ShellKind;
    defaultCwd?: string;
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
      tree: useTree.getState().serialize(),
      // Persist layout STRUCTURE, but drop live session bindings so a restart opens
      // to a clean workspace (sessions are re-opened by the user, PTYs are not restored in v1).
      layout: stripSessions(useLayout.getState().serialize()),
      settings: useSettings.getState().serialize(),
    };
    saveState(blob).catch((err) => console.debug("workspace save skipped", err));
  }, 400);
}

function stripSessions(layout: { root: PaneNode; activePaneId: string }) {
  const strip = (node: PaneNode): PaneNode =>
    node.type === "leaf"
      ? { ...node, sessionId: null }
      : { ...node, a: strip(node.a), b: strip(node.b) };
  return { root: strip(layout.root), activePaneId: layout.activePaneId };
}

/** Load saved workspace, hydrate stores, then wire debounced autosave. */
export async function initPersistence(): Promise<void> {
  try {
    const blob = await loadState<PersistBlob>();
    if (blob && blob.version === VERSION) {
      if (blob.tree) useTree.getState().hydrate(blob.tree);
      if (blob.layout) useLayout.getState().hydrate(stripSessions(blob.layout));
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
