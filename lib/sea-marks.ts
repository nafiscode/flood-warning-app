import { DAM_WATER, DAM_WATER_DARK } from "@/lib/dam-map";
import { GAUGE_FPS } from "@/lib/gauge-marks";
import type { SeaGrade } from "@/lib/sea";

/**
 * The sea's marks on the map (the owner, 15 Oct 2026: the tide and waves near the coast, as an
 * animation). Each point off the coast is a round patch of sea with wave crests rolling across
 * it in the direction the waves travel (the layer turns the picture to that bearing). The higher
 * the model's waves, the more crests, the thicker and the faster: calm is two slow ripples, "stay
 * in port" four quick crests with foam.
 *
 * The colour is the map's water colour, the same as the rivers and the gauges, and never an
 * alert colour: a model's waves are not a level a person issued (safety rule 2). The grade is
 * also written beside every mark that is not calm, and fully in the card, so nothing rests on
 * the picture alone. With no forecast the patch is grey, dashed and still.
 */

export const SEA_IMAGE_SIZE = 64;
export const SEA_IMAGE_RATIO = 2;
const R = 17;

type Look = { crests: number; width: number; cycleMs: number; foam: boolean };
export const SEA_LOOKS: Record<SeaGrade, Look> = {
  calm: { crests: 2, width: 1.6, cycleMs: 3200, foam: false },
  rough: { crests: 3, width: 2.4, cycleMs: 2000, foam: false },
  stay: { crests: 4, width: 3, cycleMs: 1200, foam: true },
  unknown: { crests: 1, width: 1.6, cycleMs: 0, foam: false },
};

export const seaMoves = (grade: SeaGrade) => SEA_LOOKS[grade].cycleMs > 0;

export const seaImageName = (grade: SeaGrade, dark: boolean) =>
  `jaga-sea-${grade}-${dark ? "night" : "day"}`;

export function seaPaint(dark: boolean) {
  return dark
    ? {
        water: DAM_WATER_DARK,
        patch: "#0f1c26",
        halo: "#0b1b24",
        muted: "#a3b1ba",
        foam: "#ffffff",
      }
    : { water: DAM_WATER, patch: "#eaf5f9", halo: "#ffffff", muted: "#5f6c74", foam: "#ffffff" };
}

/** Which mark sits on top where two overlap: the roughest sea. */
export const SEA_RANK: Record<SeaGrade, number> = { stay: 3, rough: 2, calm: 1, unknown: 0 };

/**
 * One frame at time `t` (ms), the waves travelling up the picture (towards its top). Pure drawing:
 * the same grade, theme and time always give the same picture.
 */
export function drawSea(
  ctx: CanvasRenderingContext2D,
  size: number,
  grade: SeaGrade,
  dark: boolean,
  t: number,
): void {
  const p = seaPaint(dark);
  const look = SEA_LOOKS[grade];
  const k = size / SEA_IMAGE_SIZE;
  const c = size / 2;
  const r = R * k;
  ctx.clearRect(0, 0, size, size);

  // The halo, so the patch stands off the satellite picture and the dark basemap.
  ctx.beginPath();
  ctx.arc(c, c, r + 3.5 * k, 0, Math.PI * 2);
  ctx.fillStyle = p.halo;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.fillStyle = p.patch;
  ctx.fill();

  // The crests, clipped to the patch, rolling upwards; each fades in low and out at the top.
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, r - 1 * k, 0, Math.PI * 2);
  ctx.clip();
  const ink = grade === "unknown" ? p.muted : p.water;
  const phase = look.cycleMs > 0 ? (((t / look.cycleMs) % 1) + 1) % 1 : 0.5;
  for (let i = 0; i < look.crests; i++) {
    const f = (i + phase) / look.crests; // 0 at the bottom, 1 at the top
    const y = c + r - f * 2 * r;
    const bow = (2 + look.width) * k; // crests bow forwards, the way a wave front does
    const half = r * 0.8;
    ctx.beginPath();
    ctx.moveTo(c - half, y + bow);
    ctx.quadraticCurveTo(c, y - bow, c + half, y + bow);
    ctx.strokeStyle = ink;
    ctx.lineWidth = look.width * k;
    ctx.lineCap = "round";
    ctx.globalAlpha = look.cycleMs > 0 ? Math.sin(f * Math.PI) * 0.95 + 0.05 : 1;
    if (grade === "unknown") ctx.setLineDash([3 * k, 2.5 * k]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (look.foam) {
      // Foam breaking off the crest's two ends.
      // Outlined in the water colour, so it shows on the pale patch by day as well.
      ctx.fillStyle = p.foam;
      ctx.strokeStyle = ink;
      ctx.lineWidth = 0.9 * k;
      for (const dx of [-half * 0.55, half * 0.55]) {
        ctx.beginPath();
        ctx.arc(c + dx, y - bow * 0.15, 1.6 * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // The rim: dashed and grey without a forecast.
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.lineWidth = (grade === "stay" ? 2.6 : 2) * k;
  if (grade === "unknown") {
    ctx.setLineDash([2.5 * k, 2 * k]);
    ctx.strokeStyle = p.muted;
  } else {
    ctx.setLineDash([]);
    ctx.strokeStyle = p.water;
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // A small arrowhead at the top edge: which way the waves go, also in a still picture.
  if (grade !== "unknown") {
    const y = c - r - 1.5 * k;
    for (const [color, width] of [
      [p.halo, 4.5 * k],
      [p.water, 2.2 * k],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(c - 4.5 * k, y + 3.5 * k);
      ctx.lineTo(c, y - 1 * k);
      ctx.lineTo(c + 4.5 * k, y + 3.5 * k);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }
}

type Repainter = { triggerRepaint: () => void };

/** A MapLibre style image that redraws itself; one still frame under reduced motion. */
export function seaImage(grade: SeaGrade, dark: boolean, moving: boolean) {
  const size = SEA_IMAGE_SIZE * SEA_IMAGE_RATIO;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const live = moving && seaMoves(grade);
  const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const frame = (t: number) => {
    drawSea(ctx, size, grade, dark, t);
    return new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer);
  };
  let map: Repainter | null = null;
  let last = clock();
  const image = {
    width: size,
    height: size,
    data: frame(live ? last : 0),
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
