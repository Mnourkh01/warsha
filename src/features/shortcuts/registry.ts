import type { Strings } from "../../lib/i18n";

/** Rebindable app actions. Fixed terminal chords (copy/paste/SIGINT/Escape) are NOT
 *  here on purpose: remapping them breaks the terminal contract. */
export type ShortcutAction =
  | "workspaceNext"
  | "workspacePrev"
  | "sessionNext"
  | "sessionPrev"
  | "palette"
  | "sidebar"
  | "blueprint"
  | "find"
  | "maximize"
  | "broadcast";

/** User overrides: action -> chord string. Only differences from defaults are stored. */
export type ShortcutOverrides = Partial<Record<ShortcutAction, string>>;

export interface ShortcutDef {
  action: ShortcutAction;
  /** First chord is the primary one shown in the settings UI. */
  defaults: string[];
  label: (t: Strings) => string;
}

/** Order = display order in Settings. Workspace switching first: workspaces are the
 *  unit the user actually switches between (a workspace shows all its sessions). */
export const SHORTCUT_DEFS: ShortcutDef[] = [
  { action: "workspaceNext", defaults: ["Ctrl+Shift+PageDown"], label: (t) => t.scWorkspaceNext },
  { action: "workspacePrev", defaults: ["Ctrl+Shift+PageUp"], label: (t) => t.scWorkspacePrev },
  { action: "sessionNext", defaults: ["Ctrl+PageDown"], label: (t) => t.scSessionNext },
  { action: "sessionPrev", defaults: ["Ctrl+PageUp"], label: (t) => t.scSessionPrev },
  { action: "palette", defaults: ["Ctrl+K", "Ctrl+Shift+P"], label: (t) => t.scPalette },
  { action: "sidebar", defaults: ["Ctrl+Shift+B"], label: (t) => t.scSidebar },
  { action: "blueprint", defaults: ["Ctrl+Shift+D"], label: (t) => t.scPlanner },
  { action: "find", defaults: ["Ctrl+Shift+F"], label: (t) => t.scFind },
  { action: "maximize", defaults: ["Ctrl+Shift+M"], label: (t) => t.scMaximize },
  { action: "broadcast", defaults: ["Ctrl+Shift+I"], label: (t) => t.scBroadcast },
];

/** Chords the terminal contract owns; never assignable to an action. */
export const RESERVED_CHORDS: { chord: string; label: (t: Strings) => string }[] = [
  { chord: "Ctrl+C", label: (t) => t.scSigint },
  { chord: "Ctrl+Shift+C", label: (t) => t.scCopy },
  { chord: "Ctrl+V", label: (t) => t.scPaste },
  { chord: "Ctrl+Shift+V", label: (t) => t.scPaste },
];

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph"]);

/** Normalize a keyboard event to a chord string ("Ctrl+Shift+PageDown"), or null when
 *  the event is a bare modifier / Meta chord / unidentifiable key. */
export function chordFromEvent(e: Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey"
>): string | null {
  if (e.metaKey) return null;
  if (!e.key || MODIFIER_KEYS.has(e.key) || e.key === "Unidentified" || e.key === "Dead") {
    return null;
  }
  const key = e.key.length === 1 ? (e.key === " " ? "Space" : e.key.toUpperCase()) : e.key;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/** A chord is bindable when it parses AND carries Ctrl or Alt: bare keys, Shift+key,
 *  and F-keys must keep reaching the shell/TUI untouched. */
export function isValidChord(chord: unknown): chord is string {
  if (typeof chord !== "string" || chord.length > 40) return false;
  const parts = chord.split("+");
  if (parts.length < 2) return false;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (!key || MODIFIER_KEYS.has(key)) return false;
  // Escape is the universal cancel key (dialogs, find bar, capture UI). Any Escape
  // combination is unbindable: Ctrl/Alt+Escape are OS chords on Windows anyway.
  if (key === "Escape") return false;
  const allowed = ["Ctrl", "Alt", "Shift"];
  const seen = new Set<string>();
  for (const m of mods) {
    if (!allowed.includes(m) || seen.has(m)) return false;
    seen.add(m);
  }
  if (!seen.has("Ctrl") && !seen.has("Alt")) return false;
  // Canonical order check keeps stored values comparable by plain equality.
  const ordered = allowed.filter((m) => seen.has(m));
  if (mods.join("+") !== ordered.join("+")) return false;
  if (key.length === 1 && key !== key.toUpperCase()) return false;
  return true;
}

/** Effective chords per action: an override replaces the defaults; a DEFAULT chord that
 *  now collides with someone's override is silently disabled so one chord never fires
 *  two actions. */
export function effectiveChords(overrides: ShortcutOverrides): Map<ShortcutAction, string[]> {
  const taken = new Set<string>();
  for (const def of SHORTCUT_DEFS) {
    const ov = overrides[def.action];
    if (ov && isValidChord(ov)) taken.add(ov);
  }
  const out = new Map<ShortcutAction, string[]>();
  for (const def of SHORTCUT_DEFS) {
    const ov = overrides[def.action];
    if (ov && isValidChord(ov)) {
      out.set(def.action, [ov]);
    } else {
      out.set(def.action, def.defaults.filter((c) => !taken.has(c)));
    }
  }
  return out;
}

/** Resolve a keydown to an action under the current overrides, or null. */
export function matchAction(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">,
  overrides: ShortcutOverrides,
): ShortcutAction | null {
  const chord = chordFromEvent(e);
  if (!chord) return null;
  for (const [action, chords] of effectiveChords(overrides)) {
    if (chords.includes(chord)) return action;
  }
  return null;
}

/** First effective chord for an action - what tooltips and palette hints display.
 *  Empty string when every default was disabled by someone's override (rare). */
export function primaryChord(action: ShortcutAction, overrides: ShortcutOverrides): string {
  return effectiveChords(overrides).get(action)?.[0] ?? "";
}

/** Who owns this chord right now? Used for conflict messages before assigning. */
export function chordOwner(
  chord: string,
  overrides: ShortcutOverrides,
  exclude?: ShortcutAction,
): { label: (t: Strings) => string } | null {
  const reserved = RESERVED_CHORDS.find((r) => r.chord === chord);
  if (reserved) return reserved;
  const map = effectiveChords(overrides);
  for (const def of SHORTCUT_DEFS) {
    if (def.action === exclude) continue;
    if (map.get(def.action)?.includes(chord)) return def;
  }
  return null;
}

/** While the settings capture UI is recording a new chord it owns the keyboard; the
 *  global App handler checks this flag and stands down. Module-level on purpose:
 *  transient UI state, never persisted, no store churn per keypress. */
let capturing = false;
export function setCapturingShortcut(v: boolean): void {
  capturing = v;
}
export function isCapturingShortcut(): boolean {
  return capturing;
}
