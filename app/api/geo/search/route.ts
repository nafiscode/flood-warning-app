import type { NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { parseLatLon } from "@/lib/area";
import { readPlaceInput } from "@/lib/place-input";
import {
  combineLandmarks,
  fromNominatim,
  fromPhoton,
  mergePlaces,
  nominatimUrl,
  photonUrl,
  placeFromShortCode,
  preferNearby,
  searchDirectory,
  type DirectoryRow,
  type FoundPlace,
} from "@/lib/place-search";
import type { Point } from "@/lib/place-input";
import { allowSearch } from "@/lib/search-allowance";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createPublicClient, NO_STORE, unavailable } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";
import { geocodeUrl, placeDetail, toPlaces, USER_AGENT } from "@/lib/weather";

/**
 * Finding a place by name, for putting a pin on the map (the owner's request, 12 Oct): the box
 * on "add a place to watch", the home location and the household form.
 *
 * Jaga's own tambons are looked through first. Landmarks — a school, a mosque, a market, a
 * village, a university — come from OpenStreetMap's search and from Photon, a second search over
 * the same data, asked together so that one being busy or turning this server away does not
 * leave the box empty. If neither finds anything, the gazetteer the weather screens already use
 * is tried for a town.
 *
 * Open to visitors too (the owner, 24 Oct 2026: the home box and the SOS pin map found no landmark
 * without an account; this supersedes "signed in only" of 12 Oct). Someone with no account gets a
 * few searches a minute from one address (lib/search-allowance.ts), because OpenStreetMap asks for
 * no more than a request a second and no search-as-you-type: the box searches when the button is
 * pressed, never while typing, and the services' answers are kept for a day. What was typed is
 * passed on from our server, so the phone's address is never seen there; the answer is kept in
 * that browser for an hour.
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
    // The same name asked again within a day is answered from here: both services ask to be
    // spared repeats, and a shared cloud address that asks too often is the one they turn away.
    next: { revalidate: 86_400 },
  });
  if (!response.ok) throw new Error(`${response.status}`);
  return response.json();
}

/** One search service: its places, or null when it could not be asked (busy, refused, down). */
async function ask(
  service: string,
  url: string,
  read: (raw: unknown) => FoundPlace[],
): Promise<FoundPlace[] | null> {
  try {
    return read(await json(url));
  } catch (error) {
    // Only the service and the reason: never what was typed.
    console.warn(`geo search: ${service} did not answer (${String(error)})`);
    return null;
  }
}

/**
 * Landmarks by name (the owner, 23 Oct: a university in Hat Yai was not found). OpenStreetMap's own
 * search and Photon, a second search over the same data, are asked at the same time, so one of them
 * being busy or refusing this server no longer leaves the box with nothing. When neither finds
 * anything, the weather gazetteer is tried for a town. `complete` is false only when neither
 * landmark search could be made at all, so "not found" is never said when it was not looked for.
 */
async function landmarks(
  query: string,
  language: string,
  near: Point | null,
): Promise<{ places: FoundPlace[]; complete: boolean }> {
  const [osm, photon] = await Promise.all([
    ask("openstreetmap", nominatimUrl(query, language), fromNominatim),
    ask("photon", photonUrl(query, near), fromPhoton),
  ]);
  const both = combineLandmarks(osm, photon);
  if (both.places.length > 0) return both;
  try {
    const raw = (await json(geocodeUrl(query, language))) as Parameters<typeof toPlaces>[0];
    const towns = toPlaces(raw).map((place) => ({
      name: place.name,
      detail: placeDetail(place),
      lat: place.lat,
      lon: place.lon,
      source: "town" as const,
    }));
    return { places: towns, complete: both.complete };
  } catch {
    return both;
  }
}

export async function GET(request: NextRequest) {
  const text = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 120);
  if (text.length < 2) return unavailable(400);
  if (!supabaseConfigured()) return unavailable();
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) {
    const address = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!allowSearch(address)) return unavailable(429);
  }

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
  // Where the map is looking, to complete a short code and to lean a search toward it.
  const near = parseLatLon(
    request.nextUrl.searchParams.get("lat"),
    request.nextUrl.searchParams.get("lon"),
  );
  if (input.kind === "shortPlusCode") {
    const place = placeFromShortCode(input.code, input.locality, rows, near);
    return answer(place ? [place] : []);
  }
  if (input.kind !== "search") return unavailable(400);

  const own = searchDirectory(input.query, rows, language);
  const found = await landmarks(input.query, language, near);
  // Both landmark searches down is not "no such place": the list says it may be incomplete, and
  // what Jaga knows by itself is still shown.
  return answer(mergePlaces(own, preferNearby(found.places, own.length > 0)), !found.complete);
}
