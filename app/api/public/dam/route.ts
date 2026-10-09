import type { Dam, DamData, DamReach, DamSignal, DamTambon } from "@/lib/dam";
import { supabaseConfigured } from "@/lib/supabase/env";
import { CACHE_60S, createPublicClient, unavailable } from "@/lib/supabase/public";

type Row = Record<string, unknown>;

/** The signal as the database names it, converted to the names the app uses. */
function toSignal(row: Row | null | undefined): DamSignal | null {
  if (!row) return null;
  const number = (key: string) => (typeof row[key] === "number" ? (row[key] as number) : null);
  return {
    observedAt: String(row.observed_at),
    fetchedAt: String(row.fetched_at),
    storageMcm: number("storage_mcm"),
    percentFull: number("percent_full"),
    levelM: number("level_m"),
    inflowCms: number("inflow_cms"),
    releasedCms: number("released_cms"),
    spilledCms: number("spilled_cms"),
    outflowCms: number("outflow_cms"),
    riseMcmPerH: number("rise_mcm_per_h"),
    riseWindowH: Number(row.rise_window_h ?? 6),
    grade: row.grade as DamSignal["grade"],
    reasons: (row.reasons ?? []) as DamSignal["reasons"],
    awaiting: (row.awaiting ?? []) as DamSignal["awaiting"],
    readings: Number(row.readings ?? 0),
    stale: Boolean(row.stale),
    confirmedOver: Number(row.confirmed_over ?? 2),
  };
}

/**
 * The dam, the reservoir, the path released water takes, and the operator's latest figures
 * (spec section 15). One address for everyone, kept at the edge for 60 s like the rest of the
 * public map: there is nothing personal in it, so one answer serves all.
 *
 * Three answers are deliberately not here:
 *   * no arrival time, because S7 has not measured the travel times (safety rule 8);
 *   * no admin notice, because a signal awaiting a person's judgement is not public (rule 2);
 *   * no claim that the figures are current. Their own hour is in the answer, and the feed is
 *     known to lag by hours, so the screen can say how old they are.
 */
export async function GET() {
  if (!supabaseConfigured()) return unavailable();
  const supabase = createPublicClient();
  const [map, state, tambons] = await Promise.all([
    supabase.rpc("dam_map"),
    supabase.rpc("dam_state"),
    supabase
      .from("dam_tambons")
      .select("dam_code, source, tambon_code, via, km_from_dam")
      .order("km_from_dam"),
  ]);
  if (map.error || state.error || tambons.error) return unavailable();

  const signals = new Map<string, DamSignal | null>(
    ((state.data ?? []) as Row[]).map((row) => [
      String(row.code),
      toSignal(row.signal as Row | null),
    ]),
  );
  const byDam = new Map<string, DamTambon[]>();
  for (const row of (tambons.data ?? []) as Row[]) {
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
      };
    }),
  };
  return Response.json(body, { headers: { "Cache-Control": CACHE_60S } });
}
