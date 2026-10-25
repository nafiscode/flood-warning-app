import type { Gauge } from "@/lib/map-data";
import { DAM_WATER, DAM_WATER_DARK } from "@/lib/dam-map";

/**
 * The river gauges on the public map (A8 item 4; the owner, 14 Oct 2026: "live status ... some
 * animation, cool and clear on the flood-risk layer").
 *
 * Each gauge is a small round glass with water in it. How full it is says where the river stands
 * against the station's own three levels (A10, 21 Oct 2026: the public map now reads the levels in
 * `gauge_levels`, the same ones the admins' signals read, and those give three bands above normal
 * rather than two): above its normal level the glass is over half full, near its bank it is nearly
 * full and sends out a slow ripple, and at or over its bank it brims and sends a quick double
 * ripple. A chevron above or below says the river rose or fell in the last three hours. A gauge
 * silent for six hours is an empty, dashed glass: nothing is shown as if it were current (safety
 * rule 3's habit).
 *
 * The colour is the map's water colour, the same as the dam's river, by day and by night, and
 * never an alert colour: a gauge reading is a measurement, not a level a person issued (safety
 * rule 2). What the state means is always written as well - on the map beside a gauge near or
 * over its bank, and in the card a tap opens - so nothing rests on the picture alone.
 */

/**
 * The sea beside a tidal gauge, drawn as a small tide mark at the glass's lower right (A10, 25 Oct
 * 2026): a gentle swell when the sea lets the river out, a slow one when it is narrowing, and a
 * flat line under a bar when the low water holds the river in. `none` (no mark) for a gauge the
 * tide does not reach, and for `unknown`: a missing forecast is not drawn as calm. The word for a
 * shut sea is written on the map as well, and the card says all of it (safety rule 8).
 */
export type SeaLook = "none" | "open" | "narrowing" | "shut";
export const SEA_LOOKS: SeaLook[] = ["none", "open", "narrowing", "shut"];

export function seaLook(sea: Gauge["sea"]): SeaLook {
  return sea && sea.state !== "unknown" ? sea.state : "none";
}

export type GaugeLook = "over" | "near" | "high" | "normal" | "nolevels" | "quiet";
export type Trend = "up" | "down" | "flat";

export const GAUGE_LOOKS: GaugeLook[] = ["over", "near", "high", "normal", "nolevels", "quiet"];
export const TRENDS: Trend[] = ["up", "down", "flat"];

export function gaugeLook(status: Gauge["status"]): GaugeLook {
  switch (status) {
    // The gauge's Evacuate level, which is its bank on every gauge that has one.
    case "above_evacuate":
      return "over";
    // Its Warning level: below the bank, and close to it.
    case "above_warning":
      return "near";
    // Its Watch level: higher than the river normally runs, a long way below the bank yet.
    case "above_watch":
      return "high";
    case "normal":
      return "normal";
    case "no_levels":
      return "nolevels";
    default:
      return "quiet";
  }
}

/** Five centimetres in three hours is the least a chevron is drawn for: below that it is noise. */
export const TREND_MIN_M = 0.05;

export function trendOf(rise: number | null, look: GaugeLook): Trend {
  if (look === "quiet" || rise === null || !Number.isFinite(rise)) return "flat";
  if (rise >= TREND_MIN_M) return "up";
  if (rise <= -TREND_MIN_M) return "down";
  return "flat";
}

/** How full the glass is drawn. Over the bank it brims; with no levels it is half, and grey-ringed. */
export const GAUGE_FILL: Record<GaugeLook, number> = {
  over: 1,
  near: 0.72,
  high: 0.55,
  normal: 0.38,
  nolevels: 0.5,
  quiet: 0,
};

/**
 * One ripple's life in ms; 0 = no ripple. Two ripples, half a life apart, over the bank. Only the
 * two bank bands ripple: a river merely above its normal level is told by the glass and the words.
 */
export const GAUGE_RIPPLE_MS: Record<GaugeLook, number> = {
  over: 1500,
  near: 2800,
  high: 0,
  normal: 0,
  nolevels: 0,
  quiet: 0,
};

/** How long one sway of the water takes, in ms. */
export const WAVE_MS = 2400;

export type GaugePaint = { water: string; glass: string; rim: string; halo: string; muted: string };

export function gaugePaint(dark: boolean): GaugePaint {
  return dark
    ? { water: DAM_WATER_DARK, glass: "#0f1c26", rim: "#d7eef7", halo: "#0b1b24", muted: "#a3b1ba" }
    : { water: DAM_WATER, glass: "#ffffff", rim: "#0d4a5e", halo: "#ffffff", muted: "#5f6c74" };
}

export const gaugeImageName = (look: GaugeLook, trend: Trend, dark: boolean, sea: SeaLook = "none") =>
  `jaga-gauge-${look}-${trend}-${sea}-${dark ? "night" : "day"}`;

/** The picture's size in CSS pixels; drawn at twice that for sharp phones. */
export const GAUGE_IMAGE_SIZE = 64;
export const GAUGE_IMAGE_RATIO = 2;
const GLASS_R = 10.5;

/** Whether this look moves at all. A silent gauge stays still: it has nothing new to say. */
export const animates = (look: GaugeLook) => look !== "quiet";

/**
 * The words written beside a gauge on the map: always the level, close in; and the state, at any
 * zoom, for a gauge near or over its bank, so the one that matters is never a picture alone.
 */
export function gaugeLabels(
  gauge: Pick<Gauge, "value" | "status"> & { sea?: Gauge["sea"] },
  words: { near: string; over: string; seaShut?: string },
): { short: string; long: string } {
  const look = gaugeLook(gauge.status);
  const river = look === "over" ? words.over : look === "near" ? words.near : "";
  // Only a shut sea is written on the map; open and narrowing are the picture and the card.
  const shut = seaLook(gauge.sea) === "shut" ? (words.seaShut ?? "") : "";
  const value = look !== "quiet" && gauge.value !== null ? `${gauge.value.toFixed(2)} m` : "";
  return {
    short: [river, shut].filter(Boolean).join(" · "),
    long: [value, river, shut].filter(Boolean).join(" · "),
  };
}

/**
 * Draws one frame of a gauge at time `t` (ms) on a square canvas of `size` device pixels. Pure
 * drawing: the same look, trend, theme and time always give the same picture.
 */
export function drawGauge(
  ctx: CanvasRenderingContext2D,
  size: number,
  look: GaugeLook,
  trend: Trend,
  dark: boolean,
  t: number,
  sea: SeaLook = "none",
): void {
  const p = gaugePaint(dark);
  const k = size / GAUGE_IMAGE_SIZE;
  const c = size / 2;
  const r = GLASS_R * k;
  ctx.clearRect(0, 0, size, size);

  // Ripples first, under the glass.
  const life = GAUGE_RIPPLE_MS[look];
  if (life > 0) {
    const rings = look === "over" ? 2 : 1;
    for (let i = 0; i < rings; i++) {
      const phase = (((t / life + i / rings) % 1) + 1) % 1;
      const eased = 1 - (1 - phase) ** 2;
      ctx.beginPath();
      ctx.arc(c, c, r + (look === "over" ? 19 : 15) * k * eased, 0, Math.PI * 2);
      ctx.strokeStyle = p.water;
      ctx.globalAlpha = (look === "over" ? 0.85 : 0.6) * (1 - phase);
      ctx.lineWidth = (look === "over" ? 3 : 2) * k * (1 - phase * 0.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // A soft glow, so the glass stands off the flood-risk colours and the dark basemap.
  ctx.beginPath();
  ctx.arc(c, c, r + 3.5 * k, 0, Math.PI * 2);
  ctx.fillStyle = p.halo;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;

  // The glass.
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fillStyle = p.glass;
  ctx.fill();

  // The water, its surface swaying.
  const fill = GAUGE_FILL[look];
  if (fill > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, r - 1.2 * k, 0, Math.PI * 2);
    ctx.clip();
    const surface = c + r - fill * 2 * r;
    const sway = animates(look) ? (t / WAVE_MS) * Math.PI * 2 : 0;
    const height = (look === "over" ? 1.8 : 1.3) * k;
    ctx.beginPath();
    ctx.moveTo(c - r, size);
    for (let x = -r; x <= r; x += 0.5 * k) {
      const y = surface + Math.sin((x / r) * Math.PI * 1.5 + sway) * height;
      ctx.lineTo(c + x, y);
    }
    ctx.lineTo(c + r, size);
    ctx.closePath();
    ctx.fillStyle = look === "nolevels" ? p.muted : p.water;
    ctx.fill();
    // A lighter line along the surface, the glint that makes it read as water.
    ctx.beginPath();
    for (let x = -r; x <= r; x += 0.5 * k) {
      const y = surface + Math.sin((x / r) * Math.PI * 1.5 + sway) * height;
      if (x === -r) ctx.moveTo(c + x, y);
      else ctx.lineTo(c + x, y);
    }
    ctx.strokeStyle = p.glass;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1 * k;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // The rim: solid for a live gauge, dashed grey for one gone quiet.
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  if (look === "quiet") {
    ctx.setLineDash([2.5 * k, 2 * k]);
    ctx.strokeStyle = p.muted;
  } else {
    ctx.setLineDash([]);
    ctx.strokeStyle = look === "nolevels" ? p.muted : p.rim;
  }
  ctx.lineWidth = (look === "over" ? 2.6 : 2) * k;
  ctx.stroke();
  ctx.setLineDash([]);

  if (sea !== "none") drawSea(ctx, c, r, k, p, sea, t);

  // Rising or falling: a chevron above or below the glass, with the halo behind it.
  if (trend !== "flat") {
    const up = trend === "up";
    const bob = animates(look) ? Math.sin((t / WAVE_MS) * Math.PI * 2) * 1.2 * k : 0;
    const y = up ? c - r - 7 * k + bob : c + r + 7 * k - bob;
    const w = 5 * k;
    const h = (up ? -3.5 : 3.5) * k;
    for (const [color, width] of [
      [p.halo, 5 * k],
      [p.water, 2.4 * k],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(c - w, y - h / 2);
      ctx.lineTo(c, y + h / 2);
      ctx.lineTo(c + w, y - h / 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }
}

/** Draws the tide mark at the glass's lower right: a swell, and a bar over it when the sea is shut. */
function drawSea(ctx: CanvasRenderingContext2D, c: number, r: number, k: number, p: GaugePaint, sea: SeaLook, t: number) {
  const x0 = c + r * 0.55;
  const y0 = c + r * 0.95;
  const w = 13 * k;
  const amp = (sea === "open" ? 2.4 : sea === "narrowing" ? 1.4 : 0.4) * k;
  const speed = sea === "open" ? 1 : sea === "narrowing" ? 0.5 : 0.15;
  const sway = (t / WAVE_MS) * Math.PI * 2 * speed;
  const line = (color: string, width: number) => {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 0.5 * k) {
      const y = y0 + Math.sin((x / w) * Math.PI * 2 + sway) * amp;
      if (x === 0) ctx.moveTo(x0 + x, y);
      else ctx.lineTo(x0 + x, y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.stroke();
  };
  line(p.halo, 5 * k);
  line(p.water, 2.2 * k);
  if (sea === "shut") {
    // The river's way out held shut: a bar across the swell.
    for (const [color, width] of [
      [p.halo, 5 * k],
      [p.rim, 2.2 * k],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(x0 + w, y0 - 7 * k);
      ctx.lineTo(x0 + w, y0 + 5 * k);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.stroke();
    }
  }
}

/** Frames a second while moving: smooth enough to read as water, light on a cheap phone. */
export const GAUGE_FPS = 20;

/** Whether the person has asked for less motion. */
export function reducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type Repainter = { triggerRepaint: () => void };

/**
 * A MapLibre style image that redraws itself (MapLibre's "animated image" interface). Still -
 * one frame, never repainting - when the look does not move or the person asked for less motion.
 */
export function gaugeImage(
  look: GaugeLook,
  trend: Trend,
  dark: boolean,
  moving: boolean,
  sea: SeaLook = "none",
) {
  const size = GAUGE_IMAGE_SIZE * GAUGE_IMAGE_RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const live = moving && (animates(look) || sea !== "none");
  const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const frame = (t: number) => {
    drawGauge(ctx, size, look, trend, dark, t, sea);
    return new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer);
  };
  let map: Repainter | null = null;
  let last = clock();
  // The first frame is there from the start: MapLibre copies `data` when the image is added.
  const image = {
    width: size,
    height: size,
    data: frame(live ? last : WAVE_MS / 4),
    onAdd(m: Repainter) {
      map = m;
      if (live) m.triggerRepaint();
    },
    onRemove() {
      map = null;
    },
    render() {
      if (!live || !map) return false;
      const now = clock();
      map.triggerRepaint();
      if (now - last < 1000 / GAUGE_FPS) return false;
      last = now;
      image.data = frame(now);
      return true;
    },
  };
  return image;
}
