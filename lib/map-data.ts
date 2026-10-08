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
  status: (typeof GAUGE_STATUSES)[number];
};

/** Answer of /api/public/map. */
export type MapData = { places: SafePlace[]; reports: ReportBin[]; gauges: Gauge[] };
