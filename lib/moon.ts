/**
 * The moon, for the night sky on the weather page (the owner's request, 10 Oct 2026).
 *
 * Phase from the mean synodic month, which is right to within about half a day — enough to
 * draw the shape in the sky and name it, and it needs no data and no request. The moon is
 * decoration and a date, never anything a decision rests on.
 */

/** 6 January 2000, 18:14 UTC: a new moon, the epoch the age is counted from. */
export const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
/** The mean time from one new moon to the next, in days. */
export const SYNODIC_DAYS = 29.530588853;

export const MOON_PHASES = [
  "new",
  "waxingCrescent",
  "firstQuarter",
  "waxingGibbous",
  "full",
  "waningGibbous",
  "lastQuarter",
  "waningCrescent",
] as const;
export type MoonPhase = (typeof MOON_PHASES)[number];

export type Moon = {
  /** Days since the last new moon, 0 to 29.53. */
  age: number;
  /** How much of the disc is lit, 0 at new moon and 1 at full. */
  lit: number;
  /** True while the moon is filling (the lit side faces west, as drawn on the right here). */
  waxing: boolean;
  phase: MoonPhase;
};

export function moonAt(now: number): Moon {
  const days = (now - NEW_MOON) / 86_400_000;
  const age = ((days % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS;
  const turn = (age / SYNODIC_DAYS) * 2 * Math.PI;
  // 0 at new moon, 1 at full: the lit fraction of the disc as it is seen from here.
  const lit = (1 - Math.cos(turn)) / 2;
  const waxing = age < SYNODIC_DAYS / 2;
  return { age, lit, waxing, phase: phaseOf(age) };
}

/** The eight names, each covering its eighth of the month. */
export function phaseOf(age: number): MoonPhase {
  const eighth = SYNODIC_DAYS / 8;
  // Half an eighth either side of new, first quarter, full and last quarter.
  const index = Math.floor((age + eighth / 2) / eighth) % 8;
  return MOON_PHASES[index]!;
}

/**
 * The lit part of the moon as one SVG path on a disc of radius `r` about (0, 0).
 *
 * Two arcs: the outer edge of the disc, and the terminator, which is half an ellipse whose
 * width follows how much is lit. Nothing is returned at new moon, where nothing is lit.
 */
export function moonPath(lit: number, waxing: boolean, r = 10): string | null {
  const show = Math.min(1, Math.max(0, lit));
  if (show < 0.02) return null;
  if (show > 0.98) {
    return `M 0 ${-r} A ${r} ${r} 0 1 1 0 ${r} A ${r} ${r} 0 1 1 0 ${-r} Z`;
  }
  // The terminator is a circle seen at an angle: its half-width shrinks to nothing at the
  // quarters and grows back to r at new and full moon.
  const rx = Math.abs(r * Math.cos(show * Math.PI));
  const gibbous = show > 0.5;
  // The outer edge is drawn down the lit side; the terminator comes back up.
  const outer = waxing ? 1 : 0;
  // Past half, the terminator bulges the same way as the edge; before it, the other way.
  const inner = gibbous ? (waxing ? 1 : 0) : waxing ? 0 : 1;
  return [
    `M 0 ${-r}`,
    `A ${r} ${r} 0 0 ${outer} 0 ${r}`,
    `A ${rx.toFixed(3)} ${r} 0 0 ${inner} 0 ${-r}`,
    "Z",
  ].join(" ");
}
