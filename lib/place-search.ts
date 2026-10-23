/**
 * Finding a place by name for the pin on the map (the owner's request, 12 Oct). Two sources, and
 * the nearer one is asked first:
 *
 *  - Jaga's own list of tambons, which answers "ต.บานา" at once and names the place the way the
 *    rest of the app does;
 *  - OpenStreetMap's place search, which knows schools, mosques, markets and villages — the
 *    landmarks people steer by when they do not know an address.
 *
 * Nothing here calls anything: the route does that, and these functions are what it is made of,
 * so they can be tested without a network.
 */
import { recoverPlusCode, type Point } from "@/lib/place-input";

export type FoundPlace = {
  name: string;
  /** What narrows it down: the district and province, or the rest of the address. */
  detail: string;
  lat: number;
  lon: number;
  /** tambon: Jaga's own list. landmark: OpenStreetMap. town: the weather service's gazetteer. */
  source: "tambon" | "landmark" | "town" | "code";
  /** The official tambon code, for a result from Jaga's own list: the home chooser picks by it. */
  code?: string;
};

export type DirectoryRow = {
  code: string;
  nameTh: string;
  nameEn: string;
  districtTh: string;
  districtEn: string;
  provinceTh: string;
  provinceEn: string;
  lat: number;
  lon: number;
};

/** The middle of the four provinces, for a short code that names no town at all. */
export const SERVICE_MIDDLE: Point = { lat: 6.8, lon: 101.2 };

const PREFIXES =
  /(ตำบล|อำเภอ|จังหวัด|ต\.|อ\.|จ\.|\b(tambon|amphoe|changwat|mukim|daerah|wilayah|subdistrict|district|province)\b)/gi;

/** Lower case, without the words for "subdistrict of", so "ต.บานา" and "บานา" are the same. */
export function plainName(text: string): string {
  return text
    .toLowerCase()
    .replace(PREFIXES, " ")
    .replace(/[,;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hit(query: string, tokens: string[], name: string): number {
  const wanted = plainName(name);
  if (wanted.length < 2) return 0;
  if (tokens.includes(wanted)) return 5;
  // The start of a name counts only when it is more than half of it: "บ้าน" alone must not
  // bring up every tambon that begins with it.
  if (
    tokens.some(
      (token) => token.length >= 3 && token.length * 2 > wanted.length && wanted.startsWith(token),
    )
  ) {
    return 3;
  }
  // Thai is often typed without spaces: "บ้านบานาปัตตานี" still names Bana.
  if (wanted.length >= 3 && query.replace(/\s/g, "").includes(wanted.replace(/\s/g, ""))) return 3;
  return 0;
}

function asPlace(row: DirectoryRow, thai: boolean): FoundPlace {
  return thai
    ? {
        name: `ต.${row.nameTh}`,
        detail: `อ.${row.districtTh} จ.${row.provinceTh}`,
        lat: row.lat,
        lon: row.lon,
        source: "tambon",
        code: row.code,
      }
    : {
        name: row.nameEn,
        detail: `${row.districtEn}, ${row.provinceEn}`,
        lat: row.lat,
        lon: row.lon,
        source: "tambon",
        code: row.code,
      };
}

/**
 * Tambons the text names, best first. A district on its own gives a few of its tambons, so
 * "อ.ยะรัง" still puts the map in the right part of the country.
 */
export function searchDirectory(text: string, rows: DirectoryRow[], locale: string): FoundPlace[] {
  const query = plainName(text);
  if (query.length < 2) return [];
  const tokens = query.split(" ").filter(Boolean);
  const thai = locale !== "en";
  const scored = rows
    .map((row) => {
      const tambon = Math.max(hit(query, tokens, row.nameTh), hit(query, tokens, row.nameEn));
      const district = Math.max(
        hit(query, tokens, row.districtTh),
        hit(query, tokens, row.districtEn),
      );
      const province = Math.max(
        hit(query, tokens, row.provinceTh),
        hit(query, tokens, row.provinceEn),
      );
      return {
        row,
        tambon,
        district,
        score: tambon * 4 + (district > 0 ? 2 : 0) + (province > 0 ? 1 : 0),
      };
    })
    .sort((a, b) => b.score - a.score || a.row.code.localeCompare(b.row.code));

  const byTambon = scored.filter((entry) => entry.tambon > 0);
  if (byTambon.length > 0) return byTambon.slice(0, 4).map((entry) => asPlace(entry.row, thai));
  return scored
    .filter((entry) => entry.district > 0)
    .slice(0, 4)
    .map((entry) => asPlace(entry.row, thai));
}

/**
 * Where a short plus code's town is. "V7HC+7Q เมืองปัตตานี ปัตตานี" names a district and a
 * province; the first tambon of the best match is near enough to complete the code from.
 */
export function referenceFor(locality: string, rows: DirectoryRow[]): Point | null {
  const query = plainName(locality);
  if (query.length < 2) return null;
  const tokens = query.split(" ").filter(Boolean);
  let best: { row: DirectoryRow; score: number } | null = null;
  for (const row of rows) {
    const score =
      Math.max(hit(query, tokens, row.nameTh), hit(query, tokens, row.nameEn)) * 4 +
      Math.max(hit(query, tokens, row.districtTh), hit(query, tokens, row.districtEn)) * 2 +
      Math.max(hit(query, tokens, row.provinceTh), hit(query, tokens, row.provinceEn));
    if (score > 0 && (!best || score > best.score)) best = { row, score };
  }
  return best ? { lat: best.row.lat, lon: best.row.lon } : null;
}

/** A short plus code as a place, completed from its town, the map's middle, or the service area. */
export function placeFromShortCode(
  code: string,
  locality: string,
  rows: DirectoryRow[],
  near: Point | null,
): FoundPlace | null {
  const reference = referenceFor(locality, rows) ?? near ?? SERVICE_MIDDLE;
  const point = recoverPlusCode(code, reference);
  return point ? { name: code, detail: locality, ...point, source: "code" } : null;
}

export const NOMINATIM = "https://nominatim.openstreetmap.org/search";

/**
 * The search address at OpenStreetMap. The box is the four provinces with a margin, as a
 * preference and not a fence: someone watching a parent's house in Kelantan still finds it.
 */
export function nominatimUrl(query: string, language: string): string {
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    limit: "6",
    "accept-language": language === "en" ? "en,th" : `${language},th,en`,
    viewbox: "99.4,8.6,102.9,5.0",
    bounded: "0",
  });
  return `${NOMINATIM}?${params}`;
}

type RawFound = { display_name?: unknown; name?: unknown; lat?: unknown; lon?: unknown };

/** OpenStreetMap's answer as places. Anything without a usable position is left out. */
export function fromNominatim(raw: unknown): FoundPlace[] {
  if (!Array.isArray(raw)) return [];
  const places: FoundPlace[] = [];
  for (const item of raw as RawFound[]) {
    const lat = Number(item.lat);
    const lon = Number(item.lon);
    const label = typeof item.display_name === "string" ? item.display_name : "";
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || label === "") continue;
    const parts = label.split(",").map((part) => part.trim());
    const name = typeof item.name === "string" && item.name !== "" ? item.name : parts[0]!;
    const rest = parts[0] === name ? parts.slice(1) : parts;
    places.push({
      name,
      // The postcode and the country add length and no help.
      detail: rest
        .filter((part) => !/^\d{5}$/.test(part))
        .slice(0, 4)
        .join(", "),
      lat: Number(lat.toFixed(6)),
      lon: Number(lon.toFixed(6)),
      source: "landmark",
    });
  }
  return places;
}

/** Thailand, Malaysia and their neighbours: where a place someone here watches might be. */
const REGION = { south: -1, north: 21, west: 96, east: 110 };

const inRegion = (place: FoundPlace) =>
  place.lat >= REGION.south &&
  place.lat <= REGION.north &&
  place.lon >= REGION.west &&
  place.lon <= REGION.east;

/**
 * A world-wide search answers "ต.สะเตง" with a ranch in Xinjiang as well, because some word in
 * it looks alike. When anything nearer was found — in the region, or in Jaga's own list — the
 * far-away answers are noise and are dropped; when nothing was, they are all there is and stay.
 */
export function preferNearby(landmarks: FoundPlace[], ownFound: boolean): FoundPlace[] {
  const nearby = landmarks.filter(inRegion);
  return nearby.length > 0 || ownFound ? nearby : landmarks;
}

/** Two results within about 150 m of each other are the same place to someone looking at a list. */
export function mergePlaces(...lists: FoundPlace[][]): FoundPlace[] {
  const kept: FoundPlace[] = [];
  for (const place of lists.flat()) {
    const same = kept.some(
      (other) =>
        Math.abs(other.lat - place.lat) < 0.0015 &&
        Math.abs(other.lon - place.lon) < 0.0015 &&
        other.name === place.name,
    );
    if (!same) kept.push(place);
  }
  return kept.slice(0, 8);
}
