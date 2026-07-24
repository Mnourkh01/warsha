import { create } from "zustand";

// Transient UI-only state (overlays + view modes). Not persisted.
interface UIState {
  paletteOpen: boolean;
  settingsOpen: boolean;
  newSessionOpen: boolean;
  shortcutsOpen: boolean;
  sidebarOpen: boolean;
  /** Sidebar width in px (drag-resizable). Not persisted, resets on restart. */
  sidebarWidth: number;
  /** Session whose pane fills the whole grid; null = normal grid. */
  maximizedSessionId: string | null;
  /** Find bar over the ACTIVE session's pane. */
  findOpen: boolean;
  /** Broadcast typing to every session in the active workspace. Transient by design:
   *  never persisted, and cleared on any workspace switch (see actions.ts). */
  broadcast: boolean;
  setPalette: (v: boolean) => void;
  setSettings: (v: boolean) => void;
  setNewSession: (v: boolean) => void;
  setShortcuts: (v: boolean) => void;
  setSidebar: (v: boolean) => void;
  setSidebarWidth: (w: number) => void;
  toggleSidebar: () => void;
  setMaximized: (id: string | null) => void;
  toggleMaximized: (id: string) => void;
  setFind: (v: boolean) => void;
  setBroadcast: (v: boolean) => void;
  toggleBroadcast: () => void;
}

export const useUI = create<UIState>((set) => ({
  paletteOpen: false,
  settingsOpen: false,
  newSessionOpen: false,
  shortcutsOpen: false,
  sidebarOpen: true,
  sidebarWidth: 264,
  maximizedSessionId: null,
  findOpen: false,
  broadcast: false,
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setSettings: (settingsOpen) => set({ settingsOpen }),
  setNewSession: (newSessionOpen) => set({ newSessionOpen }),
  setShortcuts: (shortcutsOpen) => set({ shortcutsOpen }),
  setSidebar: (sidebarOpen) => set({ sidebarOpen }),
  // Clamp so the sidebar can never be dragged uselessly narrow or eat the whole window.
  setSidebarWidth: (w) => set({ sidebarWidth: Math.max(200, Math.min(520, Math.round(w))) }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setMaximized: (maximizedSessionId) => set({ maximizedSessionId }),
  toggleMaximized: (id) =>
    set((s) => ({ maximizedSessionId: s.maximizedSessionId === id ? null : id })),
  setFind: (findOpen) => set({ findOpen }),
  setBroadcast: (broadcast) => set({ broadcast }),
  toggleBroadcast: () => set((s) => ({ broadcast: !s.broadcast })),
}));
