import { getSessionProfile } from "@/lib/auth";
import { toCsv, toGeoJson, type ExportRow } from "@/lib/export-format";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * The highway-paths page's three files (A19 item 3): the map layer it draws, and the CSV and
 * GeoJSON an office takes into its own GIS.
 *
 * One province per request, and the province is never trusted from here: every one of the three
 * database functions asks `planning_covers_province()` for itself and raises if the answer is no,
 * so a wrong or guessed province code comes back as 404 rather than as somebody else's roads. The
 * two downloads are written to `audit_log` as well - a copy leaving Jaga is worth a line, even
 * when, as here, it holds no personal data at all.
 *
 * Why these come from a function returning one JSON value rather than a table select: the API cuts
 * a table at 1,000 rows without saying so, and Songkhla alone has 2,000 sections. A download that
 * silently loses three quarters of a province is worse than no download.
 */

const PROVINCE = /^[0-9]{2}$/;

/** The columns of the CSV, in the order an engineer reads them. `geometry` is for the GeoJSON. */
const COLUMNS = [
  "id",
  "class",
  "score",
  "stretch",
  "stretch_rank",
  "road_kind",
  "road_ref",
  "road_name_th",
  "road_name_en",
  "province",
  "district_th",
  "district_en",
  "district_code",
  "tambon_th",
  "tambon_en",
  "tambon_code",
  "length_m",
  "bridge_m",
  "twin_section",
  "mid_lat",
  "mid_lon",
  "upstream_side",
  "upstream_by",
  "upstream_d8",
  "upstream_dem",
  "d8_dem_agree",
  "dem_left_m",
  "dem_right_m",
  "asymmetry",
  "seasons_seen",
  "seasons_up_wetter",
  "seasons_down_wetter",
  "persistence",
  "pass_flood_share_up",
  "pass_flood_share_down",
  "passes_seen",
  "passes_flooded_up",
  "passes_flooded_down",
  "cells_left",
  "cells_right",
  "crossings",
  "crossing_km2",
  "crossing_from",
  "crossing_lat",
  "crossing_lon",
  "crossing_opening",
  "crossing_opening_m",
  "bridges",
  "culverts",
  "waterway_crossings",
  "run_id",
  "run_date",
  "osm_way",
] as const;

const NOT_FOUND = () => new Response("not found", { status: 404 });

export async function GET(request: Request) {
  if (!supabaseConfigured()) return new Response("unavailable", { status: 503 });
  const session = await getSessionProfile();
  if (!session) return NOT_FOUND();

  const url = new URL(request.url);
  const province = url.searchParams.get("province") ?? "";
  const format = url.searchParams.get("format") ?? "map";
  if (!PROVINCE.test(province)) return NOT_FOUND();
  if (format !== "map" && format !== "csv" && format !== "geojson") return NOT_FOUND();

  const supabase = await createClient();

  if (format === "map") {
    const { data, error } = await supabase.rpc("highway_sections_map", { p_province: province });
    // The function raises for anyone who may not read that province: that is a 404, not a 500.
    if (error || !data) return NOT_FOUND();
    return Response.json(data, { headers: { "Cache-Control": NO_STORE } });
  }

  const { data, error } = await supabase.rpc("highway_sections_export", { p_province: province });
  if (error || !Array.isArray(data)) return NOT_FOUND();
  const rows = data as ExportRow[];

  // A copy is leaving Jaga. Logged under this account, with which format.
  await supabase.rpc("log_highway_paths_view", { p_province: province, p_download: format });

  const today = new Date().toISOString().slice(0, 10);
  const name = `jaga-highway-paths-${province}-${today}`;
  if (format === "csv") {
    return new Response(toCsv(rows, COLUMNS), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}.csv"`,
        "Cache-Control": NO_STORE,
      },
    });
  }
  return new Response(toGeoJson(rows, COLUMNS), {
    headers: {
      "Content-Type": "application/geo+json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.geojson"`,
      "Cache-Control": NO_STORE,
    },
  });
}
