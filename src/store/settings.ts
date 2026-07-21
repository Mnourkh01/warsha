import { create } from "zustand";
import type { ShellKind, ThemeMode } from "../lib/types";

// Terminal color scheme is INDEPENDENT of the app chrome theme. Default "dark" so CLIs
// like Claude/Gemini/Codex (which assume a dark terminal) always render correctly even
// when the app UI is in light mode. "match" follows the app theme.
export type TerminalTheme = "dark" | "light" | "match";

interface SettingsPersist {
  theme: ThemeMode;
  terminalTheme: TerminalTheme;
  fontSize: number;
  defaultShell: ShellKind;
  defaultCwd?: string;
  /** App chrome language. The terminal grid itself always stays LTR. */
  locale: "en" | "ar";
  /** Optional terminal text-color override for DEFAULT (uncolored) text only - does not
   *  touch a CLI's own ANSI colors. Empty = use the theme foreground. */
  termForeground?: string;
  /** Render terminal text at a heavier weight. */
  termBold?: boolean;
}

interface SettingsState extends SettingsPersist {
  setTheme: (t: ThemeMode) => void;
  setTerminalTheme: (t: TerminalTheme) => void;
  setFontSize: (n: number) => void;
  setDefaultShell: (s: ShellKind) => void;
  setDefaultCwd: (c: string) => void;
  setTermForeground: (c: string | undefined) => void;
  setTermBold: (b: boolean) => void;
  setLocale: (l: "en" | "ar") => void;
  hydrate: (data: Partial<SettingsPersist>) => void;
  serialize: () => SettingsPersist;
}

const DEFAULTS: SettingsPersist = {
  theme: "dark",
  terminalTheme: "dark",
  fontSize: 14,
  defaultShell: { kind: "powershell" },
  defaultCwd: undefined,
  termForeground: undefined,
  termBold: false,
  locale: "en",
};

const THEMES: readonly ThemeMode[] = ["dark", "light", "system"];
const TERM_THEMES: readonly TerminalTheme[] = ["dark", "light", "match"];
const SHELL_KINDS = ["powershell", "cmd", "wsl", "custom"] as const;

/** Boundary validation for the persisted blob: it is untrusted (hand-edited, corrupt,
 *  or from an older build). Every bad field falls back to its default instead of
 *  reaching xterm (a fontSize of 0/NaN/500 breaks the grid). */
function sanitize(data: Partial<SettingsPersist> | undefined): SettingsPersist {
  const d = data ?? {};
  const fontSize =
    typeof d.fontSize === "number" && Number.isFinite(d.fontSize)
      ? Math.max(9, Math.min(28, Math.round(d.fontSize)))
      : DEFAULTS.fontSize;
  const theme = THEMES.includes(d.theme as ThemeMode) ? (d.theme as ThemeMode) : DEFAULTS.theme;
  const terminalTheme = TERM_THEMES.includes(d.terminalTheme as TerminalTheme)
    ? (d.terminalTheme as TerminalTheme)
    : DEFAULTS.terminalTheme;
  const shell = d.defaultShell as ShellKind | undefined;
  const defaultShell =
    shell &&
    typeof shell === "object" &&
    SHELL_KINDS.includes(shell.kind) &&
    (shell.kind !== "custom" || typeof shell.program === "string")
      ? shell
      : DEFAULTS.defaultShell;
  const defaultCwd =
    typeof d.defaultCwd === "string" && d.defaultCwd.trim() ? d.defaultCwd : undefined;
  const termForeground =
    typeof d.termForeground === "string" && d.termForeground.trim() ? d.termForeground : undefined;
  const termBold = typeof d.termBold === "boolean" ? d.termBold : DEFAULTS.termBold;
  const locale = d.locale === "ar" ? "ar" : "en";
  return { theme, terminalTheme, fontSize, defaultShell, defaultCwd, termForeground, termBold, locale };
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULTS,
  setTheme: (theme) => set({ theme }),
  setTerminalTheme: (terminalTheme) => set({ terminalTheme }),
  setFontSize: (fontSize) => set({ fontSize: Math.max(9, Math.min(28, fontSize)) }),
  setDefaultShell: (defaultShell) => set({ defaultShell }),
  setDefaultCwd: (defaultCwd) => set({ defaultCwd }),
  setTermForeground: (termForeground) =>
    set({ termForeground: termForeground && termForeground.trim() ? termForeground : undefined }),
  setTermBold: (termBold) => set({ termBold }),
  setLocale: (locale) => set({ locale }),
  hydrate: (data) => set(sanitize(data)),
  serialize: () => {
    const {
      theme,
      terminalTheme,
      fontSize,
      defaultShell,
      defaultCwd,
      termForeground,
      termBold,
      locale,
    } = get();
    return { theme, terminalTheme, fontSize, defaultShell, defaultCwd, termForeground, termBold, locale };
  },
}));

/** Resolve the terminal color scheme, given the app's resolved theme. */
export function resolveTerminalTheme(
  terminalTheme: TerminalTheme,
  appResolved: "dark" | "light",
): "dark" | "light" {
  return terminalTheme === "match" ? appResolved : terminalTheme;
}
