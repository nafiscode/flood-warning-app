import type { DamZone, DamZoneData } from "@/lib/dam";
import { supabaseConfigured } from "@/lib/supabase/env";
import { CACHE_60S, createPublicClient, unavailable } from "@/lib/supabase/public";

type Row = Record<string, unknown>;

/**
 * The outlines of the land a rise in the river can reach below each dam (lib/dam.ts, DamZone).
 * Public and the same for everyone, so it is cached at the edge. Only the map asks for it.
 *
 * A dam whose geometry is still the river line alone has no rows, and the answer is an empty
 * list: the map then draws the river as before. A failure is "unavailable", never an empty list,
 * so a broken read cannot pass for "no zone".
 */
export async function GET() {
  if (!supabaseConfigured()) return unavailable();
  const { data, error } = await createPublicClient().rpc("dam_zone_map");
  if (error) return unavailable();
  const zones: DamZone[] = [];
  for (const row of (data ?? []) as Row[]) {
    const band = row.band === "zone" || row.band === "outer" ? row.band : null;
    const geometry = row.geom as DamZone["geometry"] | null;
    if (!band || !geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) continue;
    zones.push({ dam: String(row.dam_code), band, geometry });
  }
  const body: DamZoneData = { zones };
  return Response.json(body, { headers: { "Cache-Control": CACHE_60S } });
}
