import { describe, expect, it } from "vitest";
import { shapeArabicVisual } from "./arabicGlyphs";

// Inputs are in VISUAL order (as the claude TUI emits): the first char is the one that
// renders leftmost. "مرحبا" (logical م ر ح ب ا) arrives as "ابحرم". Expected outputs are
// written as \uFExx escapes (Presentation Forms-B) so the test is byte-exact and reviewable.

describe("shapeArabicVisual", () => {
  it("returns ASCII-only text unchanged (fast path)", () => {
    const s = "PS C:\\new porject> echo hi\r\n";
    expect(shapeArabicVisual(s)).toBe(s);
  });

  it("shapes a visual-order word into correct contextual forms", () => {
    // مرحبا visual: ا(final) ب(medial) ح(initial) ر(final) م(initial)
    expect(shapeArabicVisual("ابحرم")).toBe("\uFE8E\uFE92\uFEA3\uFEAE\uFEE3");
  });

  it("matches the claude buffer example from the field: جاهز sent as زهاج", () => {
    // ز(final) ه(initial) ا(final) ج(initial)
    expect(shapeArabicVisual("زهاج")).toBe("\uFEB0\uFEEB\uFE8E\uFE9F");
  });

  it("keeps escape sequences and English intact around Arabic", () => {
    expect(shapeArabicVisual("\x1b[31mابحرم\x1b[0m ok")).toBe(
      "\x1b[31m\uFE8E\uFE92\uFEA3\uFEAE\uFEE3\x1b[0m ok",
    );
  });

  it("breaks joining at spaces", () => {
    // Two single-letter words must not join across the space: both stay isolated.
    expect(shapeArabicVisual("د ب")).toBe("\uFEA9\u0020\uFE8F");
  });

  it("never joins toward hamza", () => {
    // ء has no final form; ب next to it stays isolated too.
    expect(shapeArabicVisual("ءب")).toBe("\uFE80\uFE8F");
  });

  it("skips transparent harakat when finding join partners", () => {
    // ا + fatha + ب: the fatha must not break the ا/ب join.
    expect(shapeArabicVisual("اَب")).toBe("\uFE8E\u064E\uFE91");
  });

  it("treats tatweel as a dual-joining connector that keeps its own glyph", () => {
    expect(shapeArabicVisual("ـب")).toBe("\u0640\uFE91");
  });
});
