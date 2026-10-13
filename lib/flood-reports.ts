/**
 * Flood reports from residents, as everyone is allowed to see them (the owner, 13 Oct 2026):
 * one row per tambon with counts only. No point, no reporter (safety rule 6); the place of a
 * single report is never finer than its hexagon on the map.
 *
 * This is never an alert. It carries no level and no alert colour, and the screens that show it
 * say who is speaking: residents, unchecked by Jaga (safety rule 2). "Confirmed" means only that
 * several different residents have reported the same tambon.
 */
export const REPORTS_NEAR_URL = "/api/public/reports";

export const DEPTHS = ["dry", "ankle", "knee", "waist", "chest", "above_head", "roof"] as const;
export type Depth = (typeof DEPTHS)[number];
export type Road = "car" | "motorbike_only" | "impassable";
export type Trend = "rising" | "steady" | "falling";

export type TambonReports = {
  tambon: string;
  nameTh: string;
  nameEn: string;
  district: string;
  districtTh: string;
  districtEn: string;
  /** A point inside the tambon, for the map to go to. Never a report's own point. */
  lat: number;
  lon: number;
  reports: number;
  people: number;
  deepest: Depth | null;
  worstRoad: Road | null;
  trend: Trend | null;
  /** Cut to the hour by the database. */
  firstAt: string;
  latestAt: string;
  /** Several different residents have a standing report here. */
  confirmed: boolean;
};

export type ReportsNear = { generatedAt: string; tambons: TambonReports[] };

const oneOf = <T extends string>(all: readonly T[], v: unknown): T | null =>
  typeof v === "string" && (all as readonly string[]).includes(v) ? (v as T) : null;

/** One row of `flood_reports_by_tambon()`, or null when it is not what was promised. */
export function toTambonReports(row: Record<string, unknown>): TambonReports | null {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  const tambon = text(row.tambon);
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  const reports = Number(row.reports);
  if (!/^\d{6}$/.test(tambon) || !Number.isFinite(lat) || !Number.isFinite(lon) || !(reports > 0))
    return null;
  return {
    tambon,
    nameTh: text(row.name_th),
    nameEn: text(row.name_en),
    district: text(row.district),
    districtTh: text(row.district_th),
    districtEn: text(row.district_en),
    lat,
    lon,
    reports,
    people: Math.max(1, Number(row.people) || 1),
    deepest: oneOf(DEPTHS, row.deepest),
    worstRoad: oneOf(["car", "motorbike_only", "impassable"] as const, row.worst_road),
    trend: oneOf(["rising", "steady", "falling"] as const, row.latest_trend),
    firstAt: text(row.first_at),
    latestAt: text(row.latest_at),
    confirmed: row.confirmed === true,
  };
}

export type NearMe = {
  /** Reports in a tambon that is the person's own or one they watch. */
  here: TambonReports[];
  /** Reports elsewhere in the same districts. */
  district: TambonReports[];
};

/**
 * The reports that concern someone: their own tambons first, then the rest of the same
 * districts (the first four digits of a tambon code), newest first within each. Nothing is
 * returned for a person who has not said where they are.
 */
export function reportsNearMe(all: TambonReports[], myTambons: string[]): NearMe {
  const mine = new Set(myTambons);
  const districts = new Set(myTambons.map((c) => c.slice(0, 4)));
  const newest = (a: TambonReports, b: TambonReports) => b.latestAt.localeCompare(a.latestAt);
  return {
    here: all.filter((r) => mine.has(r.tambon)).sort(newest),
    district: all.filter((r) => !mine.has(r.tambon) && districts.has(r.district)).sort(newest),
  };
}

/** The reporter's own report and whether it still stands. */
export type MyReportState = "standing" | "ended" | "cleared" | "expired" | "hidden";
export type MyReport = {
  id: string;
  tambon: string | null;
  nameTh: string;
  nameEn: string;
  depth: Depth | null;
  createdAt: string;
  state: MyReportState;
};

export function toMyReport(row: Record<string, unknown>): MyReport | null {
  const state = oneOf(["standing", "ended", "cleared", "expired", "hidden"] as const, row.state);
  if (typeof row.id !== "string" || !state) return null;
  return {
    id: row.id,
    tambon: typeof row.tambon === "string" ? row.tambon : null,
    nameTh: typeof row.name_th === "string" ? row.name_th : "",
    nameEn: typeof row.name_en === "string" ? row.name_en : "",
    depth: oneOf(DEPTHS, row.depth_ref),
    createdAt: String(row.created_at ?? ""),
    state,
  };
}
