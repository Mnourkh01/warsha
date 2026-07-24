// In-app auto-update via the Tauri updater plugin. The endpoint is latest.json on the
// newest GitHub release; artifacts are signature-checked against the public key baked
// into tauri.conf.json, so a compromised download can never install.

import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface AvailableUpdate {
  version: string;
  notes?: string;
}

/** Manual fallback when the in-app install fails (proxy, disk, antivirus). */
export const RELEASES_URL = "https://github.com/Mnourkh01/warsha/releases/latest";

// The plugin's Update handle is kept module-private; the toast and the settings dialog
// both install "whatever the last successful check found".
let pending: Update | null = null;
let installing = false;

/** Ask the release endpoint for a newer version. Null = up to date. Throws on network
 *  or endpoint failure - callers decide whether that is silent (startup) or shown
 *  (explicit check from settings). */
export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const update = await check();
  if (!update) {
    pending = null;
    return null;
  }
  pending = update;
  return { version: update.version, notes: update.body ?? undefined };
}

/** Download + install the update found by the last check, then relaunch. On Windows the
 *  app exits by itself when the NSIS installer starts, so code after relaunch() may
 *  never run. Progress: 0-100, or null while the total size is unknown. */
export async function installUpdate(onProgress: (percent: number | null) => void): Promise<void> {
  if (!pending) throw new Error("no update to install");
  if (installing) return; // double-click from toast + settings at once
  installing = true;
  try {
    let total = 0;
    let received = 0;
    await pending.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
        onProgress(total ? 0 : null);
      } else if (event.event === "Progress") {
        received += event.data.chunkLength;
        // Hold 100 for the install phase; the download alone never reports done.
        if (total) onProgress(Math.min(99, Math.round((received / total) * 100)));
      } else {
        onProgress(100);
      }
    });
    await relaunch();
  } finally {
    installing = false;
  }
}
