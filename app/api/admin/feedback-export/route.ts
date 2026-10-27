import { getSessionProfile, isAdminRole } from "@/lib/auth";
import { toCsv, type ExportRow } from "@/lib/export-format";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * The feedback record as a CSV, for an admin (A15, spec 17 item 7). The database function decides
 * the columns and writes the export to the access log with the number of rows.
 *
 * **Without contacts**, and without the install code, the account or the case id either: a
 * spreadsheet leaves the console and nothing can be taken back out of it, so what goes in is the
 * work - the rating, the chips, the words, the screen, the language and what was done about it.
 * `had_contact` says whether somebody can be written to, which is all a planning list needs.
 */
const COLUMNS = [
  "id",
  "created_at",
  "kind",
  "rating",
  "liked",
  "liked_note",
  "improve",
  "improve_note",
  "message",
  "screen",
  "locale",
  "app_version",
  "device_kind",
  "district_code",
  "role_at_time",
  "moment",
  "status",
  "admin_note",
  "change_ref",
  "public_status",
  "display_name",
  "had_contact",
] as const;

export async function GET(request: Request) {
  if (!supabaseConfigured()) return new Response("unavailable", { status: 503 });
  const session = await getSessionProfile();
  if (!session || !isAdminRole(session.role)) return new Response("not found", { status: 404 });

  const asked = Number(new URL(request.url).searchParams.get("days") ?? 365);
  const days = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), 1825) : 365;

  const supabase = await createClient();
  // One JSON value, not a table: the API cuts a table at 1,000 rows without saying so.
  const { data, error } = await supabase.rpc("admin_feedback_export", { p_days: days });
  if (error || !Array.isArray(data)) return new Response("unavailable", { status: 502 });

  const today = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(data as ExportRow[], COLUMNS), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="jaga-feedback-${days}d-${today}.csv"`,
      "Cache-Control": NO_STORE,
    },
  });
}
