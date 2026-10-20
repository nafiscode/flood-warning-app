import { CHECK_STATES, PLACE_ROADS, PLACE_WATER } from "@/lib/place-checks";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * A resident saying what a safe place is like now (owner, 20 Oct), sent from the place's pin on
 * the map or from its card. Signed in only, which the database checks again.
 *
 * The database function writes a row and touches the place itself not at all: what a resident
 * says shows as its own attributed line and reaches the covering team's round list, and only an
 * admin or that team can move the status on the card. Nothing here issues an alert or notifies
 * anybody (safety rule 2).
 *
 * Unlike an SOS this may be refused - "too_often" when somebody is sending faster than a person
 * walking between shelters could - because refusing a check costs nobody their life.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });

export async function POST(request: Request) {
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return answer({ error: "sign_in" }, 401);

  let input: Record<string, unknown>;
  try {
    input = (await request.json()) as Record<string, unknown>;
  } catch {
    return answer({ error: "bad_request" }, 400);
  }
  const id = typeof input.id === "string" && UUID.test(input.id) ? input.id : null;
  // A check has to say whether the place is open; everything else is "did not say".
  const open = CHECK_STATES.find((s) => s === input.open);
  if (!id || !open) return answer({ error: "bad_request" }, 400);
  const lat = Number(input.lat);
  const lon = Number(input.lon);
  const located = Number.isFinite(lat) && Number.isFinite(lon) && input.lat !== null;

  const { data, error } = await supabase.rpc("place_check_resident", {
    p_place: id,
    p_open: open,
    p_water: PLACE_WATER.find((w) => w === input.water) ?? null,
    p_road: PLACE_ROADS.find((r) => r === input.road) ?? null,
    p_note: typeof input.note === "string" ? input.note.trim().slice(0, 500) || null : null,
    p_lat: located ? lat : null,
    p_lon: located ? lon : null,
  });
  if (error) {
    // P0003 (too_many_rows) is both limits: the hourly one and "you have just checked this".
    const why =
      error.code === "P0003"
        ? "too_often"
        : error.code === "42501"
          ? "sign_in"
          : error.code === "P0002"
            ? "no_place"
            : "failed";
    return answer({ error: why }, why === "sign_in" ? 401 : why === "too_often" ? 429 : 400);
  }
  return answer({ id: typeof data === "string" ? data : null });
}
