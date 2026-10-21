import type { SafePlace } from "@/lib/places";

/** Flood reports of the last 72 h in one hexagon of about 1 km2: a count, never a point. */
export type ReportBin = {
  hex: { type: "Polygon"; coordinates: number[][][] };
  count: number;
  /** The deepest water reported there, by the body-height scale of the report form. */
  deepest: string | null;
  /** Time of the newest report there, cut to the hour. */
  latest: string;
};

export const GAUGE_STATUSES = [
  "normal",
  "above_watch",
  "above_warning",
  "above_evacuate",
  "no_levels",
  "no_recent_data",
] as const;

export type Gauge = {
  id: string;
  name: Record<string, string>;
  lat: number;
  lon: number;
  /** Water level in metres above mean sea level. */
  value: number | null;
  observedAt: string | null;
  /**
   * Where the river stands against this gauge's own Watch, Warning and Evacuate levels - the levels
   * in `gauge_levels` that the admins' signals read too (A10, 21 Oct 2026). `above_watch` = higher
   * than the river normally runs; `above_warning` = close to its bank; `above_evacuate` = at or over
   * its bank (Evacuate is the bank level on every gauge that has one).
   */
  status: (typeof GAUGE_STATUSES)[number];
  code?: string;
  /** Metres risen (negative: fallen) since the reading nearest three hours before the newest. */
  rise3h?: number | null;
  /** The bank level, m MSL. */
  bank?: number | null;
};

/** Answer of /api/public/gauges: the gauges alone, small enough to ask for again every few minutes. */
export type GaugeData = { gauges: Gauge[] };

/**
 * The least of a station the counting needs: where it is, what it reads and when it last spoke.
 * The home screen asks for this alone (`/api/public/gauges/summary`), because a phone on slow 3G
 * should not download every station's name and bank level to be told how its own rivers stand.
 */
export type GaugeReading = Pick<Gauge, "lat" | "lon" | "status" | "observedAt">;

/** Answer of /api/public/gauges/summary. */
export type GaugeSummary = { generatedAt: string; gauges: GaugeReading[] };

export const GAUGES_SUMMARY_URL = "/api/public/gauges/summary";

export function toGaugeReading(row: Record<string, unknown>): GaugeReading {
  const { lat, lon, status, observedAt } = toGauge(row);
  return { lat, lon, status, observedAt };
}

/** One row of `station_status()` as the map draws it. */
export function toGauge(row: Record<string, unknown>): Gauge {
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  return {
    id: String(row.id),
    code: typeof row.code === "string" ? row.code : undefined,
    name: (row.name ?? {}) as Record<string, string>,
    lat: Number(row.lat),
    lon: Number(row.lon),
    value: typeof row.value === "number" ? row.value : null,
    observedAt: typeof row.observed_at === "string" ? row.observed_at : null,
    status: (GAUGE_STATUSES as readonly string[]).includes(String(row.status))
      ? (row.status as Gauge["status"])
      : "no_recent_data",
    rise3h: num(row.rise_3h),
    bank: num(row.bank_m),
  };
}

/** Answer of /api/public/map. */
export type MapData = { places: SafePlace[]; reports: ReportBin[]; gauges: Gauge[] };
