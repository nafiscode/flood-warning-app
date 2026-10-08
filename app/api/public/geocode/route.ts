import type { NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { unavailable } from "@/lib/supabase/public";
import { geocodeUrl, toPlaces, USER_AGENT } from "@/lib/weather";

/**
 * Finding a place by name, for the weather screens, from Open-Meteo's geocoding (free, no key).
 * It searches the whole world (owner's choice, 9 Oct 2026): people here have family and work in
 * Malaysia and elsewhere. The weather screens always say that Jaga's flood alerts cover only
 * Pattani, Yala, Narathiwat and Songkhla, so a forecast for another place can't be read as one.
 *
 * Only a name is sent on; no position and nothing personal. The same query is cached for an hour
 * at the edge, which keeps our call rate at Open-Meteo low whoever is typing.
 */
const CACHE = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

export async function GET(request: NextRequest) {
  const name = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60);
  if (name.length < 2) return unavailable(400);
  const asked = request.nextUrl.searchParams.get("lang") ?? routing.defaultLocale;
  // Place names come back in the reader's language where Open-Meteo has them (Thai does work).
  const language = (routing.locales as readonly string[]).includes(asked)
    ? asked
    : routing.defaultLocale;

  let raw: unknown;
  try {
    const response = await fetch(geocodeUrl(name, language), {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!response.ok) return unavailable();
    raw = await response.json();
  } catch {
    return unavailable();
  }

  // No match is a normal answer, not an error: the picker says "no place found".
  const places = toPlaces(raw as Parameters<typeof toPlaces>[0]);
  return Response.json({ places }, { headers: { "Cache-Control": CACHE } });
}
