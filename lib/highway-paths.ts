import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Where a main highway may be holding flood water back (A19; science plan Module 8 part 2).
 *
 * This is the one feature in Jaga written for an engineer rather than for a resident or a crew. A
 * provincial highway office (แขวงทางหลวง) or irrigation project office (โครงการชลประทาน) registers
 * with the `planning` capability, and gets its own province's flagged stretches of road with the
 * figures behind them: where the radar record over nine flood seasons looks as if water stood on
 * the side it came from, and where natural drainage crosses the road with no mapped opening.
 *
 * Three rules govern every line of this file:
 *
 *   1. **It is never an alert** (safety rule 2) and never public (rule 6). It feeds no level, no
 *      suggestion and no notification. The classes below therefore wear neither the alert palette
 *      nor the hazard pinks they are drawn over - see `CLASS_LOOK`.
 *   2. **It is never presented as certain** (rule 8). The radar sees extent, not depth; a wetter
 *      side can be a paddy or a natural low; "no mapped opening" nearly always means "not mapped".
 *      Those three sentences are not decoration - `LIMITS` is rendered with every list, and a unit
 *      test holds the page to it.
 *   3. **The words are the reviewed ones.** The pipeline writes an English sentence per section for
 *      its own report; the page never shows it. `reasonsFor()` turns the structured figures into
 *      message keys, and messages/*.json says it in Thai, Malay and English.
 */

export type PathClass = "look_first" | "worth_a_look" | "no_sign" | "not_seen";
export type Side = "left" | "right";
export type NoteStatus =
  | "not_looked"
  | "checked_imagery"
  | "checked_ground"
  | "opening_exists"
  | "work_planned"
  | "done";

export const NOTE_STATUSES: readonly NoteStatus[] = [
  "not_looked",
  "checked_imagery",
  "checked_ground",
  "opening_exists",
  "work_planned",
  "done",
] as const;

export function noteStatus(value: unknown): NoteStatus | null {
  return NOTE_STATUSES.find((s) => s === value) ?? null;
}

/**
 * How a class is drawn on the map and in the list.
 *
 * Violet, and chosen the way the hazard classes were (lib/hazard-layer.ts): clear of the alert
 * palette, because these are not alert levels, and clear of the pale pink to wine-red of the
 * flood-history layer underneath, because the sections are drawn on top of it. A class is named in
 * words wherever it appears as well, so the colour is never carrying the meaning alone
 * (accessibility: icon + text + colour).
 *
 * One violet family rather than violet shading into grey, which is where this started: a grey
 * line sat 59 points from the stale grey `--alert-stale`, which in Jaga means "not updated since"
 * on an alert that still holds. "No sign in the radar record" and "this warning has gone stale"
 * must not be able to look like one another, so every class is violet and the measurement is a
 * test (tests/unit/highway-paths.test.ts).
 *
 * The two classes an office acts on are the heavy lines; "the radar has not seen it" is dashed, so
 * it is told apart from "no sign" by its pattern and not only by its lightness.
 */
export const CLASS_LOOK: Record<
  PathClass,
  { color: string; night: string; width: number; dashed: boolean }
> = {
  look_first: { color: "#5B21B6", night: "#C4B5FD", width: 5, dashed: false },
  worth_a_look: { color: "#8B5CF6", night: "#A78BFA", width: 3.5, dashed: false },
  no_sign: { color: "#9AA2C4", night: "#8A91C8", width: 1.5, dashed: false },
  not_seen: { color: "#C2C6DC", night: "#9B94C9", width: 1.5, dashed: true },
};

/** The two classes an office acts on, in the order the page lists them. */
export const FLAGGED: readonly PathClass[] = ["look_first", "worth_a_look"] as const;

/** Every class, highest first, as a legend reads. */
export const ALL_CLASSES: readonly PathClass[] = [
  "look_first",
  "worth_a_look",
  "no_sign",
  "not_seen",
] as const;

/**
 * The caveats that go out with every list (safety rule 8 and A19 item 4). Message keys under
 * `highwayPaths.limits`; the page renders all of them, and tests/unit/highway-paths.test.ts
 * checks that none has gone missing and that no wording claims the road blocks the flood.
 */
export const LIMITS = ["extentNotDepth", "couldBeNatural", "notMapped", "checkIt"] as const;

export type PlanningProvince = { code: string; nameTh: string; nameEn: string };

export type StretchRow = {
  id: string;
  klass: PathClass;
  rank: number | null;
  score: number | null;
  km: number;
  sections: number;
  runId: string;
  runDate: string;
  sectionId: string;
  roadKind: string;
  roadRef: string | null;
  roadNameTh: string | null;
  roadNameEn: string | null;
  districtTh: string;
  districtEn: string;
  tambonTh: string;
  tambonEn: string;
  tambonCode: string;
  lat: number;
  lon: number;
  upstreamSide: Side | null;
  upstreamBy: "d8" | "crossing" | "dem" | "unclear";
  d8DemAgree: boolean | null;
  asymmetry: number | null;
  seasonsSeen: number;
  seasonsUpWetter: number;
  seasonsDownWetter: number;
  persistence: number | null;
  passesSeen: number;
  passesFloodedUp: number;
  passesFloodedDown: number;
  crossingKm2: number | null;
  crossingFrom: Side | null;
  crossingOpening: "bridge" | "culvert" | "waterway" | null;
  crossingOpeningM: number | null;
  crossingLat: number | null;
  crossingLon: number | null;
  noteStatus: NoteStatus | null;
  note: string | null;
  noteAt: string | null;
  noteUnit: string | null;
};

type Row = Record<string, unknown>;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/** The provinces this account may open the page for. Empty for everyone but an office and an admin. */
export async function readMyPlanningProvinces(
  supabase: SupabaseClient,
): Promise<PlanningProvince[]> {
  const { data, error } = await supabase.rpc("my_planning_provinces");
  if (error || !Array.isArray(data)) return [];
  return (data as Row[]).map((r) => ({
    code: String(r.province_code),
    nameTh: String(r.name_th ?? ""),
    nameEn: String(r.name_en ?? ""),
  }));
}

/**
 * Which run this province's rows are, and how many sections it has at all.
 *
 * Needed because `readStretchBoard()` answers with the FLAGGED stretches only, and "no flagged
 * stretch here" and "nothing has been loaded yet" are different things an office must be able to
 * tell apart: the first is a real answer about their roads, the second is a job for an admin. A
 * count, not the rows, so the 1,000-row cap this feature has to respect elsewhere does not apply.
 */
export async function readRunStamp(
  supabase: SupabaseClient,
  province: string,
): Promise<{ sections: number; runId: string; runDate: string } | null> {
  const { data, error, count } = await supabase
    .from("highway_sections")
    .select("run_id, run_date", { count: "exact" })
    .eq("province_code", province)
    .limit(1);
  const row = (data as Row[] | null)?.[0];
  if (error || !row) return null;
  return {
    sections: count ?? 0,
    runId: String(row.run_id ?? ""),
    runDate: String(row.run_date ?? ""),
  };
}

/** One province's flagged stretches, best first, each with the office's own note. */
export async function readStretchBoard(
  supabase: SupabaseClient,
  province: string,
): Promise<StretchRow[]> {
  const { data, error } = await supabase.rpc("highway_stretch_board", { p_province: province });
  if (error || !Array.isArray(data)) return [];
  return (data as Row[]).map((r) => ({
    id: String(r.stretch_id),
    klass: (r.stretch_class as PathClass) ?? "worth_a_look",
    rank: num(r.rank),
    score: num(r.score),
    km: Number(r.km ?? 0),
    sections: Number(r.sections ?? 1),
    runId: String(r.run_id ?? ""),
    runDate: String(r.run_date ?? ""),
    sectionId: String(r.section_id),
    roadKind: String(r.road_kind ?? ""),
    roadRef: str(r.road_ref),
    roadNameTh: str(r.road_name_th),
    roadNameEn: str(r.road_name_en),
    districtTh: String(r.district_th ?? ""),
    districtEn: String(r.district_en ?? ""),
    tambonTh: String(r.tambon_th ?? ""),
    tambonEn: String(r.tambon_en ?? ""),
    tambonCode: String(r.tambon_code ?? ""),
    lat: Number(r.mid_lat ?? 0),
    lon: Number(r.mid_lon ?? 0),
    upstreamSide: (str(r.upstream_side) as Side | null) ?? null,
    upstreamBy: (str(r.upstream_by) as StretchRow["upstreamBy"]) ?? "unclear",
    d8DemAgree: r.d8_dem_agree === null || r.d8_dem_agree === undefined ? null : !!r.d8_dem_agree,
    asymmetry: num(r.asymmetry),
    seasonsSeen: Number(r.seasons_seen ?? 0),
    seasonsUpWetter: Number(r.seasons_up_wetter ?? 0),
    seasonsDownWetter: Number(r.seasons_down_wetter ?? 0),
    persistence: num(r.persistence),
    passesSeen: Number(r.passes_seen ?? 0),
    passesFloodedUp: Number(r.passes_flooded_up ?? 0),
    passesFloodedDown: Number(r.passes_flooded_down ?? 0),
    crossingKm2: num(r.crossing_km2),
    crossingFrom: (str(r.crossing_from) as Side | null) ?? null,
    crossingOpening: (str(r.crossing_opening) as StretchRow["crossingOpening"]) ?? null,
    crossingOpeningM: num(r.crossing_opening_m),
    crossingLat: num(r.crossing_lat),
    crossingLon: num(r.crossing_lon),
    noteStatus: noteStatus(r.note_status),
    note: str(r.note),
    noteAt: str(r.note_at),
    noteUnit: str(r.note_unit),
  }));
}

export type Reason = { key: string; values: Record<string, string | number> };

/**
 * Why this stretch is on the list, as message keys and their numbers.
 *
 * Each reason is one of the parts of the pipeline's score (METHODS rule 8), said in the order an
 * engineer would want it: the difference between the two sides first, then how often and how long,
 * then the drainage crossing and whether anything is mapped to carry it. A reason is only included
 * when the figure behind it is actually there, so a stretch flagged on its crossing alone does not
 * get a sentence about seasons it was never seen in.
 */
export function reasonsFor(row: StretchRow): Reason[] {
  const out: Reason[] = [];
  const side = row.upstreamSide;

  if (side && row.asymmetry !== null && row.asymmetry > 0 && row.seasonsSeen > 0) {
    out.push({
      key: "asymmetry",
      values: {
        side,
        points: Math.round(row.asymmetry * 100),
        seasons: row.seasonsSeen,
      },
    });
  }
  if (row.seasonsUpWetter > 0 && row.seasonsSeen > 0) {
    out.push({
      key: "seasons",
      values: { wetter: row.seasonsUpWetter, seasons: row.seasonsSeen },
    });
  }
  if (row.passesSeen > 0 && row.passesFloodedUp > 0) {
    out.push({
      key: "passes",
      values: {
        up: row.passesFloodedUp,
        down: row.passesFloodedDown,
        seen: row.passesSeen,
      },
    });
  }
  if (row.crossingKm2 !== null) {
    out.push({ key: "crossing", values: { km2: round1(row.crossingKm2) } });
    if (row.crossingOpening === null) {
      out.push({ key: "noOpeningAtAll", values: {} });
    } else if (row.crossingOpeningM !== null && row.crossingOpeningM > 100) {
      out.push({
        key: "openingFar",
        values: { opening: row.crossingOpening, metres: row.crossingOpeningM },
      });
    } else {
      out.push({
        key: "openingNear",
        values: { opening: row.crossingOpening, metres: row.crossingOpeningM ?? 0 },
      });
    }
  }
  // How sure "which side the water comes from" is. Said last, and always said: on the coastal
  // plain it is the weakest link in the chain (METHODS, "Upstream on flat land is uncertain").
  if (row.upstreamBy === "unclear" || !side) {
    out.push({ key: "sideUnclear", values: {} });
  } else {
    out.push({ key: `sideBy_${row.upstreamBy}`, values: { side } });
    if (row.d8DemAgree === false) out.push({ key: "sideDisagree", values: {} });
  }
  return out;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

/** The road as a person says it: "Highway 42", or its class and name when OSM has no number. */
export function roadLabel(
  row: Pick<StretchRow, "roadRef" | "roadNameTh" | "roadNameEn" | "roadKind">,
  locale: string,
): { ref: string | null; name: string | null } {
  const name = locale === "th" ? (row.roadNameTh ?? row.roadNameEn) : (row.roadNameEn ?? row.roadNameTh);
  return { ref: row.roadRef, name: name ?? null };
}

/** A point on an outside map, the way the pipeline's own CSV links it. */
export function mapSearchLink(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

/** Which province to show: the one asked for if this account may read it, else the first it may. */
export function chosenProvince(
  mine: readonly PlanningProvince[],
  asked: string | undefined,
): PlanningProvince | null {
  if (mine.length === 0) return null;
  return mine.find((p) => p.code === asked) ?? mine[0]!;
}
