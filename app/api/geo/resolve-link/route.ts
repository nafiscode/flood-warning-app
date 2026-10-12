import { resolveMapLink, type Fetcher } from "@/lib/map-link";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE, unavailable } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * Where a shared Google Maps link points (the owner's request, 12 Oct). The browser sends the
 * link, the server follows it — to Google's own map hosts and nowhere else, see lib/map-link.ts —
 * and answers with a position or with "could not tell". Only for someone signed in, never
 * cached, and neither the link nor the position is stored or logged here: the position is saved
 * only if the person then saves the place.
 */
const fetcher: Fetcher = async (url) => {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    // A plain browser's name: without one Google answers a share link with a page of script.
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Jaga/1.0)", "Accept-Language": "en" },
    signal: AbortSignal.timeout(6_000),
    cache: "no-store",
  });
  return {
    status: response.status,
    location: response.headers.get("location"),
    text: () => response.text(),
  };
};

export async function POST(request: Request) {
  if (!supabaseConfigured()) return unavailable();
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return unavailable(401);

  let url = "";
  try {
    const body = (await request.json()) as { url?: unknown };
    if (typeof body.url === "string") url = body.url.trim().slice(0, 600);
  } catch {
    return unavailable(400);
  }
  if (url === "") return unavailable(400);

  try {
    const point = await resolveMapLink(url, fetcher);
    return Response.json({ point }, { headers: { "Cache-Control": NO_STORE } });
  } catch {
    // Unreachable or too slow: the box says so and suggests copying the numbers instead.
    return unavailable();
  }
}
