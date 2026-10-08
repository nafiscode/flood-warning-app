import type { MapData } from "@/lib/map-data";
import { toSafePlace } from "@/lib/places";
import { supabaseConfigured } from "@/lib/supabase/env";
import { CACHE_60S, createPublicClient, unavailable } from "@/lib/supabase/public";

type PlaceRow = Record<string, unknown> & { point: { coordinates: [number, number] } };

/**
 * What the public map draws besides the alerts: safe places, flood reports as counts per
 * hexagon, and river gauges. One address for everyone, kept at the edge for 60 s. Reports never
 * leave the database as points (safety rule 6); the counting happens in report_hex_bins().
 */
export async function GET() {
  if (!supabaseConfigured()) return unavailable();
  const supabase = createPublicClient();
  const [places, reports, gauges] = await Promise.all([
    supabase
      .from("safe_places")
      .select(
        "id, name, type, status, verification_status, point, freeboard_m, flooded_2024, flooded_2025, capacity, needs, updated_at",
      )
      .neq("status", "closed")
      .contains("suitable_for", ["flood"])
      .limit(5000),
    supabase.rpc("report_hex_bins"),
    supabase.rpc("station_status"),
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
    gauges: ((gauges.data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      name: (row.name ?? {}) as Record<string, string>,
      lat: Number(row.lat),
      lon: Number(row.lon),
      value: typeof row.value === "number" ? row.value : null,
      observedAt: typeof row.observed_at === "string" ? row.observed_at : null,
      status: row.status as MapData["gauges"][number]["status"],
    })),
  };
  return Response.json(body, { headers: { "Cache-Control": CACHE_60S } });
}
