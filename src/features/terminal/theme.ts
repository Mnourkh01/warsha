import type { ITheme } from "@xterm/xterm";

// Program colors are sacred: the 16 ANSI slots use STANDARD palettes (Campbell - the
// Windows Terminal default - for dark, One Half Light for light) so any program's output
// looks exactly like it does in a native terminal. Only the surface itself (background,
// cursor, selection) carries the Warsha violet identity - those are app chrome, not
// program output.

export const darkTerminalTheme: ITheme = {
  background: "#100e18",
  foreground: "#cccccc",
  cursor: "#8b7cf6",
  cursorAccent: "#100e18",
  selectionBackground: "#332f4d",
  black: "#0c0c0c",
  red: "#c50f1f",
  green: "#13a10e",
  yellow: "#c19c00",
  blue: "#0037da",
  magenta: "#881798",
  cyan: "#3a96dd",
  white: "#cccccc",
  brightBlack: "#767676",
  brightRed: "#e74856",
  brightGreen: "#16c60c",
  brightYellow: "#f9f1a5",
  brightBlue: "#3b78ff",
  brightMagenta: "#b4009e",
  brightCyan: "#61d6d6",
  brightWhite: "#f2f2f2",
};

export const lightTerminalTheme: ITheme = {
  background: "#f4f2f8",
  foreground: "#383a42",
  cursor: "#6d4fd6",
  cursorAccent: "#f4f2f8",
  selectionBackground: "#ddd7ee",
  black: "#383a42",
  red: "#e45649",
  green: "#50a14f",
  yellow: "#c18401",
  blue: "#0184bc",
  magenta: "#a626a4",
  cyan: "#0997b3",
  white: "#fafafa",
  brightBlack: "#4f525d",
  brightRed: "#df2c2c",
  brightGreen: "#31b53e",
  brightYellow: "#ecb218",
  brightBlue: "#2b8eff",
  brightMagenta: "#d55fde",
  brightCyan: "#29b9c7",
  brightWhite: "#ffffff",
};

export function terminalThemeFor(mode: "dark" | "light", foreground?: string): ITheme {
  const base = mode === "dark" ? darkTerminalTheme : lightTerminalTheme;
  return foreground ? { ...base, foreground } : base;
}

/** The plain background hex for a mode - used to paint the xterm viewport DOM directly. */
export function terminalBg(mode: "dark" | "light"): string {
  return (mode === "dark" ? darkTerminalTheme.background : lightTerminalTheme.background) as string;
}
