import { create } from "zustand";
import type { ShellKind, ThemeMode } from "../lib/types";

interface SettingsPersist {
  theme: ThemeMode;
  fontSize: number;
  defaultShell: ShellKind;
  defaultCwd?: string;
  /** Optional terminal text-color override (empty string = use the theme foreground). */
  termForeground?: string;
  /** Render terminal text at a heavier weight. */
  termBold?: boolean;
}

interface SettingsState extends SettingsPersist {
  setTheme: (t: ThemeMode) => void;
  setFontSize: (n: number) => void;
  setDefaultShell: (s: ShellKind) => void;
  setDefaultCwd: (c: string) => void;
  setTermForeground: (c: string | undefined) => void;
  setTermBold: (b: boolean) => void;
  hydrate: (data: Partial<SettingsPersist>) => void;
  serialize: () => SettingsPersist;
}

const DEFAULTS: SettingsPersist = {
  theme: "dark",
  fontSize: 14,
  defaultShell: { kind: "powershell" },
  defaultCwd: undefined,
  termForeground: undefined,
  termBold: false,
};

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  setTheme: (theme) => set({ theme }),
  setFontSize: (fontSize) => set({ fontSize: Math.max(9, Math.min(28, fontSize)) }),
  setDefaultShell: (defaultShell) => set({ defaultShell }),
  setDefaultCwd: (defaultCwd) => set({ defaultCwd }),
  setTermForeground: (termForeground) =>
    set({ termForeground: termForeground && termForeground.trim() ? termForeground : undefined }),
  setTermBold: (termBold) => set({ termBold }),
  hydrate: (data) => set({ ...DEFAULTS, ...data }),
  serialize: () => {
    const { theme, fontSize, defaultShell, defaultCwd, termForeground, termBold } = get();
    return { theme, fontSize, defaultShell, defaultCwd, termForeground, termBold };
  },
}));
