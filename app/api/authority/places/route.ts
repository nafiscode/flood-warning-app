import {
  CHECK_STATES,
  PLACE_ROADS,
  PLACE_WATER,
  toRoundPlace,
  type RoundPlace,
} from "@/lib/place-checks";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * A team's round of the safe places it covers (owner, 20 Oct). GET: the list, the ones longest
 * unchecked first. POST: say what one is like now.
 *
 * The database decides everything again - that the caller has a verified team, that the team
 * covers that place, and what the check is worth (safety rule 5). A check never publishes an
 * alert and never notifies a resident (rule 2), so nothing is sent from here.
 *
 * Never cached: the whole point of the list is how old each reading is.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });

export async function GET() {
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return answer({ error: "sign_in" }, 401);
  const { data, error } = await supabase.rpc("authority_places");
  if (error) return answer({ error: error.code === "42501" ? "not_team" : "unavailable" }, 403);
  if (!Array.isArray(data)) return answer({ error: "unavailable" }, 503);
  return answer({
    places: (data as Record<string, unknown>[])
      .map(toRoundPlace)
      .filter((p): p is RoundPlace => p !== null),
  });
}

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
  const water = PLACE_WATER.find((w) => w === input.water) ?? null;
  const road = PLACE_ROADS.find((r) => r === input.road) ?? null;
  const lat = Number(input.lat);
  const lon = Number(input.lon);
  const located = Number.isFinite(lat) && Number.isFinite(lon) && input.lat !== null;

  const { data, error } = await supabase.rpc("place_check_send", {
    p_place: id,
    p_open: open,
    p_water: water,
    p_road: road,
    p_needs: typeof input.needs === "string" ? input.needs.trim().slice(0, 500) || null : null,
    p_lat: located ? lat : null,
    p_lon: located ? lon : null,
  });
  if (error) {
    const why =
      error.code === "42501" ? "not_team" : error.code === "P0002" ? "no_place" : "failed";
    return answer({ error: why }, why === "not_team" ? 403 : 400);
  }
  return answer({ id: typeof data === "string" ? data : null });
}
