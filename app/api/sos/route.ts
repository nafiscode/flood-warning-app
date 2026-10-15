import { after } from "next/server";
import { runPushTick } from "@/lib/push-server";
import { sosSendingEnabled } from "@/lib/features";
import { cleanNeeds, SUPPLIES_LEFT, type SendSos, type SentSos, type SosStatus } from "@/lib/sos";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * Sending an SOS (spec 4.6, safety rule 1).
 *
 * One plain POST, so the offline queue and the service worker can replay exactly what the browser
 * first tried (lib/queue.ts). Everything that decides what happens to the request - a repeat
 * merged into the open case, a suspected-spam flag, an unknown tambon - is in submit_sos() in the
 * database, so a request is never lost between here and there. A visitor needs no account; the
 * answer carries a token with which the phone follows the case.
 *
 * Until the launch switch (JAGA_IN_SERVICE) is on, nobody is watching: sending is refused with
 * 503 rather than storing a request no rescuer will see, and the page shows the hotlines instead.
 */
export async function POST(request: Request) {
  const answer = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });
  if (!sosSendingEnabled()) return answer({ error: "not_in_service" }, 503);
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);

  let input: SendSos;
  try {
    input = (await request.json()) as SendSos;
  } catch {
    return answer({ error: "bad_request" }, 400);
  }
  const lat = Number(input?.lat);
  const lon = Number(input?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return answer({ error: "no_location" }, 400);
  }

  const supplies = input.kind === "supplies";
  const supabase = await createClient();
  // Whoever is owed a notification about a case is told now, after this answer has gone back:
  // the team whose turn it is, or the sender (A7). It never holds up or fails the request.
  after(() => void runPushTick());
  const { data, error } = await supabase.rpc("submit_sos", {
    p_lat: lat,
    p_lon: lon,
    p_accuracy_m: Number.isFinite(Number(input.accuracy)) ? Number(input.accuracy) : null,
    p_location_text: text(input.locationText, 300),
    p_device_id: text(input.deviceId, 100),
    p_phone: text(input.phone, 20),
    p_on_behalf: input.onBehalf === true,
    p_on_behalf_note: text(input.onBehalfNote, 200),
    p_on_site_phone: text(input.onSitePhone, 20),
    p_battery_pct: battery(input.battery),
    // A request for food and water travels the same road (spec 4.10). Anything that is not
    // plainly one is a rescue, and nothing in these fields can make the database refuse.
    p_kind: supplies ? "supplies" : "rescue",
    p_needs: supplies ? cleanNeeds(input.needs) : null,
    p_needs_note: supplies ? text(input.needsNote, 500) : null,
    p_supplies_left:
      supplies && SUPPLIES_LEFT.includes(input.suppliesLeft as (typeof SUPPLIES_LEFT)[number])
        ? input.suppliesLeft
        : null,
    p_people_count: people(input.peopleCount),
    p_token: text(input.caseToken, 100),
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) {
    // Never a 4xx: the queue must keep trying rather than give up on a request for help.
    return answer({ error: "unavailable" }, 503);
  }
  const sent: SentSos = {
    id: row.sos_id as string,
    token: (row.token as string | null) ?? null,
    merged: row.merged === true,
    status: row.status as SosStatus,
    createdAt: row.created_at as string,
  };
  return answer(sent);
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed === "" ? null : trimmed;
}

function people(value: unknown): number | null {
  const n = Number(value);
  if (value === null || value === undefined || !Number.isFinite(n) || n < 1) return null;
  return Math.min(500, Math.round(n));
}

function battery(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}
