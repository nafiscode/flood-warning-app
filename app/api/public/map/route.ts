import { toGauge, withSea, type MapData } from "@/lib/map-data";
import { toMapZones } from "@/lib/zone-layer";
import { toSafePlace } from "@/lib/places";
import { supabaseConfigured } from "@/lib/supabase/env";
import { CACHE_60S, createPublicClient, unavailable } from "@/lib/supabase/public";

type PlaceRow = Record<string, unknown> & { point: { coordinates: [number, number] } };

/**
 * What the public map draws besides the alerts: safe places, flood reports as counts per
 * hexagon, river gauges, and the warning zones' outlines. One address for everyone, kept at the
 * edge for 60 s - the zone geometry is static, and which zone is under an alert is worked out in
 * the browser from the live alert status, so the cache cannot hold a stale level. Reports never
 * leave the database as points (safety rule 6); the counting happens in report_hex_bins().
 */
/** The API hands back at most this many rows per request, whatever `limit` asks for. */
const PAGE = 1000;
const MAX_PAGES = 6;

export async function GET() {
  if (!supabaseConfigured()) return unavailable();
  const supabase = createPublicClient();
  /*
   * Every safe place, read a page at a time. One request with a large limit looked right and
   * silently returned the first thousand: the map said "1000" when the table held 2,566.
   */
  const allPlaces = async () => {
    const rows: unknown[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await supabase
        .from("safe_places")
        .select(
          // check_due_at is a computed field (migration ..a10_place_check_due): when the last
          // check goes stale, from the level in force where the place is.
          "id, name, type, status, verification_status, point, freeboard_m, flooded_2024, flooded_2025, capacity, needs, updated_at, checked_at, checked_source, check_due_at, residents_said",
        )
        .neq("status", "closed")
        .contains("suitable_for", ["flood"])
        .order("id")
        .range(page * PAGE, (page + 1) * PAGE - 1);
      if (error) return { data: null, error };
      rows.push(...(data ?? []));
      if ((data ?? []).length < PAGE) break;
    }
    return { data: rows, error: null };
  };
  const [places, reports, gauges, sea, zones] = await Promise.all([
    allPlaces(),
    supabase.rpc("report_hex_bins"),
    supabase.rpc("station_status"),
    supabase.rpc("gauge_sea_gate"),
    // The warning zones' outlines (the owner, 22 Nov). Not in the guard below: a basin boundary
    // is context, and losing it must never cost a reader the alerts, places and gauges.
    supabase.rpc("warning_zone_map"),
  ]);
  if (places.error || reports.error || gauges.error) return unavailable();
  const body: MapData = {
    places: ((places.data ?? []) as PlaceRow[]).map((row) =>
      toSafePlace({ ...row, lon: row.point.coordinates[0], lat: row.point.coordinates[1] }),
    ),
    reports: ((reports.data ?? []) as Record<string, unknown>[]).map((row) => ({
      hex: row.hex as MapData["reports"][number]["hex"],
      count: Number(row.reports),
      deepest: (row.deepest as string | null) ?? null,
      latest: String(row.latest),
    })),
    gauges: withSea(
      ((gauges.data ?? []) as Record<string, unknown>[]).map(toGauge),
      sea.error ? null : sea.data,
    ),
    zones: zones.error ? [] : toMapZones(zones.data),
  };
  return Response.json(body, { headers: { "Cache-Control": CACHE_60S } });
}
