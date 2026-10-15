import { toUnitRequest, type UnitRequest } from "@/lib/journey";
import {
  toAutoAlarm,
  toNoticeRow,
  toReportDecision,
  type AutoAlarm,
  type NoticeRow,
  type ReportDecision,
} from "@/lib/notices";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * What a signed-in person has asked of Jaga that an admin acts on: for now, the teams they have
 * registered and where each registration stands. Their own rows only - row-level security lets a
 * person read the units they own - and never cached. No phone number is in the answer.
 *
 * Requests for help are not here: a phone follows those with the key it holds for each case, so
 * they work without an account.
 */
export async function GET() {
  const answer = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const user = claims?.claims.sub;
  if (!user) return answer({ error: "sign_in" }, 401);
  const { data, error } = await supabase
    .from("authority_units")
    .select("id, unit_name, status, created_at, verified_at, updated_at")
    // A verified team can read every unit; this page is about the caller's own.
    .eq("user_id", user)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return answer({ error: "unavailable" }, 503);
  // For an admin: how many field rescues wait for them. The function refuses everyone else,
  // which simply leaves this out.
  const waiting = await supabase.rpc("admin_field_waiting");
  const row = Array.isArray(waiting.data) ? (waiting.data[0] as Record<string, unknown>) : null;
  const fieldWaiting =
    !waiting.error && row && Number(row.waiting) > 0 && typeof row.newest_id === "string"
      ? { count: Number(row.waiting), newestId: row.newest_id, newestAt: String(row.newest_at) }
      : null;
  // What an admin decided about the caller's own flood reports, for the bell (owner, 15 Oct).
  const decided = await supabase.rpc("my_report_decisions");
  const reports = (Array.isArray(decided.data) ? (decided.data as Record<string, unknown>[]) : [])
    .map(toReportDecision)
    .filter((r): r is ReportDecision => r !== null);
  // For an admin: the automatic alarms, and every alert if they ticked "all alerts" (15 Oct).
  // Anyone else is refused by the function, which simply leaves this out.
  const feed = await supabase.rpc("admin_notice_feed");
  const raw =
    !feed.error && feed.data && typeof feed.data === "object"
      ? (feed.data as Record<string, unknown>)
      : null;
  const admin = raw
    ? {
        allAlerts: raw.allAlerts === true,
        autoAlarms: (Array.isArray(raw.autoAlarms)
          ? (raw.autoAlarms as Record<string, unknown>[])
          : []
        )
          .map(toAutoAlarm)
          .filter((a): a is AutoAlarm => a !== null),
        alerts: (Array.isArray(raw.alerts) ? (raw.alerts as Record<string, unknown>[]) : [])
          .map(toNoticeRow)
          .filter((r): r is NoticeRow => r !== null),
      }
    : null;
  return answer({
    admin,
    fieldWaiting,
    reports,
    units: ((data ?? []) as Record<string, unknown>[])
      .map(toUnitRequest)
      .filter((u): u is UnitRequest => u !== null),
  });
}
