import { sosSendingEnabled } from "@/lib/features";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * Sending a flood report (spec 4.5). A signed-in feature (spec section 3), so unlike an SOS it
 * can be refused: not signed in, no location, or too many reports in the last hour. It is a POST
 * like the SOS so the same offline queue can replay it (lib/queue.ts).
 *
 * The report arrives pending: its photos reach the public map only after an admin has moderated
 * them, and then without the reporter and snapped to the hexagon (safety rule 6).
 */
const DEPTHS = ["dry", "ankle", "knee", "waist", "chest", "above_head", "roof"];
const TRENDS = ["rising", "steady", "falling"];
const ROAD = ["car", "motorbike_only", "impassable"];

export async function POST(request: Request) {
  const answer = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });
  if (!sosSendingEnabled()) return answer({ error: "not_in_service" }, 503);
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);

  let input: Record<string, unknown>;
  try {
    input = (await request.json()) as Record<string, unknown>;
  } catch {
    return answer({ error: "bad_request" }, 400);
  }
  const lat = Number(input.lat);
  const lon = Number(input.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return answer({ error: "no_location" }, 400);
  }

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return answer({ error: "sign_in" }, 401);

  const { data, error } = await supabase.rpc("submit_report", {
    p_lat: lat,
    p_lon: lon,
    p_depth_ref: choice(input.depth, DEPTHS),
    p_trend: choice(input.trend, TRENDS),
    p_road_access: choice(input.roadAccess, ROAD),
    p_text: text(input.text, 1000),
    p_hazard_type: "flood",
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error) {
    // too_many_rows: the hourly limit. The person is told, and the queue does not keep trying.
    if (error.code === "P0003") return answer({ error: "rate" }, 429);
    if (error.code === "42501") return answer({ error: "sign_in" }, 401);
    return answer({ error: "unavailable" }, 503);
  }
  if (!row) return answer({ error: "unavailable" }, 503);
  return answer({ id: row.report_id as string, tambon: (row.tambon_code as string | null) ?? null });
}

function choice(value: unknown, allowed: string[]): string | null {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed === "" ? null : trimmed;
}
