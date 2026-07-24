import type { ThemeMode } from "./types";

// On Windows, Tauri (wry) pins the WebView2 color scheme to the WINDOW theme, so
// `prefers-color-scheme` inside the WebView does NOT track the OS reliably - it reports
// whatever the window was last pinned to. The OS theme therefore comes from the Tauri
// window API (theme() + onThemeChanged, wired in App.tsx) and is cached here; matchMedia
// is only the seed for non-Tauri contexts (vitest, plain browser).

function matchMediaFallback(): "dark" | "light" {
  // Dark is the safe default when matchMedia is unavailable (tests, odd webviews).
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let systemTheme: "dark" | "light" = matchMediaFallback();

/** Cache the OS theme. Fed by the Tauri window-theme listener owned by App. */
export function setSystemTheme(t: "dark" | "light"): void {
  systemTheme = t;
}

export function resolveTheme(mode: ThemeMode): "dark" | "light" {
  return mode === "system" ? systemTheme : mode;
}

/** Apply the resolved theme to <html data-theme>. */
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = resolveTheme(mode);
}
