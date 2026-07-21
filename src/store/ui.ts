import { create } from "zustand";

// Transient UI-only state (overlays). Not persisted.
interface UIState {
  paletteOpen: boolean;
  settingsOpen: boolean;
  newSessionOpen: boolean;
  sidebarOpen: boolean;
  setPalette: (v: boolean) => void;
  setSettings: (v: boolean) => void;
  setNewSession: (v: boolean) => void;
  setSidebar: (v: boolean) => void;
  toggleSidebar: () => void;
}

export const useUI = create<UIState>((set) => ({
  paletteOpen: false,
  settingsOpen: false,
  newSessionOpen: false,
  sidebarOpen: true,
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setSettings: (settingsOpen) => set({ settingsOpen }),
  setNewSession: (newSessionOpen) => set({ newSessionOpen }),
  setSidebar: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
