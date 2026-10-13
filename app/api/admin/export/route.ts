import { getSessionProfile, isAdminRole } from "@/lib/auth";
import {
  EXPORTS,
  exportDays,
  exportFileName,
  exportKind,
  toCsv,
  toGeoJson,
  type ExportRow,
} from "@/lib/export-format";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * Exports for admins (spec 6.5): SOS, reports or alerts as CSV or GeoJSON. The database function
 * behind each one checks the caller again, decides the columns - none carries a phone number, a
 * name or free text - and writes the export to the access log with the number of rows.
 *
 * The SOS export is anonymized unless `full=1` is asked for in so many words.
 */
export async function GET(request: Request) {
  if (!supabaseConfigured()) return new Response("unavailable", { status: 503 });
  const session = await getSessionProfile();
  if (!session || !isAdminRole(session.role)) return new Response("not found", { status: 404 });

  const query = new URL(request.url).searchParams;
  const kind = exportKind(query.get("what"));
  if (!kind) return new Response("bad request", { status: 400 });
  const format = query.get("format") === "geojson" ? "geojson" : "csv";
  const days = exportDays(query.get("days"));
  const anonymized = query.get("full") !== "1";

  const supabase = await createClient();
  // One JSON value, not a table: the API cuts a table at 1,000 rows without saying so.
  const { data, error } = await supabase.rpc("admin_export", {
    p_what: kind,
    p_days: days,
    p_anonymized: anonymized,
  });
  if (error || !Array.isArray(data)) return new Response("unavailable", { status: 502 });
  const rows = data as ExportRow[];
  const columns = EXPORTS[kind].columns;
  const body =
    format === "geojson"
      ? toGeoJson(rows, columns)
      : toCsv(
          rows,
          columns.filter((c) => c !== "geometry"),
        );
  const name = exportFileName(
    kind,
    format,
    days,
    anonymized,
    new Date().toISOString().slice(0, 10),
  );
  return new Response(body, {
    headers: {
      "Content-Type": format === "geojson" ? "application/geo+json" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": NO_STORE,
    },
  });
}
