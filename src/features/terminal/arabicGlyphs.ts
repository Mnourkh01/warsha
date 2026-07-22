// Arabic glyph shaping for the terminal grid, done as a 1:1 codepoint substitution so it
// works under ANY xterm renderer (WebGL included) and never changes the column count.
//
// Why this exists: xterm.js draws each cell's codepoint in isolation, so Arabic base
// letters render as disconnected isolated forms. Native terminals (Windows Terminal, Warp)
// shape at render time via DirectWrite/HarfBuzz; xterm cannot (issue #701). Substituting
// each base letter with its contextual Arabic Presentation Form (U+FE70-FEFF) gives the
// renderer glyphs that already carry their connecting strokes - connected Arabic on a grid.
//
// ORDER SEMANTICS (the non-obvious part): the `claude` TUI applies the bidi algorithm
// itself before printing (verified against its bundled bidi-js: reordering is
// unconditionally on, no opt-out), so Arabic arrives in VISUAL order - the char that
// renders leftmost comes first. That means for a char at index i, its LOGICAL predecessor
// is the char at i+1 (screen right) and its logical successor is at i-1 (screen left).
// Joining forms are computed with those roles, which yields exactly correct shapes for
// claude output. Plain logical-order shell output was already displayed backwards in every
// non-bidi terminal (Windows Terminal included); it stays backwards but connected here.
//
// Copying shaped text yields presentation-form codepoints - still valid, readable Arabic
// when pasted anywhere.

// Per letter: [isolated, final] for right-joining letters, [isolated, final, initial,
// medial] for dual-joining ones. Standard Unicode Presentation Forms-B layout.
const FORMS: Record<number, number[]> = {
  0x0621: [0xfe80], // hamza: never joins
  0x0622: [0xfe81, 0xfe82],
  0x0623: [0xfe83, 0xfe84],
  0x0624: [0xfe85, 0xfe86],
  0x0625: [0xfe87, 0xfe88],
  0x0626: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c],
  0x0627: [0xfe8d, 0xfe8e],
  0x0628: [0xfe8f, 0xfe90, 0xfe91, 0xfe92],
  0x0629: [0xfe93, 0xfe94],
  0x062a: [0xfe95, 0xfe96, 0xfe97, 0xfe98],
  0x062b: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c],
  0x062c: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0],
  0x062d: [0xfea1, 0xfea2, 0xfea3, 0xfea4],
  0x062e: [0xfea5, 0xfea6, 0xfea7, 0xfea8],
  0x062f: [0xfea9, 0xfeaa],
  0x0630: [0xfeab, 0xfeac],
  0x0631: [0xfead, 0xfeae],
  0x0632: [0xfeaf, 0xfeb0],
  0x0633: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4],
  0x0634: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8],
  0x0635: [0xfeb9, 0xfeba, 0xfebb, 0xfebc],
  0x0636: [0xfebd, 0xfebe, 0xfebf, 0xfec0],
  0x0637: [0xfec1, 0xfec2, 0xfec3, 0xfec4],
  0x0638: [0xfec5, 0xfec6, 0xfec7, 0xfec8],
  0x0639: [0xfec9, 0xfeca, 0xfecb, 0xfecc],
  0x063a: [0xfecd, 0xfece, 0xfecf, 0xfed0],
  0x0640: [0x0640, 0x0640, 0x0640, 0x0640], // tatweel: joins both sides, keeps its glyph
  0x0641: [0xfed1, 0xfed2, 0xfed3, 0xfed4],
  0x0642: [0xfed5, 0xfed6, 0xfed7, 0xfed8],
  0x0643: [0xfed9, 0xfeda, 0xfedb, 0xfedc],
  0x0644: [0xfedd, 0xfede, 0xfedf, 0xfee0],
  0x0645: [0xfee1, 0xfee2, 0xfee3, 0xfee4],
  0x0646: [0xfee5, 0xfee6, 0xfee7, 0xfee8],
  0x0647: [0xfee9, 0xfeea, 0xfeeb, 0xfeec],
  0x0648: [0xfeed, 0xfeee],
  0x0649: [0xfeef, 0xfef0],
  0x064a: [0xfef1, 0xfef2, 0xfef3, 0xfef4],
};

// Harakat and other zero-width marks sit between letters without breaking the join.
function isTransparent(code: number): boolean {
  return (
    (code >= 0x064b && code <= 0x065f) ||
    code === 0x0670 ||
    (code >= 0x06d6 && code <= 0x06dc) ||
    (code >= 0x06df && code <= 0x06e4)
  );
}

function isLetter(code: number): boolean {
  return code in FORMS;
}

// A letter accepts a join from its logical predecessor iff it has a final form.
function acceptsJoin(code: number): boolean {
  return FORMS[code].length >= 2;
}

// A letter joins toward its logical successor iff it is dual-joining.
function joinsForward(code: number): boolean {
  return FORMS[code].length === 4;
}

// Nearest letter in `chars` starting at `from`, stepping by `dir`, skipping transparent
// marks. Anything else (space, punctuation, escape-sequence ASCII) breaks the run.
function neighborLetter(chars: number[], from: number, dir: -1 | 1): number | null {
  for (let i = from; i >= 0 && i < chars.length; i += dir) {
    const c = chars[i];
    if (isLetter(c)) return c;
    if (!isTransparent(c)) return null;
  }
  return null;
}

const HAS_ARABIC = /[ء-ي]/;

/**
 * Substitute Arabic base letters with their contextual presentation forms, assuming the
 * text is in VISUAL order (what the claude TUI emits). 1:1 per char - length, columns and
 * escape sequences are untouched. No-op (same string back) when no Arabic is present.
 */
export function shapeArabicVisual(text: string): string {
  if (!HAS_ARABIC.test(text)) return text;
  const chars: number[] = [];
  for (const ch of text) chars.push(ch.codePointAt(0) as number);
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (!isLetter(c)) {
      out += String.fromCodePoint(c);
      continue;
    }
    // Visual order: screen-right neighbor (i+1) is the logical predecessor, screen-left
    // neighbor (i-1) is the logical successor.
    const logicalPrev = neighborLetter(chars, i + 1, 1);
    const logicalNext = neighborLetter(chars, i - 1, -1);
    const joinPrev = logicalPrev !== null && joinsForward(logicalPrev) && acceptsJoin(c);
    const joinNext = logicalNext !== null && joinsForward(c) && acceptsJoin(logicalNext);
    const forms = FORMS[c];
    const form = joinPrev && joinNext ? forms[3] : joinPrev ? forms[1] : joinNext ? forms[2] : forms[0];
    out += String.fromCodePoint(form);
  }
  return out;
}
