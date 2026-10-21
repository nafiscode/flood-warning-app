import { roundCoord, weatherGroup, type WeatherGroup } from "@/lib/weather";

/**
 * Rain over the person's own places on the map (owner, 15 Oct): a small cloud above their home
 * pin and above each watched place where rain is falling now, with lightning when there is a
 * thunderstorm. It follows the rain groups the weather widget already uses (lib/weather.ts), so
 * the map and the weather page never disagree about what is falling.
 *
 * Only rain is drawn. Clear, cloudy or foggy weather leaves the pin as it is: a cloud on every
 * pin all day would teach people to stop looking at it.
 *
 * Since 21 Oct the same clouds also stand over each dam's reservoir (the owner's request): heavy
 * rain over the lake is what raises it, so the map shows the rain where the water collects, not
 * only where people live. The clouds say what is falling, never what the lake will do - the
 * dam's own figures say that (safety rules 2 and 8).
 */

/** The kinds of cloud, lightest first. One per rain group of the weather widget. */
export const RAIN_KINDS = [
  "drizzle",
  "light",
  "rain",
  "heavy",
  "showers",
  "showersHeavy",
  "thunder",
  "hail",
] as const;
export type RainKind = (typeof RAIN_KINDS)[number];

const BY_GROUP: Partial<Record<WeatherGroup, RainKind>> = {
  drizzle: "drizzle",
  rainLight: "light",
  rain: "rain",
  rainHeavy: "heavy",
  showers: "showers",
  showersHeavy: "showersHeavy",
  thunder: "thunder",
  thunderHail: "hail",
};

/** The cloud for a WMO weather code, or null when no rain is falling. */
export function rainKind(code: number | null | undefined): RainKind | null {
  if (code === null || code === undefined) return null;
  return BY_GROUP[weatherGroup(code)] ?? null;
}

/**
 * How each cloud is drawn. `drops` falling streaks; `long` streaks rather than drops; `slant`
 * for wind-driven heavy rain; `bursts` for showers, which come and go; `dark` for the heavier
 * clouds; `bolt` for lightning; `hail` for pellets among the rain; `peek` for the sun or moon
 * behind a shower cloud (showers fall between sunny spells).
 */
export type CloudLook = {
  drops: number;
  long: boolean;
  slant: boolean;
  bursts: boolean;
  dark: boolean;
  bolt: boolean;
  hail: number;
  peek: boolean;
  /** Seconds one drop takes to fall: drizzle drifts, heavy rain pours. */
  fall: number;
};

export const CLOUD_LOOKS: Record<RainKind, CloudLook> = {
  drizzle: {
    drops: 6,
    long: false,
    slant: false,
    bursts: false,
    dark: false,
    bolt: false,
    hail: 0,
    peek: false,
    fall: 1.9,
  },
  light: {
    drops: 4,
    long: true,
    slant: false,
    bursts: false,
    dark: false,
    bolt: false,
    hail: 0,
    peek: false,
    fall: 1.2,
  },
  rain: {
    drops: 7,
    long: true,
    slant: false,
    bursts: false,
    dark: false,
    bolt: false,
    hail: 0,
    peek: false,
    fall: 0.9,
  },
  heavy: {
    drops: 11,
    long: true,
    slant: true,
    bursts: false,
    dark: true,
    bolt: false,
    hail: 0,
    peek: false,
    fall: 0.6,
  },
  showers: {
    drops: 5,
    long: true,
    slant: false,
    bursts: true,
    dark: false,
    bolt: false,
    hail: 0,
    peek: true,
    fall: 0.9,
  },
  showersHeavy: {
    drops: 9,
    long: true,
    slant: true,
    bursts: true,
    dark: true,
    bolt: false,
    hail: 0,
    peek: false,
    fall: 0.65,
  },
  thunder: {
    drops: 7,
    long: true,
    slant: true,
    bursts: false,
    dark: true,
    bolt: true,
    hail: 0,
    peek: false,
    fall: 0.7,
  },
  hail: {
    drops: 6,
    long: true,
    slant: true,
    bursts: false,
    dark: true,
    bolt: true,
    hail: 4,
    peek: false,
    fall: 0.7,
  },
};

/**
 * A place on the map that may have rain over it: one of the person's own places, or a dam's
 * reservoir (`reservoir`), where rain over the lake and the hills around it is what fills the
 * lake in the hours that follow.
 */
export type RainPlace = {
  id: string;
  lat: number;
  lon: number;
  home: boolean;
  reservoir?: boolean;
};

/** What the weather route says about one point. */
export type PointWeather = { lat: number; lon: number; code: number | null; isDay: boolean };

/**
 * At most this many points in one request: a home and ten watched places, the six reservoirs,
 * plus spare. The person's own places are asked for first, so a long list never costs them
 * their own clouds.
 */
export const MAX_POINTS = 20;

/** The points to ask about, rounded to about a kilometre and without repeats. */
export function rainPoints(places: RainPlace[]): { lat: number; lon: number }[] {
  const seen = new Set<string>();
  const points: { lat: number; lon: number }[] = [];
  for (const place of places) {
    if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) continue;
    const lat = roundCoord(place.lat);
    const lon = roundCoord(place.lon);
    const key = `${lat},${lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push({ lat, lon });
    if (points.length === MAX_POINTS) break;
  }
  return points;
}

/** `6.87,101.25;6.54,101.28` - the form the route takes. */
export function pointsQuery(points: { lat: number; lon: number }[]): string {
  return points.map((p) => `${p.lat},${p.lon}`).join(";");
}

/** The route's own reading of that form; anything malformed or out of range is dropped. */
export function readPointsQuery(value: string | null): { lat: number; lon: number }[] {
  if (!value) return [];
  const points: { lat: number; lon: number }[] = [];
  for (const part of value.split(";")) {
    const [a, b, extra] = part.split(",");
    if (extra !== undefined || a === undefined || b === undefined) continue;
    const lat = Number(a);
    const lon = Number(b);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    points.push({ lat: roundCoord(lat), lon: roundCoord(lon) });
  }
  return rainPoints(points.map((p, i) => ({ ...p, id: String(i), home: false })));
}

const FORECAST_API = "https://api.open-meteo.com/v1/forecast";

/** One Open-Meteo request for every point: its API takes comma-separated coordinate lists. */
export function nowUrl(points: { lat: number; lon: number }[]): string {
  const query = new URLSearchParams({
    latitude: points.map((p) => String(p.lat)).join(","),
    longitude: points.map((p) => String(p.lon)).join(","),
    current: "weather_code,is_day",
    timezone: "GMT",
  });
  return `${FORECAST_API}?${query}`;
}

type RawPoint = { current?: { weather_code?: unknown; is_day?: unknown } };

/**
 * Open-Meteo's answer, in the order the points were asked. One point comes back as an object,
 * several as an array. A point it could not answer keeps a null code: no cloud, never a guess.
 */
export function toPointWeather(
  points: { lat: number; lon: number }[],
  raw: unknown,
): PointWeather[] {
  const list: RawPoint[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? [raw as RawPoint]
      : [];
  return points.map((p, i) => {
    const current = list[i]?.current;
    const code = typeof current?.weather_code === "number" ? current.weather_code : null;
    return { lat: p.lat, lon: p.lon, code, isDay: current?.is_day !== 0 };
  });
}

/** A cloud to draw: where, which kind, and whether the sun or the moon peeks behind it. */
export type RainCloud = {
  id: string;
  lat: number;
  lon: number;
  home: boolean;
  /** A dam's reservoir rather than a place of the person's own. */
  reservoir: boolean;
  kind: RainKind;
  isDay: boolean;
};

/** The clouds for these places, given what the route said; places without rain get none. */
export function rainClouds(places: RainPlace[], weather: PointWeather[]): RainCloud[] {
  const byPoint = new Map(weather.map((w) => [`${w.lat},${w.lon}`, w]));
  const clouds: RainCloud[] = [];
  for (const place of places) {
    const w = byPoint.get(`${roundCoord(place.lat)},${roundCoord(place.lon)}`);
    const kind = rainKind(w?.code);
    if (!w || !kind) continue;
    clouds.push({
      id: place.id,
      lat: place.lat,
      lon: place.lon,
      home: place.home,
      reservoir: place.reservoir === true,
      kind,
      isDay: w.isDay,
    });
  }
  return clouds;
}

/**
 * How far above the place the cloud's bottom sits, in CSS pixels, so the rain falls onto the
 * top of the pin rather than over it: the home pin stands about 46 px tall (its tip on the home,
 * lib/mine-marks.ts), a watched place is a dot in brackets about 16 px from its centre; the
 * drops fade out just before the bottom of the cloud's box, so it sits a little lower than that.
 *
 * A reservoir has no pin: the cloud sits on the lake itself, so the rain is seen falling into
 * the water it fills.
 */
export function cloudLift(spot: { home: boolean; reservoir?: boolean }): number {
  if (spot.reservoir === true) return 0;
  return spot.home ? 32 : 10;
}

/**
 * Where drop `i` of `n` falls across the cloud's width (per cent) and when it starts (seconds),
 * spread evenly with a fixed jitter so every cloud of a kind looks the same and nothing depends
 * on a random number (the server and the browser draw the same thing).
 */
export function dropAt(i: number, n: number, fall: number): { x: number; delay: number } {
  const step = 70 / Math.max(1, n);
  const jitter = ((i * 37) % 11) / 11 - 0.5;
  const x = 15 + step * (i + 0.5) + jitter * step * 0.6;
  const delay = (((i * 53) % 17) / 17) * fall;
  return { x: Math.round(x * 10) / 10, delay: Math.round(delay * 100) / 100 };
}
