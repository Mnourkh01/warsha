import { create } from "zustand";

// Transient UI-only state (overlays + view modes). Not persisted.
interface UIState {
  paletteOpen: boolean;
  settingsOpen: boolean;
  newSessionOpen: boolean;
  shortcutsOpen: boolean;
  sidebarOpen: boolean;
  /** Session whose pane fills the whole grid; null = normal grid. */
  maximizedSessionId: string | null;
  /** Find bar over the ACTIVE session's pane. */
  findOpen: boolean;
  setPalette: (v: boolean) => void;
  setSettings: (v: boolean) => void;
  setNewSession: (v: boolean) => void;
  setShortcuts: (v: boolean) => void;
  setSidebar: (v: boolean) => void;
  toggleSidebar: () => void;
  setMaximized: (id: string | null) => void;
  toggleMaximized: (id: string) => void;
  setFind: (v: boolean) => void;
}

export const useUI = create<UIState>((set) => ({
  paletteOpen: false,
  settingsOpen: false,
  newSessionOpen: false,
  shortcutsOpen: false,
  sidebarOpen: true,
  maximizedSessionId: null,
  findOpen: false,
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setSettings: (settingsOpen) => set({ settingsOpen }),
  setNewSession: (newSessionOpen) => set({ newSessionOpen }),
  setShortcuts: (shortcutsOpen) => set({ shortcutsOpen }),
  setSidebar: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setMaximized: (maximizedSessionId) => set({ maximizedSessionId }),
  toggleMaximized: (id) =>
    set((s) => ({ maximizedSessionId: s.maximizedSessionId === id ? null : id })),
  setFind: (findOpen) => set({ findOpen }),
}));
