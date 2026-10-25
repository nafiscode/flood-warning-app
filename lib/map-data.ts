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
  /** Only on a gauge the tide reaches, and only when the forecast could be read; see `SeaGate`. */
  sea?: SeaGate;
};

/**
 * What the sea is doing to a tidal gauge's drainage, as one word (`gauge_sea_gate()`, A10 25 Oct
 * 2026; science plan Module 10). Never a height and never a level (safety rules 2 and 8): it
 * compares the forecast low water with the same mouth's own flood-season record. `unknown` is
 * never shown as good news.
 */
export const SEA_STATES = ["open", "narrowing", "shut", "unknown"] as const;
export type SeaState = (typeof SEA_STATES)[number];
export type SeaGate = {
  state: SeaState;
  /** First day of the longest run of shut days (ISO), when there is one. */
  shutFrom: string | null;
  shutDays: number;
  /** When the sea forecast behind the word was issued (ISO). */
  issuedAt: string | null;
};

/** `gauge_sea_gate()` rows, laid onto the gauges by station code. A gauge with no row keeps none. */
export function withSea(gauges: Gauge[], rows: unknown): Gauge[] {
  if (!Array.isArray(rows)) return gauges;
  const byCode = new Map<string, SeaGate>();
  for (const r of rows as Record<string, unknown>[]) {
    if (typeof r.code !== "string") continue;
    const state = (SEA_STATES as readonly string[]).includes(String(r.state))
      ? (r.state as SeaState)
      : "unknown";
    byCode.set(r.code, {
      state,
      shutFrom: typeof r.shut_from === "string" ? r.shut_from : null,
      shutDays: typeof r.shut_days === "number" ? r.shut_days : 0,
      issuedAt: typeof r.issued_at === "string" ? r.issued_at : null,
    });
  }
  return gauges.map((g) => {
    const sea = g.code ? byCode.get(g.code) : undefined;
    return sea ? { ...g, sea } : g;
  });
}

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
