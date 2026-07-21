import type { ITheme } from "@xterm/xterm";

// ANSI palettes tuned for the violet-charcoal (IDE) surfaces. The violet UI accent is
// deliberately NOT reused for ANSI so terminal colors never read as chrome selection.

export const darkTerminalTheme: ITheme = {
  background: "#100e18",
  foreground: "#d9d5ea",
  cursor: "#8b7cf6",
  cursorAccent: "#100e18",
  selectionBackground: "#332f4d",
  black: "#2a2740",
  red: "#e5687e",
  green: "#69c48c",
  yellow: "#e0b25a",
  blue: "#7e9cf5",
  magenta: "#b98cf0",
  cyan: "#5fc2c0",
  white: "#d5d1e4",
  brightBlack: "#6f6a85",
  brightRed: "#f07d90",
  brightGreen: "#84d4a3",
  brightYellow: "#eec778",
  brightBlue: "#96b0f8",
  brightMagenta: "#cca6f5",
  brightCyan: "#84d6d4",
  brightWhite: "#f1eef8",
};

export const lightTerminalTheme: ITheme = {
  background: "#f4f2f8",
  foreground: "#262336",
  cursor: "#6d4fd6",
  cursorAccent: "#f4f2f8",
  selectionBackground: "#ddd7ee",
  black: "#33304a",
  red: "#c23a56",
  green: "#3f8a5e",
  yellow: "#8a6414",
  blue: "#3f5bb0",
  magenta: "#8148ad",
  cyan: "#2c7f86",
  white: "#c7c2d8",
  brightBlack: "#6f6a85",
  brightRed: "#d6465f",
  brightGreen: "#4a9d6b",
  brightYellow: "#9a7420",
  brightBlue: "#4c69c2",
  brightMagenta: "#9455c0",
  brightCyan: "#348f96",
  brightWhite: "#efecf7",
};

export function terminalThemeFor(mode: "dark" | "light", foreground?: string): ITheme {
  const base = mode === "dark" ? darkTerminalTheme : lightTerminalTheme;
  return foreground ? { ...base, foreground } : base;
}

/** The plain background hex for a mode - used to paint the xterm viewport DOM directly. */
export function terminalBg(mode: "dark" | "light"): string {
  return (mode === "dark" ? darkTerminalTheme.background : lightTerminalTheme.background) as string;
}
