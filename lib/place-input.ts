/**
 * Reading whatever a person puts into the "find the place" box (the owner's request, 12 Oct):
 * a name to search for, coordinates copied from anywhere, a link shared from a map app, or the
 * short code Google Maps shows for a house with no address. One box, and it works out which.
 *
 * Nothing here talks to a server or the browser, so every format has a test. The aim is that
 * someone who is not at home with computers can paste what they have and be understood.
 */
export type Point = { lat: number; lon: number };

export type PlaceInput =
  | { kind: "empty" }
  /** A position read straight out of the text. */
  | { kind: "point"; point: Point; from: "coordinates" | "link" | "plusCode" }
  /** A short share link: only the map service knows where it leads, so the server asks it. */
  | { kind: "shortLink"; url: string }
  /** A link we recognise as a web address but cannot read a position from. */
  | { kind: "unknownLink" }
  /** "V7QC+4X Pattani": a short code, which needs a nearby place to be completed. */
  | { kind: "shortPlusCode"; code: string; locality: string }
  | { kind: "search"; query: string };

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

/** Thai numerals, full-width punctuation and odd spaces, turned into what the patterns expect. */
export function tidy(text: string): string {
  return text
    .replace(/[๐-๙]/g, (digit) => String(THAI_DIGITS.indexOf(digit)))
    .replace(/[，、]/g, ",")
    .replace(/[   ​]/g, " ")
    .replace(/[′’‘]/g, "'")
    .replace(/[″”“]/g, '"')
    .trim();
}

function valid(lat: number, lon: number): Point | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  // 0, 0 is the Gulf of Guinea and, in practice, always an empty field somewhere upstream.
  if (lat === 0 && lon === 0) return null;
  return { lat: Number(lat.toFixed(6)), lon: Number(lon.toFixed(6)) };
}

/**
 * Two numbers as a position. Map apps write latitude first, but people copy them the other way
 * round too; around here the longitude is about 101, which no latitude can be, so a pair whose
 * first number is beyond 90 is taken as longitude first.
 */
function ordered(a: number, b: number): Point | null {
  if (Math.abs(a) > 90 && Math.abs(b) <= 90) return valid(b, a);
  return valid(a, b);
}

const NUMBER = String.raw`-?\d{1,3}\.\d+`;

/** "6.87821, 101.27191", with or without brackets, labels, degree signs or N and E. */
function decimalPair(text: string): Point | null {
  const cleaned = text
    .replace(/\b(lat(itude)?|lon(gitude)?|lng|long)\b\s*[:=]?/gi, " ")
    .replace(/(ละติจูด|ลองจิจูด|พิกัด)\s*[:=]?/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .trim();
  const pattern = new RegExp(
    String.raw`^(${NUMBER})\s*°?\s*([NSEW])?\s*[,;/\s]\s*(${NUMBER})\s*°?\s*([NSEW])?$`,
    "i",
  );
  const found = pattern.exec(cleaned);
  if (!found) return null;
  let first = Number(found[1]);
  let second = Number(found[3]);
  const firstSide = found[2]?.toUpperCase();
  const secondSide = found[4]?.toUpperCase();
  if (firstSide === "S" || firstSide === "W") first = -Math.abs(first);
  if (secondSide === "S" || secondSide === "W") second = -Math.abs(second);
  // "101.27 E, 6.87 N": the letters say which is which, whatever the order.
  if ((firstSide === "E" || firstSide === "W") && (secondSide === "N" || secondSide === "S")) {
    return valid(second, first);
  }
  return ordered(first, second);
}

/** 6°52'41.5"N 101°16'18.9"E, and the same with decimal minutes or no seconds. */
function degreesMinutesSeconds(text: string): Point | null {
  const part = String.raw`(\d{1,3}(?:\.\d+)?)\s*°\s*(?:(\d{1,2}(?:\.\d+)?)\s*')?\s*(?:(\d{1,2}(?:\.\d+)?)\s*(?:"|''))?\s*([NSEW])?`;
  const pattern = new RegExp(String.raw`^${part}\s*[,;\s]\s*${part}$`, "i");
  const found = pattern.exec(text);
  if (!found) return null;
  const value = (offset: number) => {
    const degrees = Number(found[offset]);
    const minutes = Number(found[offset + 1] ?? 0);
    const seconds = Number(found[offset + 2] ?? 0);
    if (minutes >= 60 || seconds >= 60) return Number.NaN;
    const side = found[offset + 3]?.toUpperCase();
    const size = degrees + minutes / 60 + seconds / 3600;
    return { size: side === "S" || side === "W" ? -size : size, side };
  };
  const first = value(1);
  const second = value(5);
  if (typeof first === "number" || typeof second === "number") return null;
  if ((first.side === "E" || first.side === "W") && (second.side === "N" || second.side === "S")) {
    return valid(second.size, first.size);
  }
  return ordered(first.size, second.size);
}

/** Coordinates typed or copied as text, in any of the shapes people actually have. */
export function parseCoordinates(text: string): Point | null {
  const cleaned = tidy(text);
  if (cleaned === "") return null;
  return decimalPair(cleaned) ?? degreesMinutesSeconds(cleaned);
}

const PAIR = new RegExp(String.raw`(${NUMBER})\s*(?:,|%2C|\s)\s*(${NUMBER})`, "i");

function pairIn(value: string | null | undefined): Point | null {
  if (!value) return null;
  const found = PAIR.exec(value.replace(/^loc:/i, "").replace(/\+/g, " "));
  return found ? ordered(Number(found[1]), Number(found[2])) : null;
}

/**
 * The position inside a map link, without asking anyone: Google Maps, Apple Maps, OpenStreetMap,
 * the links LINE and Messenger make when someone shares a location, and geo: addresses.
 *
 * A Google link can carry two positions: where the screen was centred (after the @) and the
 * place itself (after !3d and !4d). The place wins, because that is what was shared.
 */
export function coordinatesFromUrl(address: string): Point | null {
  const geo = /^geo:(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/i.exec(address);
  if (geo) return valid(Number(geo[1]), Number(geo[2]));

  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return null;
  }
  const whole = decodeURIComponent(url.pathname + url.search + url.hash);

  const place = new RegExp(String.raw`!3d(${NUMBER})!4d(${NUMBER})`).exec(whole);
  if (place) return valid(Number(place[1]), Number(place[2]));

  // OpenStreetMap marks a pin with mlat and mlon.
  const mlat = url.searchParams.get("mlat");
  const mlon = url.searchParams.get("mlon");
  if (mlat && mlon) {
    const marked = valid(Number(mlat), Number(mlon));
    if (marked) return marked;
  }

  for (const name of ["q", "query", "ll", "destination", "daddr", "center", "sll", "cp", "saddr"]) {
    // Apple writes cp=lat~lon.
    const found = pairIn(url.searchParams.get(name)?.replace("~", ","));
    if (found) return found;
  }

  const at = new RegExp(String.raw`@(${NUMBER}),(${NUMBER})`).exec(whole);
  if (at) return valid(Number(at[1]), Number(at[2]));

  // OpenStreetMap: #map=15/6.8782/101.2719
  const osm = new RegExp(String.raw`map=\d+(?:\.\d+)?/(${NUMBER})/(${NUMBER})`).exec(whole);
  if (osm) return valid(Number(osm[1]), Number(osm[2]));

  // /maps/place/6.8782,101.2719 and /maps/search/6.8782,+101.2719
  const inPath = new RegExp(String.raw`/(?:place|search|dir)/+(${NUMBER}),\+?\s*(${NUMBER})`).exec(
    whole,
  );
  if (inPath) return ordered(Number(inPath[1]), Number(inPath[2]));
  return null;
}

/** Hosts whose links only they can open: the position is behind a redirect. */
const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "g.co", "share.google"]);

/**
 * Google's own country domains a person here is likely to copy a link from. A list, not a
 * pattern: "google." followed by any short ending would also take names anyone can register
 * under a shared suffix (google.pp.ua), and the server follows these links (A10 security review).
 */
const GOOGLE_DOMAINS = new Set([
  "google.com",
  "google.co.th",
  "google.com.my",
  "google.com.sg",
  "google.co.id",
  "google.com.au",
  "google.co.uk",
  "google.co.jp",
]);
const GOOGLE_PREFIXES = ["", "www.", "maps.", "consent."];

function isGoogle(host: string): boolean {
  return GOOGLE_PREFIXES.some(
    (p) => host.startsWith(p) && GOOGLE_DOMAINS.has(host.slice(p.length)),
  );
}

/**
 * True for a link the server is allowed to follow for the person: Google's own map addresses and
 * nothing else. The server checks every hop with this, so a link can never send it anywhere
 * else (see app/api/geo/resolve-link).
 */
export function isMapLinkHost(host: string): boolean {
  const name = host.toLowerCase();
  return SHORT_HOSTS.has(name) || isGoogle(name);
}

const ALPHABET = "23456789CFGHJMPQRVWX";
const PLUS_CODE = new RegExp(
  String.raw`(?:^|[\s,])([${ALPHABET}]{4,8})\+([${ALPHABET}]{2,3})(?=$|[\s,])`,
  "i",
);
/** How big a step of each pair of characters is, in degrees. */
const STEPS = [20, 1, 0.05, 0.0025, 0.000125];

/** The middle of the square a full plus code names ("7P3XV7QC+4X"), or null if it is not one. */
export function decodePlusCode(code: string): Point | null {
  const digits = code.toUpperCase().replace("+", "");
  if (digits.length < 10) return null;
  let lat = -90;
  let lon = -180;
  for (let pair = 0; pair < 5; pair += 1) {
    const a = ALPHABET.indexOf(digits[pair * 2]!);
    const b = ALPHABET.indexOf(digits[pair * 2 + 1]!);
    if (a < 0 || b < 0) return null;
    lat += a * STEPS[pair]!;
    lon += b * STEPS[pair]!;
  }
  return valid(lat + STEPS[4]! / 2, lon + STEPS[4]! / 2);
}

/**
 * A short plus code completed from a place nearby. Google Maps shows "V7QC+4X Pattani": the
 * first four characters are left off because the town says roughly where, so they are taken
 * from the town's own position and the answer is moved one square if another is closer.
 */
export function recoverPlusCode(short: string, near: Point): Point | null {
  const [head = "", tail = ""] = short.toUpperCase().split("+");
  const missing = 8 - head.length;
  if (missing !== 2 && missing !== 4) return null;
  const size = missing === 4 ? 1 : 20;
  const lat = near.lat + 90;
  const lon = near.lon + 180;
  const prefix =
    missing === 4
      ? ALPHABET[Math.floor(lat / 20)]! +
        ALPHABET[Math.floor(lon / 20)]! +
        ALPHABET[Math.floor(lat % 20)]! +
        ALPHABET[Math.floor(lon % 20)]!
      : ALPHABET[Math.floor(lat / 20)]! + ALPHABET[Math.floor(lon / 20)]!;
  const found = decodePlusCode(`${prefix}${head}+${tail}`);
  if (!found) return null;
  let { lat: foundLat, lon: foundLon } = found;
  const half = size / 2;
  if (near.lat + half < foundLat) foundLat -= size;
  else if (near.lat - half > foundLat) foundLat += size;
  if (near.lon + half < foundLon) foundLon -= size;
  else if (near.lon - half > foundLon) foundLon += size;
  return valid(foundLat, foundLon);
}

/** What the text in the box is. The order matters: a link is tried before a name. */
export function readPlaceInput(raw: string): PlaceInput {
  const text = tidy(raw);
  if (text === "") return { kind: "empty" };

  const link = /(?:https?:\/\/|geo:)\S+/i.exec(text)?.[0];
  if (link) {
    const point = coordinatesFromUrl(link);
    if (point) return { kind: "point", point, from: "link" };
    try {
      const host = new URL(link).hostname;
      if (isMapLinkHost(host)) return { kind: "shortLink", url: link };
    } catch {
      // Not an address after all: fall through to what else the text might be.
    }
    return { kind: "unknownLink" };
  }

  const coordinates = parseCoordinates(text);
  if (coordinates) return { kind: "point", point: coordinates, from: "coordinates" };

  const code = PLUS_CODE.exec(text);
  if (code) {
    const whole = `${code[1]!.toUpperCase()}+${code[2]!.toUpperCase()}`;
    if (code[1]!.length === 8) {
      const point = decodePlusCode(whole);
      if (point) return { kind: "point", point, from: "plusCode" };
    } else if (code[1]!.length === 4 || code[1]!.length === 6) {
      const locality = text.replace(code[0]!, " ").replace(/\s+/g, " ").trim();
      return { kind: "shortPlusCode", code: whole, locality };
    }
  }

  return { kind: "search", query: text.slice(0, 80) };
}
