/**
 * Rain actually measured at the Thai Meteorological Department's own weather stations.
 *
 * Why this sits beside the Open-Meteo forecast (owner, 18 Nov 2026): everything else on the
 * weather screens is a model's opinion about the future. This is a reading of the past - how much
 * rain fell at a named station, in the 24 hours up to a stated hour. During a flood that is the
 * number people actually argue about, and it is the one figure on the page that is not a forecast.
 *
 * What it is not: a flood warning, and not a measurement of the reader's own village. TMD has
 * about seven stations across the four provinces, so the nearest one can be tens of kilometres
 * away, and the card says how far. Rain here is famously local: 60 mm at Hat Yai airport says
 * nothing certain about Khlong Hoi Khong. The card therefore reports the station, its distance and
 * its hour, never "rain near you" (safety rules 8 and 10).
 *
 * The one figure shown is `Rainfall24Hr`, the 24-hour total, because its meaning is unambiguous.
 * The feed's other rainfall field has no stated accumulation period, and a number whose period we
 * would be guessing at has no place on a safety screen.
 *
 * Same free feed and same credentials as the warnings (lib/tmd.ts): no account of our own.
 */

import { decodeEntities, tagText, TMD_OFFSET, USER_AGENT } from "@/lib/tmd";

export { USER_AGENT };

export const STATIONS_API = "https://data.tmd.go.th/api/Weather3Hours/V2/";

/** The provinces Jaga serves, as TMD writes them in the feed's `Province` field. */
export const PROVINCES_TH = ["ปัตตานี", "ยะลา", "นราธิวาส", "สงขลา"] as const;

/**
 * A reading older than this is not shown at all. TMD observes every three hours, and a station
 * that has missed two rounds is either broken or the feed is stuck; either way, presenting it
 * beside a live forecast would invite someone to read it as current.
 */
export const STALE_MS = 9 * 60 * 60_000;

/** How many stations a reader is shown. More than three is a table nobody reads on a phone. */
export const SHOWN = 3;

/**
 * No station further than this is shown for a place.
 *
 * Not a tidiness rule - a correctness one. TMD has about seven stations across the four provinces
 * and each round of the feed carries only the ones that have reported: checked on 19 November 2026,
 * one round held all seven and the next held two, both in Songkhla. Without a limit, a reader in
 * Narathiwat would be shown Sa Dao's rain from 190 km away, which tells them nothing about their
 * own district and reads as though it did. Beyond about 80 km the figure is not a check on their
 * forecast any more, so the card says nothing instead (safety rule 8).
 */
export const MAX_KM = 80;

export type TmdStation = {
  /** The WMO number, used only as a stable key. */
  id: string;
  nameTh: string;
  nameEn: string | null;
  provinceTh: string;
  lat: number;
  lon: number;
  /** The hour of the observation. */
  observedAt: string | null;
  /** Rain in the 24 hours up to `observedAt`, in mm. Null when the station did not report it. */
  rain24hMm: number | null;
  tempC: number | null;
  humidity: number | null;
  /** How far the station is from the place the reader is looking at, in km. Added when sorting. */
  distanceKm?: number;
};

/**
 * `11/18/2026 22:00:00`: month first, Bangkok local, no offset - a different format from the one
 * the warning feed uses, which is why this is its own reader.
 */
export function toIso(stamp: string | null): string | null {
  if (!stamp) return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(
    stamp.trim(),
  );
  if (!match) return null;
  const [, m, d, y, hh, mm, ss] = match;
  const pad = (value: string) => value.padStart(2, "0");
  const iso = `${y}-${pad(m!)}-${pad(d!)}T${pad(hh!)}:${mm}:${ss ?? "00"}${TMD_OFFSET}`;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  // A month or day out of range parses in some engines and not others; check it came back whole.
  const back = new Date(at);
  if (back.getUTCFullYear() !== Number(y)) return null;
  return back.toISOString();
}

/**
 * A number, or null for a missing, empty or non-numeric field. Never NaN, and never 0 for an
 * empty one: `Number("")` is 0 in JavaScript, which would turn "this station sent no reading"
 * into "no rain fell here". On a flood screen those are opposite statements.
 */
export function toNumber(text: string | null): number | null {
  if (text === null || text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * Every station of the four provinces in the feed.
 *
 * A hand reader again, for the same reasons as the warnings: no dependency to keep, and junk must
 * yield nothing rather than throw. The province test is done on the raw block before the numbers
 * are read, so a national feed of ~125 stations costs almost nothing to narrow to seven.
 */
export function parseStations(xml: string): TmdStation[] {
  const out: TmdStation[] = [];
  for (const chunk of xml.split(/<Station(?:\s[^>]*)?>/i).slice(1)) {
    const end = chunk.search(/<\/Station>/i);
    const block = end === -1 ? chunk : chunk.slice(0, end);
    const provinceTh = tagText(block, "Province");
    if (!provinceTh || !PROVINCES_TH.some((name) => provinceTh === name)) continue;
    const lat = toNumber(tagText(block, "Latitude"));
    const lon = toNumber(tagText(block, "Longitude"));
    const nameTh = tagText(block, "StationNameThai");
    // Without a position or a name the row cannot be put in front of anyone.
    if (lat === null || lon === null || !nameTh) continue;
    out.push({
      id: tagText(block, "WmoStationNumber") ?? `${lat},${lon}`,
      nameTh,
      nameEn: tagText(block, "StationNameEnglish"),
      provinceTh,
      lat,
      lon,
      observedAt: toIso(tagText(block, "DateTime")),
      rain24hMm: toNumber(tagText(block, "Rainfall24Hr")),
      tempC: toNumber(tagText(block, "AirTemperature")),
      humidity: toNumber(tagText(block, "RelativeHumidity")),
    });
  }
  return out;
}

/**
 * Distance in km, flat-earth. Over the 300 km that hold all four provinces the error against the
 * great circle is centimetres, and the figure is shown rounded to the kilometre: a station is
 * "about 24 km away", which is all the precision the sentence can carry.
 */
export function distanceKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const latKm = 110.574;
  const lonKm = 111.32 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const dy = (a.lat - b.lat) * latKm;
  const dx = (a.lon - b.lon) * lonKm;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Has the station reported recently enough to be shown? */
export function isFresh(station: TmdStation, now: number): boolean {
  const at = station.observedAt ? Date.parse(station.observedAt) : NaN;
  return Number.isFinite(at) && at > now - STALE_MS && at < now + 60 * 60_000;
}

/**
 * The stations to show for a place: the fresh ones, nearest first, each with its distance.
 * Without a place (nobody has chosen one yet) they come in the order TMD listed them, so the card
 * can still show what fell in the provinces.
 */
export function nearestStations(
  stations: TmdStation[],
  place: { lat: number; lon: number } | null,
  now: number,
  limit = SHOWN,
): TmdStation[] {
  const fresh = stations.filter((station) => isFresh(station, now));
  if (!place) return fresh.slice(0, limit);
  return fresh
    .map((station) => ({ ...station, distanceKm: distanceKm(place, station) }))
    .filter((station) => station.distanceKm <= MAX_KM)
    .sort((a, b) => a.distanceKm! - b.distanceKm!)
    .slice(0, limit);
}

/** The station's name in the reader's language, falling back to the Thai one. */
export function stationName(station: TmdStation, locale: string): string {
  if (locale === "th") return station.nameTh;
  // TMD writes its English names in capitals ("PATTANI AIRPORT"); a shout on a phone screen is
  // worse than the Thai, so they are set in title case.
  return station.nameEn ? titleCase(station.nameEn) : station.nameTh;
}

function titleCase(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(
        /(^|[\s(/-])([a-z])/g,
        (_, before: string, letter: string) => before + letter.toUpperCase(),
      )
      // TMD's own abbreviation for an agrometeorological station.
      .replace(/\bAgromet\.?/gi, "Agromet.")
  );
}

export function stationsUrl(): string {
  const uid = process.env.TMD_API_UID || "api";
  const ukey = process.env.TMD_API_KEY || "api12345";
  const url = new URL(STATIONS_API);
  url.searchParams.set("uid", uid);
  url.searchParams.set("ukey", ukey);
  return url.toString();
}

/** Re-exported so a route can decode a field without importing the warning module as well. */
export { decodeEntities };
