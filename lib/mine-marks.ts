/**
 * The marks for the person's own places on the map (the owner, 15 Oct 2026: their home and their
 * watched places looked almost the same as the river gauges, all round dots). Each now has its own
 * shape and a small, slow movement that says what it is:
 *
 *   home    A map pin with a house in its head: the place they set as theirs. A soft glow behind
 *           the head breathes in and out, like a light left on - someone is looking after it.
 *   watch   The place's own colour as a small dot inside four focus brackets that slowly close in
 *           on it and let go again: a place being kept in view. Brackets, not an eye: there are no
 *           eye icons anywhere in Jaga (docs/brand.md).
 *
 * Neither shape is round like a gauge's glass, and neither moves the way a gauge does (a gauge
 * ripples outwards only when its river is near or over the bank), so the two are never confused.
 * The colours stay the ones in lib/mine-colors.ts: never an alert hue. Under reduced motion every
 * mark is drawn still.
 */

export type MineKind = "home" | "watch";

/** The picture's size in CSS pixels; drawn at twice that for sharp phones (as the gauges are). */
export const MINE_IMAGE_SIZE = 64;
export const MINE_IMAGE_RATIO = 2;

/** One breath of the home's glow, and one close-and-let-go of the brackets, in ms. Slow on purpose. */
export const HOME_BREATH_MS = 3600;
export const WATCH_FOCUS_MS = 3200;

/** Frames a second while moving: these move slowly, so fewer than a gauge's 20 are enough. */
export const MINE_FPS = 15;

/** Where the home pin's tip sits below the picture's centre, in CSS pixels at icon-size 1. */
export const HOME_TIP_DY = 14;

export const mineImageName = (kind: MineKind, color: string, dark: boolean) =>
  `jaga-mine-${kind}-${color.replace("#", "").toLowerCase()}-${dark ? "night" : "day"}`;

type MinePaint = { outline: string; glyph: string; shadow: string };

/**
 * The outline that keeps a mark readable on any basemap and on the flood-risk colours: white by
 * day; by night the near-black of the dark map, because the night pins are light (mine-colors.ts).
 */
export function minePaint(dark: boolean): MinePaint {
  return dark
    ? { outline: "#0b1b24", glyph: "#0b1b24", shadow: "rgba(0,0,0,0.55)" }
    : { outline: "#ffffff", glyph: "#ffffff", shadow: "rgba(13,32,46,0.28)" };
}

/** 0 → 1 → 0 over one period, eased at both ends, so the movement has no jolt. */
export function breath(t: number, period: number): number {
  const phase = (((t / period) % 1) + 1) % 1;
  return (1 - Math.cos(phase * Math.PI * 2)) / 2;
}

/** The home pin: head and tip, in CSS pixels, centred on the picture. */
function homePath(ctx: CanvasRenderingContext2D, c: number, k: number, grow = 0) {
  const r = (11 + grow) * k;
  const cy = c - 10 * k;
  const tip = c + HOME_TIP_DY * k + grow * 0.6 * k;
  // A teardrop: the head's arc, then two tangents meeting at the tip. The tangent points sit at
  // acos(r / distance) either side of the line from the head's centre to the tip.
  const a = Math.acos(r / (tip - cy));
  ctx.beginPath();
  ctx.arc(c, cy, r, Math.PI / 2 + a, Math.PI / 2 - a + Math.PI * 2, false);
  ctx.lineTo(c, tip);
  ctx.closePath();
}

/**
 * Draws one frame of the person's home at time `t` (ms) on a square canvas of `size` device
 * pixels. Pure drawing: the same colour, theme and time always give the same picture.
 */
export function drawHome(
  ctx: CanvasRenderingContext2D,
  size: number,
  color: string,
  dark: boolean,
  t: number,
): void {
  const p = minePaint(dark);
  const k = size / MINE_IMAGE_SIZE;
  const c = size / 2;
  const glow = breath(t, HOME_BREATH_MS);
  ctx.clearRect(0, 0, size, size);

  // A small shadow on the ground at the tip: the pin stands on the place.
  ctx.beginPath();
  ctx.ellipse(c, c + HOME_TIP_DY * k, 5 * k, 1.8 * k, 0, 0, Math.PI * 2);
  ctx.fillStyle = p.shadow;
  ctx.fill();

  // The breathing glow behind the head.
  ctx.beginPath();
  ctx.arc(c, c - 10 * k, (13 + 7 * glow) * k, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.45 * (1 - glow) + 0.1;
  ctx.fill();
  ctx.globalAlpha = 1;

  // The pin, outlined so it stands off the map.
  homePath(ctx, c, k);
  ctx.lineJoin = "round";
  ctx.strokeStyle = p.outline;
  ctx.lineWidth = 3.5 * k;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();

  // The house in its head: a roof and a body with a door.
  const hx = c;
  const hy = c - 10 * k;
  ctx.beginPath();
  ctx.moveTo(hx - 6.2 * k, hy - 0.4 * k);
  ctx.lineTo(hx, hy - 6 * k);
  ctx.lineTo(hx + 6.2 * k, hy - 0.4 * k);
  ctx.strokeStyle = p.glyph;
  ctx.lineWidth = 2 * k;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(hx - 4.2 * k, hy - 1.4 * k, 8.4 * k, 6.6 * k);
  ctx.fillStyle = p.glyph;
  ctx.fill();
  ctx.beginPath();
  ctx.rect(hx - 1.3 * k, hy + 1.6 * k, 2.6 * k, 3.6 * k);
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Draws one frame of a watched place: its colour as a dot inside four focus brackets that close
 * in and let go. Pure drawing, like drawHome.
 */
export function drawWatch(
  ctx: CanvasRenderingContext2D,
  size: number,
  color: string,
  dark: boolean,
  t: number,
): void {
  const p = minePaint(dark);
  const k = size / MINE_IMAGE_SIZE;
  const c = size / 2;
  const focus = breath(t, WATCH_FOCUS_MS);
  ctx.clearRect(0, 0, size, size);

  // The dot: the place's own colour, outlined.
  ctx.beginPath();
  ctx.arc(c, c, 5.5 * k, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = p.outline;
  ctx.lineWidth = 2.5 * k;
  ctx.stroke();
  ctx.fill();

  // Four corner brackets; they draw in towards the dot and back out.
  const d = (14 - 3 * focus) * k;
  const arm = 5.5 * k;
  const corners: [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (const [color2, width] of [
    [p.outline, 5 * k],
    [color, 2.6 * k],
  ] as const) {
    ctx.strokeStyle = color2;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const [sx, sy] of corners) {
      const x = c + sx * d;
      const y = c + sy * d;
      ctx.beginPath();
      ctx.moveTo(x, y - sy * arm);
      ctx.lineTo(x, y);
      ctx.lineTo(x - sx * arm, y);
      ctx.stroke();
    }
  }
}

type Repainter = { triggerRepaint: () => void };

/**
 * A MapLibre style image that redraws itself (as lib/gauge-marks.ts does). Still - one frame,
 * never repainting - when the person asked for less motion.
 */
export function mineImage(kind: MineKind, color: string, dark: boolean, moving: boolean) {
  const size = MINE_IMAGE_SIZE * MINE_IMAGE_RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const draw = kind === "home" ? drawHome : drawWatch;
  const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const frame = (t: number) => {
    draw(ctx, size, color, dark, t);
    return new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer);
  };
  let map: Repainter | null = null;
  let last = clock();
  // Still pictures rest half-way through the movement: glow half on, brackets half closed.
  const rest = (kind === "home" ? HOME_BREATH_MS : WATCH_FOCUS_MS) / 4;
  const image = {
    width: size,
    height: size,
    data: frame(moving ? last : rest),
    onAdd(m: Repainter) {
      map = m;
      if (moving) m.triggerRepaint();
    },
    onRemove() {
      map = null;
    },
    render() {
      if (!moving || !map) return false;
      const now = clock();
      map.triggerRepaint();
      if (now - last < 1000 / MINE_FPS) return false;
      last = now;
      image.data = frame(now);
      return true;
    },
  };
  return image;
}
