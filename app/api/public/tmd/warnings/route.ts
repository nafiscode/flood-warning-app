import { unavailable } from "@/lib/supabase/public";
import { currentWarnings, parseWarnings, USER_AGENT, warningsUrl } from "@/lib/tmd";

/**
 * The Thai Meteorological Department's current severe-weather warnings for the South.
 *
 * Through our server, like the Open-Meteo forecast: the feed is one national XML document for
 * everyone, so one cached copy serves every reader, no phone's IP address reaches TMD, and a slow
 * government feed cannot hold up a page. Nothing personal is sent and nothing is written down.
 *
 * TMD announces a few times a day, so a 10-minute cache is well inside its pace. `stale-if-error`
 * runs long on purpose: during a storm the feed is exactly what is under load, and yesterday
 * evening's warning with its time on it beats an empty box (safety rule 7).
 */
const CACHE =
  "public, max-age=0, s-maxage=600, stale-while-revalidate=1800, stale-if-error=21600";

export async function GET() {
  let xml: string;
  try {
    const response = await fetch(warningsUrl(), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/xml, text/xml" },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!response.ok) return unavailable();
    xml = await response.text();
  } catch {
    // TMD down, slow or blocking us: the screens simply show no TMD notice. Jaga's own alerts,
    // the hotlines and the SOS button are untouched by this.
    return unavailable();
  }

  const warnings = currentWarnings(parseWarnings(xml), Date.now());
  return Response.json(
    { warnings, fetchedAt: new Date().toISOString() },
    { headers: { "Cache-Control": CACHE } },
  );
}
