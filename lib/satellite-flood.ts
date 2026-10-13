/**
 * Flood seen by satellite in the last few days, from GISTDA's open service (decisions of 9 and 13
 * Oct 2026). GISTDA publishes it as hexagons of about 0.12 km², each with the area of water a
 * satellite pass found inside it and the passes it came from.
 *
 * It is a reading of satellite passes, not a warning and not what is flooded this minute. An
 * empty answer is "no pass saw water here", never "no flood" (safety rules 8 and 10), and an
 * answer that could not be fetched says nothing at all. The colour is a violet: blue is taken (it
 * is the "safe to return" level), and violet belongs to no alert level and to no hazard class.
 *
 * The key for GISTDA's service stays on the server (/api/public/satellite-flood). Their answers
 * repeat the caller's key inside `links`, so only what `slimCell` keeps ever leaves the server.
 */

/** The look-back windows offered, in days. GISTDA also has a one-day layer; most days no pass falls in it. */
export const SATELLITE_WINDOWS = [3, 7, 30] as const;
export type SatelliteWindow = (typeof SATELLITE_WINDOWS)[number];
export const SATELLITE_DEFAULT: SatelliteWindow = 7;
/** DOPA codes of the provinces asked for: Songkhla, Pattani, Yala, Narathiwat. */
export const SATELLITE_PROVINCES = ["90", "94", "95", "96"] as const;

/** Violet by day, a lighter violet on the dark map. Not an alert hue, not a hazard class. */
export const SATELLITE_COLOR = "#5A1FA8";
export const SATELLITE_COLOR_NIGHT = "#A78BFF";
export const SATELLITE_OPACITY = 0.55;
export function satelliteColor(dark: boolean): string {
  return dark ? SATELLITE_COLOR_NIGHT : SATELLITE_COLOR;
}

export type SatelliteCell = {
  type: "Feature";
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
  properties: { m2: number };
};

export type SatelliteFlood = {
  days: SatelliteWindow;
  /** When Jaga asked GISTDA, ISO. */
  fetchedAt: string;
  /** Hexagons with water in them, and the water's area inside them. */
  cells: number;
  km2: number;
  /** The days (YYYY-MM-DD, as GISTDA names its passes) the passes behind the cells were taken, newest first. */
  passDays: string[];
  /** True when there was more than Jaga would send to a phone: the map then shows only part. */
  truncated: boolean;
  features: SatelliteCell[];
};

export function isSatelliteWindow(value: unknown): value is SatelliteWindow {
  return SATELLITE_WINDOWS.includes(Number(value) as SatelliteWindow);
}

/** The path of GISTDA's layer for a window: "flood/3days". */
export function satelliteLayer(days: SatelliteWindow): string {
  return `flood/${days}days`;
}

export function satelliteUrl(days: SatelliteWindow): string {
  return `/api/public/satellite-flood?days=${days}`;
}

/**
 * The days named in a cell's `file_name` ("S1D_20261011_1812, cm2_20261007_0603"): one pass per
 * item, satellite, date and time. Anything that is not a real date is left out.
 */
export function passDays(fileName: unknown): string[] {
  if (typeof fileName !== "string") return [];
  const days = new Set<string>();
  for (const match of fileName.matchAll(/(?:^|[_\s,])(\d{4})(\d{2})(\d{2})(?=_|\s|,|$)/g)) {
    const [, y, m, d] = match;
    const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    if (
      date.getUTCFullYear() === Number(y) &&
      date.getUTCMonth() === Number(m) - 1 &&
      date.getUTCDate() === Number(d)
    ) {
      days.add(`${y}-${m}-${d}`);
    }
  }
  return [...days];
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;
function rounded(coordinates: unknown): unknown {
  if (!Array.isArray(coordinates)) return coordinates;
  if (typeof coordinates[0] === "number") return [round(coordinates[0]), round(coordinates[1])];
  return coordinates.map(rounded);
}

/**
 * One of GISTDA's features as Jaga passes it on: the shape, to about a metre, and the area of
 * water. Nothing else of theirs is kept. Null for anything that is not a polygon.
 */
export function slimCell(feature: unknown): SatelliteCell | null {
  const f = feature as {
    geometry?: { type?: string; coordinates?: unknown };
    properties?: Record<string, unknown>;
  } | null;
  const type = f?.geometry?.type;
  if ((type !== "Polygon" && type !== "MultiPolygon") || !Array.isArray(f?.geometry?.coordinates)) {
    return null;
  }
  const m2 = Number(f?.properties?.f_area);
  return {
    type: "Feature",
    geometry: { type, coordinates: rounded(f.geometry.coordinates) },
    properties: { m2: Number.isFinite(m2) && m2 > 0 ? Math.round(m2) : 0 },
  };
}

/** The most hexagons sent to a phone: about 2,400 km² of them, far beyond the largest flood on record here. */
export const SATELLITE_MAX_CELLS = 20_000;

/** GISTDA's raw features, from every province asked, as the one answer the map gets. */
export function toSatelliteFlood(
  raw: unknown[],
  days: SatelliteWindow,
  fetchedAt: string,
  more = false,
): SatelliteFlood {
  const features: SatelliteCell[] = [];
  const seen = new Set<string>();
  let m2 = 0;
  let dropped = false;
  for (const item of raw) {
    const cell = slimCell(item);
    if (!cell) continue;
    for (const day of passDays(
      (item as { properties?: { file_name?: unknown } }).properties?.file_name,
    )) {
      seen.add(day);
    }
    if (features.length >= SATELLITE_MAX_CELLS) {
      dropped = true;
      continue;
    }
    m2 += cell.properties.m2;
    features.push(cell);
  }
  return {
    days,
    fetchedAt,
    cells: features.length,
    km2: Math.round(m2 / 1e4) / 100,
    passDays: [...seen].sort().reverse(),
    truncated: dropped || more,
    features,
  };
}

/** What the screen says about an answer: nothing asked, waiting, could not be had, empty, or some. */
export type SatelliteState = "off" | "loading" | "unavailable" | "none" | "some";
export function satelliteState(
  days: SatelliteWindow | null,
  load: "loading" | "ok" | "unavailable",
  flood: SatelliteFlood | null,
): SatelliteState {
  if (days === null) return "off";
  if (load === "loading") return "loading";
  if (load === "unavailable" || !flood || flood.days !== days) return "unavailable";
  return flood.cells > 0 ? "some" : "none";
}
