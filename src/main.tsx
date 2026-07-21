import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

import "./styles/global.css";
import "./styles/app.css";

import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";

import { applyTheme } from "./lib/theme";
import { useSettings } from "./store/settings";
import { initPersistence } from "./store/persistence";

async function boot() {
  // Load the saved workspace first so the first paint uses the right theme.
  await initPersistence();
  applyTheme(useSettings.getState().theme);

  // Fonts must be measured-ready before any terminal opens, or the grid misaligns.
  try {
    await Promise.allSettled([
      document.fonts.load('14px "IBM Plex Mono"'),
      document.fonts.load('14px "IBM Plex Sans Arabic"'),
    ]);
    await document.fonts.ready;
  } catch {
    /* font loading is best-effort */
  }

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void boot();
