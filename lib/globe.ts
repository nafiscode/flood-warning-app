/**
 * The small turning Earth in the map console's head (components/map/OrbitGlobe.tsx): where its
 * land dots are, how they fall on the disc as it turns, and when the service area is under the
 * satellite so the link lights.
 *
 * Decoration that says nothing (safety rule 8): no figure, no time, no orbit of a real craft.
 * Kept pure so the geometry is tested without a canvas.
 */
import { LAND_BITS } from "./globe-dots";

/** Degrees between the rings of latitude the land was sampled on (scripts/globe-dots.mjs). */
export const GLOBE_STEP = 3;

/** One turn of the Earth, slow enough to read as a planet and not a spinner. */
export const TURN_MS = 60_000;

/** Latitude at the centre of the disc: tipped a little north, as the globe is usually seen. */
export const VIEW_LAT = 12;

/** Where Jaga works: Pattani, which the link lights for as it comes round. */
export const SERVICE_POINT = { lat: 6.87, lon: 101.25 } as const;

/**
 * The point on the sphere the satellite looks at, in the disc's own frame (x right, y up, z
 * towards the reader). The craft sits off the globe's upper-left shoulder, a little in front of
 * it, so it looks in from the left; the vector is unit length.
 */
export const LOOK = normalize(-0.62, 0.05, 0.78);

/** The link lights while the service area is within this many degrees of where the craft looks. */
export const LINK_DEG = 40;

/**
 * The centre longitude of the still picture shown to somebody who asked for less motion: the
 * service area as close under the satellite as the turn ever brings it, so the frame held is the
 * one everything moves towards.
 */
export const STILL_SPIN = 140;

/**
 * The satellite's foil. Bronze, muted and dark, and deliberately not gold: yellow is the Watch
 * level and orange is Warning (docs/brand.md), so nothing decorative may come near either. A unit
 * test holds every stop at least a clear colour difference away from both.
 */
export const BRONZE = ["#5a381e", "#a87348", "#7a4c2a"] as const;

export type GlobeDot = {
  sinLat: number;
  cosLat: number;
  sinLon: number;
  cosLon: number;
};

export type Projected = { x: number; y: number; z: number };

function normalize(x: number, y: number, z: number) {
  const n = Math.hypot(x, y, z);
  return { x: x / n, y: y / n, z: z / n } as const;
}

const RAD = Math.PI / 180;

function dot(lat: number, lon: number): GlobeDot {
  return {
    sinLat: Math.sin(lat * RAD),
    cosLat: Math.cos(lat * RAD),
    sinLon: Math.sin(lon * RAD),
    cosLon: Math.cos(lon * RAD),
  };
}

/** Every land point as [lat, lon], unpacked from the rings scripts/globe-dots.mjs wrote. */
export function landPoints(): [number, number][] {
  const bytes = decodeBase64(LAND_BITS);
  const out: [number, number][] = [];
  let i = 0;
  for (let lat = -90 + GLOBE_STEP / 2; lat < 90; lat += GLOBE_STEP) {
    const n = Math.max(1, Math.round((360 / GLOBE_STEP) * Math.cos(lat * RAD)));
    for (let k = 0; k < n; k++, i++) {
      if ((bytes[i >> 3] ?? 0) & (1 << (i & 7))) out.push([lat, -180 + (360 * (k + 0.5)) / n]);
    }
  }
  return out;
}

/** The land points with their sines and cosines worked out once, so a frame is only arithmetic. */
export function landDots(): GlobeDot[] {
  return landPoints().map(([lat, lon]) => dot(lat, lon));
}

/** The frame's rotation: the centre longitude's sine and cosine, and the view latitude's. */
export type View = { sin0: number; cos0: number; sinV: number; cosV: number };

export function viewAt(spin: number, viewLat = VIEW_LAT): View {
  return {
    sin0: Math.sin(spin * RAD),
    cos0: Math.cos(spin * RAD),
    sinV: Math.sin(viewLat * RAD),
    cosV: Math.cos(viewLat * RAD),
  };
}

/**
 * Orthographic projection onto the unit disc: x right, y up, z towards the reader (a point with
 * z <= 0 is on the far side and is not drawn).
 */
export function projectDot(d: GlobeDot, v: View): Projected {
  // cos and sin of (lon - centre), by the angle-difference identities.
  const cosD = d.cosLon * v.cos0 + d.sinLon * v.sin0;
  const sinD = d.sinLon * v.cos0 - d.cosLon * v.sin0;
  return {
    x: d.cosLat * sinD,
    y: v.cosV * d.sinLat - v.sinV * d.cosLat * cosD,
    z: v.sinV * d.sinLat + v.cosV * d.cosLat * cosD,
  };
}

export function project(lat: number, lon: number, spin: number): Projected {
  return projectDot(dot(lat, lon), viewAt(spin));
}

/**
 * The centre longitude at a moment. The Earth turns west to east, so seen from the side with
 * north up its face moves to the right and the longitude at the centre falls. It starts an eighth
 * of a turn before the still picture, so whoever opens the map sees the link light within seconds.
 */
export function spinAt(ms: number, start = STILL_SPIN + 45): number {
  const turned = ((ms % TURN_MS) / TURN_MS) * 360;
  return ((((start - turned + 180) % 360) + 360) % 360) - 180;
}

/** Degrees between the service area and where the satellite looks, for a centre longitude. */
export function linkAngle(spin: number): number {
  const p = project(SERVICE_POINT.lat, SERVICE_POINT.lon, spin);
  const cos = p.x * LOOK.x + p.y * LOOK.y + p.z * LOOK.z;
  return Math.acos(Math.max(-1, Math.min(1, cos))) / RAD;
}

/** Whether the service area is under the satellite (and on the near side) at this centre longitude. */
export function linkOn(spin: number): boolean {
  return project(SERVICE_POINT.lat, SERVICE_POINT.lon, spin).z > 0 && linkAngle(spin) < LINK_DEG;
}

function decodeBase64(text: string): Uint8Array {
  if (typeof atob === "function") {
    const raw = atob(text);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(text, "base64"));
}
