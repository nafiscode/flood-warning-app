import type { NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { parseLatLon } from "@/lib/area";
import { readPlaceInput } from "@/lib/place-input";
import {
  fromNominatim,
  mergePlaces,
  nominatimUrl,
  placeFromShortCode,
  preferNearby,
  searchDirectory,
  type DirectoryRow,
  type FoundPlace,
} from "@/lib/place-search";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createPublicClient, NO_STORE, unavailable } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";
import { geocodeUrl, placeDetail, toPlaces, USER_AGENT } from "@/lib/weather";

/**
 * Finding a place by name, for putting a pin on the map (the owner's request, 12 Oct): the box
 * on "add a place to watch", the home location and the household form.
 *
 * Jaga's own tambons are looked through first. Landmarks — a school, a mosque, a market, a
 * village — come from OpenStreetMap's search, and if that does not answer, from the gazetteer
 * the weather screens already use, so the box still finds a town when one source is down.
 *
 * Only for someone signed in. Every page that has the box needs an account anyway, and it keeps
 * Jaga from being an open door to somebody else's free service: OpenStreetMap asks for no more
 * than a request a second and no search-as-you-type, so the box searches when the button is
 * pressed, never while typing. What was typed is passed on from our server, so the phone's
 * address is never seen there; the answer is kept in that browser for an hour.
 */
const KEEP = "private, max-age=3600";

async function directory(): Promise<DirectoryRow[]> {
  const supabase = createPublicClient();
  const [provinces, tambons] = await Promise.all([
    supabase.from("provinces").select("code, name_th, name_en"),
    supabase.rpc("tambon_directory").limit(2000),
  ]);
  if (provinces.error || tambons.error || !provinces.data || !tambons.data) return [];
  const province = new Map(provinces.data.map((p) => [p.code as string, p]));
  return (tambons.data as Record<string, unknown>[]).map((t) => ({
    code: t.code as string,
    nameTh: t.name_th as string,
    nameEn: t.name_en as string,
    districtTh: t.district_th as string,
    districtEn: t.district_en as string,
    provinceTh: (province.get(t.province_code as string)?.name_th as string | undefined) ?? "",
    provinceEn: (province.get(t.province_code as string)?.name_en as string | undefined) ?? "",
    lat: t.lat as number,
    lon: t.lon as number,
  }));
}

async function json(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

/** Landmarks by name: OpenStreetMap first, the weather gazetteer when it does not answer. */
async function landmarks(query: string, language: string): Promise<FoundPlace[] | null> {
  try {
    return fromNominatim(await json(nominatimUrl(query, language)));
  } catch {
    // Busy or unreachable: fall through to the second source.
  }
  try {
    const raw = (await json(geocodeUrl(query, language))) as Parameters<typeof toPlaces>[0];
    return toPlaces(raw).map((place) => ({
      name: place.name,
      detail: placeDetail(place),
      lat: place.lat,
      lon: place.lon,
      source: "town" as const,
    }));
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const text = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 120);
  if (text.length < 2) return unavailable(400);
  if (!supabaseConfigured()) return unavailable();
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return unavailable(401);

  const asked = request.nextUrl.searchParams.get("lang") ?? routing.defaultLocale;
  const language = (routing.locales as readonly string[]).includes(asked)
    ? asked
    : routing.defaultLocale;
  const answer = (places: FoundPlace[], partial = false) =>
    Response.json({ places, partial }, { headers: { "Cache-Control": partial ? NO_STORE : KEEP } });

  const rows = await directory();
  const input = readPlaceInput(text);

  // "V7HC+7Q เมืองปัตตานี": the code Google Maps shows for a house with no address. It is
  // completed from the town it names, else from where the map is, and nobody else is asked.
  if (input.kind === "shortPlusCode") {
    const near = parseLatLon(
      request.nextUrl.searchParams.get("lat"),
      request.nextUrl.searchParams.get("lon"),
    );
    const place = placeFromShortCode(input.code, input.locality, rows, near);
    return answer(place ? [place] : []);
  }
  if (input.kind !== "search") return unavailable(400);

  const own = searchDirectory(input.query, rows, language);
  const found = await landmarks(input.query, language);
  // Both sources down is not "no such place": the list says it may be incomplete, and what
  // Jaga knows by itself is still shown.
  return answer(mergePlaces(own, preferNearby(found ?? [], own.length > 0)), found === null);
}
