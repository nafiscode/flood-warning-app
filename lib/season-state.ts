/**
 * Season state: how wet a catchment already is, and whether its river has been rising for a week
 * (science plan Module 11; the owner asked for it on 9 November 2026).
 *
 * Pure: no database, no clock of its own. The database does the grading here, in
 * `season_signal()`, because the same rule has to run on the daily cron that raises a notice -
 * two copies of a safety rule is one too many. This module only reads its answers and the
 * monthly reference behind them.
 *
 * Everything here is a **record, not a forecast** (safety rule 8), and it is read as a position in
 * one gauge's or one basin's own past, never as a figure to compare with another's. Nothing on
 * this path can raise a level or publish (safety rule 2): the grade is shown to an admin, who
 * decides.
 */

/** Where a figure sits in its own record. `unknown` means "we cannot say", never "normal". */
export type Band = "low" | "middle" | "high" | "unknown";
export const BANDS: readonly Band[] = ["low", "middle", "high", "unknown"] as const;

/** A zone's state in one word. `rising_wet` is the only one that raises a notice. */
export type Grade = "quiet" | "rising" | "wet" | "rising_wet";
export const GRADES: readonly Grade[] = ["quiet", "rising", "wet", "rising_wet"] as const;

/** Why the rule cannot judge. Each one is shown in words, so a gap never reads as calm. */
export type Blind =
  | "gaugeDays"
  | "noKeyGauge"
  | "rainDays"
  | "noFloorReference"
  | "noRainReference";

/** The lower third, median and upper third of one figure's own record. */
export type Tercile = { p33: number | null; p50: number | null; p67: number | null };

/** What the grade was worked out from, frozen when a notice is raised. */
export type SeasonFigures = {
  basin: string | null;
  gauge: string | null;
  month: number | null;
  at: number | null;
  floor: {
    m: number | null;
    at: number | null;
    roseDays: number | null;
    change7dM: number | null;
    band: Band;
    /** How far the floor is from its median for this month. Context, never a condition. */
    vsNormalM: number | null;
    reference: (Tercile & { seasons: number | null }) | null;
  };
  rain: {
    d15Mm: number | null;
    d15Band: Band;
    d30Mm: number | null;
    seasonMm: number | null;
    seasonBand: Band;
    at: number | null;
    reference: { d15: Tercile; seasons: number | null } | null;
  };
  stale: boolean;
  blind: Blind[];
  reasons: string[];
};

/** One zone, as `admin_season_signals()` gives it. */
export type SeasonState = {
  zoneId: string;
  basin: string;
  grade: Grade;
  reasons: string[];
  stale: boolean;
  figures: SeasonFigures | null;
};

/** One gauge's or one zone's reference for one month, as `admin_season_state()` gives it. */
export type SeasonReference = {
  kind: "gauge" | "zone";
  /** The gauge's code, or the zone's basin. */
  name: string;
  id: string;
  month: number;
  seasons: number;
  days: number;
  floor?: Tercile;
  rise?: Tercile;
  d15?: Tercile;
  d30?: Tercile;
  std?: Tercile;
  seaM?: number | null;
  pulseM?: number | null;
};

/** One episode, as `admin_season_notices()` gives it. */
export type SeasonNotice = {
  id: string;
  zoneId: string;
  basin: string;
  raisedAt: number | null;
  observedAt: number | null;
  grade: string;
  reasons: string[];
  figures: SeasonFigures | null;
  status: "open" | "sent" | "dismissed" | "ended";
  reviewedAt: number | null;
  reviewNote: string | null;
  endedAt: number | null;
};

type Row = Record<string, unknown>;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

const time = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : at;
};

const band = (v: unknown): Band => (BANDS.find((b) => b === v) ?? "unknown") as Band;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

const tercile = (v: unknown): Tercile => {
  const r = (v ?? {}) as Row;
  return { p33: num(r.p33), p50: num(r.p50), p67: num(r.p67) };
};

function toFigures(v: unknown): SeasonFigures | null {
  if (!v || typeof v !== "object") return null;
  const f = v as Row;
  const floor = (f.floor ?? {}) as Row;
  const rain = (f.rain ?? {}) as Row;
  const floorRef = floor.reference ? (floor.reference as Row) : null;
  const rainRef = rain.reference ? (rain.reference as Row) : null;
  return {
    basin: text(f.basin),
    gauge: text(f.gauge),
    month: num(f.month),
    at: time(f.at),
    floor: {
      m: num(floor.m),
      at: time(floor.at),
      roseDays: num(floor.roseDays),
      change7dM: num(floor.change7dM),
      band: band(floor.band),
      vsNormalM: num(floor.vsNormalM),
      reference: floorRef
        ? { ...tercile(floorRef), seasons: num(floorRef.seasons) }
        : null,
    },
    rain: {
      d15Mm: num(rain.d15Mm),
      d15Band: band(rain.d15Band),
      d30Mm: num(rain.d30Mm),
      seasonMm: num(rain.seasonMm),
      seasonBand: band(rain.seasonBand),
      at: time(rain.at),
      reference: rainRef ? { d15: tercile(rainRef.d15), seasons: num(rainRef.seasons) } : null,
    },
    stale: f.stale === true,
    blind: strings(f.blind) as Blind[],
    reasons: strings(f.reasons),
  };
}

/**
 * `admin_season_signals()` -> one state per zone, keyed by zone id. An unreadable answer gives an
 * empty map, so the block is simply not drawn rather than throwing.
 */
export function toSeasonStates(raw: unknown): Record<string, SeasonState> {
  const out: Record<string, SeasonState> = {};
  if (!raw || typeof raw !== "object") return out;
  const zones = (raw as Row).zones;
  if (!Array.isArray(zones)) return out;
  for (const item of zones) {
    const r = (item ?? {}) as Row;
    const zoneId = text(r.zoneId);
    const basin = text(r.basin);
    if (!zoneId || !basin) continue;
    out[zoneId] = {
      zoneId,
      basin,
      grade: (GRADES.find((g) => g === r.grade) ?? "quiet") as Grade,
      reasons: strings(r.reasons),
      stale: r.stale === true,
      figures: toFigures(r.figures),
    };
  }
  return out;
}

/** `admin_season_state()` -> the monthly reference, gauges and zones together. */
export function toSeasonReferences(raw: unknown): SeasonReference[] {
  if (!raw || typeof raw !== "object") return [];
  const data = raw as Row;
  const out: SeasonReference[] = [];
  for (const item of Array.isArray(data.gauges) ? data.gauges : []) {
    const r = (item ?? {}) as Row;
    const id = text(r.stationId);
    const month = num(r.month);
    if (!id || month === null) continue;
    out.push({
      kind: "gauge",
      name: text(r.code) ?? id,
      id,
      month,
      seasons: num(r.seasons) ?? 0,
      days: num(r.days) ?? 0,
      floor: tercile(r.floor),
      rise: tercile(r.rise),
      seaM: num(r.seaM),
      pulseM: num(r.pulseM),
    });
  }
  for (const item of Array.isArray(data.zones) ? data.zones : []) {
    const r = (item ?? {}) as Row;
    const id = text(r.zoneId);
    const month = num(r.month);
    if (!id || month === null) continue;
    out.push({
      kind: "zone",
      name: text(r.basin) ?? id,
      id,
      month,
      seasons: num(r.seasons) ?? 0,
      days: num(r.days) ?? 0,
      d15: tercile(r.d15),
      d30: tercile(r.d30),
      std: tercile(r.std),
    });
  }
  return out;
}

/** `admin_season_notices()` -> the episodes, newest first. */
export function toSeasonNotices(rows: unknown): SeasonNotice[] {
  if (!Array.isArray(rows)) return [];
  const out: SeasonNotice[] = [];
  for (const item of rows) {
    const r = (item ?? {}) as Row;
    const id = text(r.id);
    const zoneId = text(r.zone_id);
    if (!id || !zoneId) continue;
    const status = ["open", "sent", "dismissed", "ended"].find((s) => s === r.status);
    out.push({
      id,
      zoneId,
      basin: text(r.basin) ?? "",
      raisedAt: time(r.raised_at),
      observedAt: time(r.observed_at),
      grade: text(r.grade) ?? "quiet",
      reasons: strings(r.reasons),
      figures: toFigures(r.figures),
      status: (status ?? "ended") as SeasonNotice["status"],
      reviewedAt: time(r.reviewed_at),
      reviewNote: text(r.review_note),
      endedAt: time(r.ended_at),
    });
  }
  return out;
}

/** The episode an admin still has to look at for this zone, if there is one. */
export function openNoticeFor(notices: SeasonNotice[], zoneId: string): SeasonNotice | null {
  return (
    notices.find((n) => n.zoneId === zoneId && (n.status === "open" || n.status === "sent")) ?? null
  );
}

/** This month's reference rows for one zone and its key gauge, in month order. */
export function monthsFor(
  references: SeasonReference[],
  kind: "gauge" | "zone",
  name: string,
): SeasonReference[] {
  const order = [10, 11, 12, 1];
  return references
    .filter((r) => r.kind === kind && r.name === name)
    .sort((a, b) => order.indexOf(a.month) - order.indexOf(b.month));
}

/**
 * The figures behind a grade, as the note on a Watch draft. Shown as typed in every language, so
 * it is figures and codes only: "X.40A 12.48 m, floor up 6 of 7 days (+0.31 m) · rain 15 d 268 mm
 * (top third) · since 1 Oct 612 mm". Never the grade itself: the admin writes what they mean.
 */
export function seasonNote(state: SeasonState): string {
  const f = state.figures;
  if (!f) return "";
  const fix = (v: number | null, digits = 2) => (v === null ? null : v.toFixed(digits));
  const parts: string[] = [];
  const floor = fix(f.floor.m);
  if (f.gauge && floor !== null) {
    const change = fix(f.floor.change7dM);
    const rose = f.floor.roseDays;
    parts.push(
      `${f.gauge} ${floor} m` +
        (rose === null ? "" : `, floor up ${rose} of 7 days`) +
        (change === null ? "" : ` (${f.floor.change7dM! >= 0 ? "+" : ""}${change} m)`),
    );
  }
  const thirds: Record<Band, string> = {
    high: "top third",
    middle: "middle third",
    low: "bottom third",
    unknown: "third unknown",
  };
  const d15 = fix(f.rain.d15Mm, 0);
  if (d15 !== null) parts.push(`rain 15 d ${d15} mm (${thirds[f.rain.d15Band]})`);
  const season = fix(f.rain.seasonMm, 0);
  if (season !== null) parts.push(`since 1 Oct ${season} mm`);
  const normal = fix(f.floor.vsNormalM);
  if (normal !== null) {
    parts.push(`floor ${f.floor.vsNormalM! >= 0 ? "+" : ""}${normal} m vs median for the month`);
  }
  return parts.join(" · ").slice(0, 400);
}
