import { gateOpens } from "@/lib/push-server";
import { NO_STORE } from "@/lib/supabase/public";
import { runWeatherAdvisories } from "@/lib/weather-advisory-server";

/**
 * The database's hourly knock (A16): "ask Open-Meteo about the places people follow, and push
 * anything severe". Advice about the weather, never an alert (safety rule 2); the run itself is
 * lib/weather-advisory-server.ts.
 *
 * Only a caller holding the token derived from Jaga's push signing key gets past; anyone else
 * gets a plain 404, and the route hands nothing out either way.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  const answer = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });
  if (!gateOpens(request.headers.get("x-jaga-push"))) return answer({ error: "not_found" }, 404);
  return answer(await runWeatherAdvisories());
}
