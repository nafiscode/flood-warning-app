/**
 * Geometry of the Jaga mark (the Sheltered j), shared by the static files in public/brand/ and
 * the turning mark (components/brand/SpinningMark.tsx). TRIAL, 9 Oct 2026: the owner is trying a
 * mark that turns three times (canopy, dot and j together), rests, and turns again, with a ray from the dot while it turns and
 * lightning on the canopy. At rest it is exactly the static mark.
 */

export type MarkSpec = {
  /** Canopy: a dome from x0 to x1 with `scallops` scallops along its lower edge. */
  canopy: { x0: number; x1: number; top: number; base: number; scallops: number };
  dot: { cx: number; cy: number; r: number };
  /** The j: straight down from `top` to `bend` on the axis, then the hook through three curve points. */
  stem: { top: number; bend: number; hook: [number, number][]; width: number };
};

/** 64 px and up (jaga-mark.svg). */
export const FULL_MARK: MarkSpec = {
  canopy: { x0: 30, x1: 90, top: 8, base: 34, scallops: 4 },
  dot: { cx: 60, cy: 46, r: 6.5 },
  stem: {
    top: 63,
    bend: 92,
    hook: [
      [60, 106],
      [50, 112],
      [34, 110],
    ],
    width: 14,
  },
};

/** 16 to 63 px (jaga-mark-small.svg). */
export const SMALL_MARK: MarkSpec = {
  canopy: { x0: 20, x1: 100, top: 4, base: 34, scallops: 3 },
  dot: { cx: 60, cy: 47, r: 8.5 },
  stem: {
    top: 68,
    bend: 92,
    hook: [
      [60, 106],
      [49, 113],
      [30, 111],
    ],
    width: 17,
  },
};

export const MARK_VIEWBOX = "18 0 84 120";

const n1 = (v: number) => String(Math.round(v * 10) / 10);

/**
 * The canopy outline with its scallops shifted by `phase` (0 to 1) of one scallop width, as seen
 * when the umbrella turns about the stem. Phase 0 is the path of the static files, character for
 * character; a scallop leaving at one edge narrows and flattens while another enters opposite.
 */
export function canopyPath({ canopy }: MarkSpec, phase = 0): string {
  const { x0, x1, top, base, scallops } = canopy;
  const w = (x1 - x0) / scallops;
  const mid = (x0 + x1) / 2;
  const dip = (base - top) * 0.22;
  const shoulder = top + (base - top) * 0.35;
  const bulge = (x1 - x0) * 0.28;
  const t = ((phase % 1) + 1) % 1;

  // Scallop points along the lower edge, from right to left.
  const xs = [x1];
  for (let k = scallops - 1; k >= 0; k--) {
    const x = x0 + (k + t) * w;
    if (x1 - x > 1e-6 && x - x0 > 1e-6) xs.push(x);
  }
  xs.push(x0);

  let d = `M${n1(x0)} ${n1(base)} C${n1(x0)} ${n1(shoulder)} ${n1(mid - bulge)} ${n1(top)} ${n1(mid)} ${n1(top)} C${n1(mid + bulge)} ${n1(top)} ${n1(x1)} ${n1(shoulder)} ${n1(x1)} ${n1(base)}`;
  let a = x1;
  for (const b of xs.slice(1)) {
    d += ` Q${n1((a + b) / 2)} ${n1(base - dip * ((a - b) / w))} ${n1(b)} ${n1(base)}`;
    a = b;
  }
  return `${d} Z`;
}

/**
 * The j as it turns about its own upright with the dot: the hook swings round, so from the front
 * it shortens, shows edge-on at a quarter turn, points the other way at a half turn, and comes
 * back. `turnDeg` 0 is the path of the static files, character for character.
 */
export function stemPath({ dot, stem }: MarkSpec, turnDeg = 0): string {
  const across = Math.cos((turnDeg * Math.PI) / 180);
  const hook = stem.hook.map(([x, y]) => `${n1(dot.cx + (x - dot.cx) * across)} ${n1(y)}`);
  return `M${n1(dot.cx)} ${n1(stem.top)} V${n1(stem.bend)} C${hook.join(" ")}`;
}

/**
 * The mark on the dot while it turns with the canopy: it comes round the front once per turn and
 * is out of sight (`rx` 0) at rest and while it is at the back. `turnDeg` 0 is the rest position.
 */
export function dotMark(
  { dot }: MarkSpec,
  turnDeg: number,
): { cx: number; rx: number; ry: number } {
  const a = ((turnDeg + 180) * Math.PI) / 180;
  const facing = Math.cos(a);
  const ry = dot.r * 0.45;
  return { cx: dot.cx + dot.r * 0.5 * Math.sin(a), rx: facing > 0 ? ry * facing : 0, ry };
}

/**
 * The ray from the dot while it turns, like a radar or lighthouse beam seen from the side: a
 * narrow cone from the dot toward wherever the dot is facing, longest when it faces left or
 * right, fainter while it points away from the viewer, and absent at rest. `progress` is how far
 * through the three turns we are (0 to 1); the ray fades in after the start and out before the end.
 */
export function ray(
  { dot }: MarkSpec,
  turnDeg: number,
  progress: number,
): { points: string; tipX: number; opacity: number } | null {
  const a = ((turnDeg + 180) * Math.PI) / 180;
  const reach = 40 * Math.sin(a);
  const strength = Math.sin(Math.PI * Math.min(1, Math.max(0, progress))) ** 0.6;
  if (Math.abs(reach) < 2 || strength < 0.02) return null;
  const tipX = dot.cx + reach;
  const half = dot.r * 1.15;
  return {
    points: `${n1(dot.cx)},${n1(dot.cy)} ${n1(tipX)},${n1(dot.cy - half)} ${n1(tipX)},${n1(dot.cy + half)}`,
    tipX,
    opacity: strength * (Math.cos(a) > 0 ? 1 : 0.45),
  };
}

/** Three turns, then a rest, then again. */
export const TURNS = 3;
export const TURN_MS = 9000;
export const REST_MS = 3000;

/**
 * Lightning striking the canopy from the empty space above it: three shapes, drawn for the small
 * mark (the full mark scales them). The header leaves only about 5 px above the logo, so the two
 * tall ones come down over the canopy's shoulders, where there is room, and a small pair over
 * the middle; none is drawn inside the canopy, and none rises more than 14 units above the box.
 * They flash in turn, one every 5 seconds (the timing is in app/globals.css).
 */
export const BOLTS = [
  { kind: "fill", d: "M38 -13 L24 4 H31 L25 18 L43 0 H35 L41 -13 Z" },
  { kind: "line", d: "M92 -13 L86 -3 L93 -1 L88 11 M90 -2 L99 5" },
  { kind: "line", d: "M56 -13 L52 -6 L57 -5 L54 2 M67 -14 L63 -8 L68 -7 L65 1" },
] as const;

/** Rest, a gentle start, a steady turn, a gentle stop: 0 to 1 over 0 to 1, flat at both ends. */
export function easeInOut(p: number): number {
  const x = Math.min(1, Math.max(0, p));
  return (1 - Math.cos(Math.PI * x)) / 2;
}
