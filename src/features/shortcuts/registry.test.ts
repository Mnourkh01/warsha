import { describe, expect, it } from "vitest";
import {
  chordFromEvent,
  chordOwner,
  effectiveChords,
  isValidChord,
  matchAction,
} from "./registry";

const ev = (key: string, mods: Partial<Record<"ctrl" | "shift" | "alt" | "meta", boolean>> = {}) => ({
  key,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: !!mods.meta,
});

describe("chordFromEvent", () => {
  it("normalizes letters to uppercase with canonical modifier order", () => {
    expect(chordFromEvent(ev("k", { ctrl: true }))).toBe("Ctrl+K");
    expect(chordFromEvent(ev("P", { ctrl: true, shift: true }))).toBe("Ctrl+Shift+P");
    expect(chordFromEvent(ev("PageDown", { ctrl: true, shift: true }))).toBe(
      "Ctrl+Shift+PageDown",
    );
    expect(chordFromEvent(ev(" ", { ctrl: true }))).toBe("Ctrl+Space");
  });

  it("returns null for bare modifiers, Meta chords, and dead keys", () => {
    expect(chordFromEvent(ev("Control", { ctrl: true }))).toBeNull();
    expect(chordFromEvent(ev("Shift", { shift: true }))).toBeNull();
    expect(chordFromEvent(ev("k", { meta: true }))).toBeNull();
    expect(chordFromEvent(ev("Dead", { ctrl: true }))).toBeNull();
    expect(chordFromEvent(ev("Unidentified", { ctrl: true }))).toBeNull();
  });
});

describe("isValidChord", () => {
  it("requires Ctrl or Alt so plain keys keep reaching the shell", () => {
    expect(isValidChord("Ctrl+K")).toBe(true);
    expect(isValidChord("Alt+F4")).toBe(true);
    expect(isValidChord("Ctrl+Alt+Shift+PageDown")).toBe(true);
    expect(isValidChord("Shift+K")).toBe(false);
    expect(isValidChord("K")).toBe(false);
    expect(isValidChord("F5")).toBe(false);
  });

  it("rejects malformed values from an untrusted blob", () => {
    expect(isValidChord(42)).toBe(false);
    expect(isValidChord("")).toBe(false);
    expect(isValidChord("Ctrl+")).toBe(false);
    expect(isValidChord("Ctrl+Ctrl+K")).toBe(false);
    expect(isValidChord("Shift+Ctrl+K")).toBe(false); // non-canonical order
    expect(isValidChord("Ctrl+k")).toBe(false); // lowercase letter
    expect(isValidChord("Ctrl+Shift")).toBe(false); // modifier as key
  });

  it("rejects Escape in any combination, Escape stays the universal cancel key", () => {
    expect(isValidChord("Ctrl+Escape")).toBe(false);
    expect(isValidChord("Alt+Escape")).toBe(false);
    expect(isValidChord("Ctrl+Alt+Escape")).toBe(false);
  });
});

describe("matchAction", () => {
  it("resolves default chords", () => {
    expect(matchAction(ev("k", { ctrl: true }), {})).toBe("palette");
    expect(matchAction(ev("p", { ctrl: true, shift: true }), {})).toBe("palette");
    expect(matchAction(ev("PageDown", { ctrl: true }), {})).toBe("sessionNext");
    expect(matchAction(ev("PageUp", { ctrl: true, shift: true }), {})).toBe("workspacePrev");
    expect(matchAction(ev("d", { ctrl: true, shift: true }), {})).toBe("blueprint");
    expect(matchAction(ev("d", { ctrl: true }), {})).toBeNull();
  });

  it("an override replaces the defaults for that action", () => {
    const ov = { workspaceNext: "Ctrl+Alt+Right" };
    expect(matchAction(ev("ArrowRight", { ctrl: true, alt: true }), ov)).toBeNull(); // key name is ArrowRight
    expect(matchAction(ev("PageDown", { ctrl: true, shift: true }), ov)).toBeNull();
    const ov2 = { workspaceNext: "Ctrl+Alt+ArrowRight" };
    expect(matchAction(ev("ArrowRight", { ctrl: true, alt: true }), ov2)).toBe("workspaceNext");
  });

  it("a default that collides with an override is disabled, one chord one action", () => {
    // User moved "find" onto the palette's default chord.
    const ov = { find: "Ctrl+K" };
    expect(matchAction(ev("k", { ctrl: true }), ov)).toBe("find");
    // Palette keeps its surviving alias.
    expect(matchAction(ev("p", { ctrl: true, shift: true }), ov)).toBe("palette");
    expect(effectiveChords(ov).get("palette")).toEqual(["Ctrl+Shift+P"]);
  });
});

describe("chordOwner", () => {
  it("reports reserved terminal chords and current holders", () => {
    expect(chordOwner("Ctrl+C", {})).not.toBeNull();
    expect(chordOwner("Ctrl+Shift+C", {})).not.toBeNull();
    expect(chordOwner("Ctrl+K", {})).not.toBeNull();
    expect(chordOwner("Ctrl+Alt+Z", {})).toBeNull();
    // excluding the action being edited so re-assigning its own chord is not a conflict
    expect(chordOwner("Ctrl+K", {}, "palette")).toBeNull();
  });
});
