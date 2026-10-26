import type { DamArrival } from "@/lib/dam-arrival";
import type { Dam, DamData, DamDaily, DamReach, DamSignal, DamTambon } from "@/lib/dam";
import { toDamSignal } from "@/lib/dam";
import type { DamDay } from "@/lib/dam-chart";
import { supabaseConfigured } from "@/lib/supabase/env";
import { CACHE_60S, createPublicClient, unavailable } from "@/lib/supabase/public";

type Row = Record<string, unknown>;

/** The signal as the database names it, converted to the names the app uses. */
const toSignal = (row: Row | null | undefined): DamSignal | null => toDamSignal(row);

/** The day behind the newest reading, as the database names it (lib/dam.ts, DamDaily). */
function toDaily(row: Row | null | undefined): DamDaily | null {
  if (!row) return null;
  const number = (key: string) => (typeof row[key] === "number" ? (row[key] as number) : null);
  return {
    windowH: Number(row.window_h ?? 24),
    until: String(row.until),
    inflowHours: Number(row.inflow_hours ?? 0),
    inflowMeanCms: number("inflow_mean_cms"),
    inflowMcm: number("inflow_mcm"),
    outflowHours: Number(row.outflow_hours ?? 0),
    outflowMeanCms: number("outflow_mean_cms"),
    outflowMcm: number("outflow_mcm"),
    spilledMcm: number("spilled_mcm"),
  };
}

/** The fortnight, a day at a time, as the database names it (lib/dam-chart.ts, DamDay). */
function toDays(rows: unknown): DamDay[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((raw): DamDay => {
    const row = raw as Row;
    const number = (key: string) => (typeof row[key] === "number" ? (row[key] as number) : null);
    return {
      day: String(row.day),
      hours: Number(row.hours ?? 0),
      releasedMeanCms: number("released_mean_cms"),
      spilledMeanCms: number("spilled_mean_cms"),
      outflowMeanCms: number("outflow_mean_cms"),
      outflowMcm: number("outflow_mcm"),
      spilledMcm: number("spilled_mcm"),
      storageEndMcm: number("storage_end_mcm"),
      levelEndM: number("level_end_m"),
    };
  });
}

/**
 * The dam, the reservoir, the path released water takes, and the operator's latest figures
 * (spec section 15). One address for everyone, kept at the edge for 60 s like the rest of the
 * public map: there is nothing personal in it, so one answer serves all.
 *
 * The arrival ranges are here (S7, measured at the gauges): they belong to the river rather than
 * to any alert, so a person can read them before anybody has sent them anything.
 *
 * Two answers are deliberately not here:
 *   * no admin notice, because a signal awaiting a person's judgement is not public (rule 2);
 *   * no claim that the figures are current. Their own hour is in the answer, and the feed is
 *     known to lag by hours, so the screen can say how old they are.
 */
export async function GET() {
  if (!supabaseConfigured()) return unavailable();
  const supabase = createPublicClient();
  const [map, state, tambons, arrivals] = await Promise.all([
    supabase.rpc("dam_map"),
    supabase.rpc("dam_state"),
    supabase
      .from("dam_tambons")
      .select("dam_code, source, tambon_code, via, km_from_dam")
      .order("km_from_dam"),
    supabase
      .from("dam_arrivals")
      .select(
        "dam_code, source, tambon_code, via, km_from_dam, warn_from_h, earliest_h, latest_h, peak_earliest_h, peak_latest_h",
      )
      .order("km_from_dam"),
  ]);
  if (map.error || state.error || tambons.error || arrivals.error) return unavailable();

  const signals = new Map<string, DamSignal | null>(
    ((state.data ?? []) as Row[]).map((row) => [
      String(row.code),
      toSignal(row.signal as Row | null),
    ]),
  );
  const fortnights = new Map<string, DamDay[]>(
    ((state.data ?? []) as Row[]).map((row) => [String(row.code), toDays(row.days)]),
  );
  const dailies = new Map<string, DamDaily | null>(
    ((state.data ?? []) as Row[]).map((row) => [
      String(row.code),
      toDaily(row.daily as Row | null),
    ]),
  );
  const arrivalsByDam = new Map<string, DamArrival[]>();
  for (const row of (arrivals.data ?? []) as Row[]) {
    const dam = String(row.dam_code);
    const list = arrivalsByDam.get(dam) ?? [];
    list.push({
      tambon: String(row.tambon_code),
      via: row.via as DamArrival["via"],
      kmFromDam: Number(row.km_from_dam ?? 0),
      warnFromH: Number(row.warn_from_h ?? 0),
      earliestH: Number(row.earliest_h ?? 0),
      latestH: Number(row.latest_h ?? 0),
      peakEarliestH: Number(row.peak_earliest_h ?? 0),
      peakLatestH: Number(row.peak_latest_h ?? 0),
      source: String(row.source ?? ""),
    });
    arrivalsByDam.set(dam, list);
  }
  // Two versions of the path can sit in the table at once (the river line and the zone); a dam's
  // tambons are those of the geometry it is drawn with.
  const sourceOf = new Map<string, string>(
    ((map.data ?? []) as Row[]).map((row) => [String(row.code), String(row.geometry_source ?? "osm")]),
  );
  const byDam = new Map<string, DamTambon[]>();
  for (const row of (tambons.data ?? []) as Row[]) {
    if (String(row.source) !== sourceOf.get(String(row.dam_code))) continue;
    const list = byDam.get(String(row.dam_code)) ?? [];
    list.push({
      code: String(row.tambon_code),
      via: row.via as DamTambon["via"],
      kmFromDam: typeof row.km_from_dam === "number" ? row.km_from_dam : null,
    });
    byDam.set(String(row.dam_code), list);
  }

  const body: DamData = {
    dams: ((map.data ?? []) as Row[]).map((row): Dam => {
      const code = String(row.code);
      return {
        code,
        name: (row.name ?? {}) as Record<string, string>,
        river: (row.river ?? {}) as Record<string, string>,
        operator: String(row.operator ?? ""),
        feed: row.feed === "daily" ? "daily" : "hourly",
        point: (row.point ?? null) as Dam["point"],
        spillwayPoint: (row.spillway_point ?? null) as Dam["point"],
        outletPoint: (row.outlet_point ?? null) as Dam["point"],
        reservoir: (row.reservoir ?? null) as Dam["reservoir"],
        storageMaxMcm: typeof row.storage_max_mcm === "number" ? row.storage_max_mcm : null,
        storageNormalMcm:
          typeof row.storage_normal_mcm === "number" ? row.storage_normal_mcm : null,
        geometrySource: String(row.geometry_source ?? "osm"),
        geometryNote: (row.geometry_note ?? {}) as Dam["geometryNote"],
        reaches: ((row.reaches ?? []) as Row[]).map(
          (reach): DamReach => ({
            kind: reach.kind as DamReach["kind"],
            seq: Number(reach.seq ?? 0),
            name: (reach.name ?? {}) as Record<string, string>,
            kmFromDam: typeof reach.kmFromDam === "number" ? reach.kmFromDam : null,
            lengthKm: typeof reach.lengthKm === "number" ? reach.lengthKm : null,
            line: reach.line as DamReach["line"],
          }),
        ),
        tambons: byDam.get(code) ?? [],
        signal: signals.get(code) ?? null,
        daily: dailies.get(code) ?? null,
        days: fortnights.get(code) ?? [],
        arrivals: arrivalsByDam.get(code) ?? [],
      };
    }),
  };
  return Response.json(body, { headers: { "Cache-Control": CACHE_60S } });
}
