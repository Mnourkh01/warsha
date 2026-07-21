import type { ThemeMode } from "./types";

function systemPrefersDark(): boolean {
  // Dark is the safe default when matchMedia is unavailable (tests, odd webviews).
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(mode: ThemeMode): "dark" | "light" {
  if (mode === "system") return systemPrefersDark() ? "dark" : "light";
  return mode;
}

/** Apply the resolved theme to <html data-theme>. */
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolveTheme(mode);
}
