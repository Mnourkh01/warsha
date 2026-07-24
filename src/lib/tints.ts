// Per-session accent colors ("tints"). Stored as an id, never a hex value, so each
// theme can map the id to a palette that stays readable on its background (see the
// --tint-* variables in global.css).

export const TINTS = ["red", "orange", "yellow", "green", "cyan", "blue", "pink"] as const;
export type Tint = (typeof TINTS)[number];

export function isTint(value: unknown): value is Tint {
  return typeof value === "string" && (TINTS as readonly string[]).includes(value);
}

/** The next tint in the cycle: none -> red -> ... -> pink -> none. One button, no popover. */
export function nextTint(current: Tint | undefined): Tint | undefined {
  if (current === undefined) return TINTS[0];
  const i = TINTS.indexOf(current);
  return i === TINTS.length - 1 ? undefined : TINTS[i + 1];
}

/** CSS classes for an optionally tinted element ("tinted tint-red", or ""). */
export function tintClasses(tint: Tint | undefined): string {
  return tint ? ` tinted tint-${tint}` : "";
}

/** Default tint for a NEW session: the first color its workspace is not using yet, so
 *  neighbors stay tellable-apart; when all seven are taken, cycle by position. */
export function autoTint(taken: Array<Tint | undefined>, seed: number): Tint {
  const used = new Set(taken.filter((t): t is Tint => t !== undefined));
  return TINTS.find((t) => !used.has(t)) ?? TINTS[seed % TINTS.length];
}
