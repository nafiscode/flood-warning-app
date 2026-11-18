import { unavailable } from "@/lib/supabase/public";
import { parseStations, stationsUrl, USER_AGENT } from "@/lib/tmd-stations";

/**
 * Rain measured at the Thai Meteorological Department's stations in the four provinces.
 *
 * TMD serves one national document of about 125 stations; this narrows it to ours and sends on
 * what the card shows. The narrowing happens here rather than on the phone so that a 120 KB XML
 * file is downloaded once by our server instead of once per reader on a 3G connection.
 *
 * The answer is the same for everyone, so one cached copy serves every reader. TMD observes every
 * three hours, so a 15-minute cache is well inside its pace; `stale-if-error` runs long because a
 * reading with its own hour printed on it is still useful when the feed is down.
 */
const CACHE =
  "public, max-age=0, s-maxage=900, stale-while-revalidate=1800, stale-if-error=21600";

export async function GET() {
  let xml: string;
  try {
    const response = await fetch(stationsUrl(), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/xml, text/xml" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    if (!response.ok) return unavailable();
    xml = await response.text();
  } catch {
    return unavailable();
  }

  const stations = parseStations(xml);
  // An empty list is a real answer (every station silent), but it is almost always a changed feed,
  // and caching it for 15 minutes would hide a working one. Let it expire quickly instead.
  if (stations.length === 0) return unavailable();
  return Response.json(
    { stations, fetchedAt: new Date().toISOString() },
    { headers: { "Cache-Control": CACHE } },
  );
}
