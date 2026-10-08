/**
 * Weather from Open-Meteo (free for non-commercial use, no key; CLAUDE.md "Attribution").
 *
 * The browser never talks to Open-Meteo itself: /api/public/weather and /api/public/geocode do,
 * so nobody's IP address or exact position reaches a third party, and one cached answer serves
 * everyone near the same place. The coordinates we send are rounded to about 1 km.
 *
 * This is ordinary weather, not a flood warning: the screens always say so, always show the time
 * the model data is from and name the source (safety rule 8).
 */

/** Open-Meteo asks for a contact in the User-Agent of a non-browser client. */
export const USER_AGENT = `Jaga/1.0 (flood early warning, non-profit${
  process.env.CONTACT_EMAIL ? `; ${process.env.CONTACT_EMAIL}` : ""
})`;

export const FORECAST_API = "https://api.open-meteo.com/v1/forecast";
export const GEOCODING_API = "https://geocoding-api.open-meteo.com/v1/search";

/** 24 h of hours are listed; 48 h are drawn as rain bars. */
export const HOURS = 48;
export const HOURS_LISTED = 24;
export const DAYS = 7;

/** A reading older than this is shown with its time, so nobody reads it as "now". */
export const STALE_MS = 3 * 60 * 60_000;

/**
 * WMO weather codes grouped into what the app can say in three languages and draw an icon for.
 * Codes Open-Meteo doesn't use here (freezing rain, hail) fall into the nearest group.
 */
export const WEATHER_GROUPS = [
  "clear",
  "mainlyClear",
  "partlyCloudy",
  "overcast",
  "fog",
  "drizzle",
  "rainLight",
  "rain",
  "rainHeavy",
  "showers",
  "showersHeavy",
  "snow",
  "thunder",
  "thunderHail",
] as const;
export type WeatherGroup = (typeof WEATHER_GROUPS)[number];

const BY_CODE = new Map<number, WeatherGroup>([
  [0, "clear"],
  [1, "mainlyClear"],
  [2, "partlyCloudy"],
  [3, "overcast"],
  [45, "fog"],
  [48, "fog"],
  [51, "drizzle"],
  [53, "drizzle"],
  [55, "drizzle"],
  [56, "drizzle"],
  [57, "drizzle"],
  [61, "rainLight"],
  [63, "rain"],
  [65, "rainHeavy"],
  [66, "rainLight"],
  [67, "rainHeavy"],
  [71, "snow"],
  [73, "snow"],
  [75, "snow"],
  [77, "snow"],
  [80, "showers"],
  [81, "showers"],
  [82, "showersHeavy"],
  [85, "snow"],
  [86, "snow"],
  [95, "thunder"],
  [96, "thunderHail"],
  [99, "thunderHail"],
]);

/** The group of a WMO code. An unknown code is treated as cloud, never as clear sky. */
export function weatherGroup(code: number | null | undefined): WeatherGroup {
  if (code === null || code === undefined) return "overcast";
  return BY_CODE.get(code) ?? "overcast";
}

/** True for the groups that mean rain is falling, which the chip and the day rows highlight. */
export function isWet(group: WeatherGroup): boolean {
  return (
    group === "drizzle" ||
    group === "rainLight" ||
    group === "rain" ||
    group === "rainHeavy" ||
    group === "showers" ||
    group === "showersHeavy" ||
    group === "thunder" ||
    group === "thunderHail"
  );
}

export const COMPASS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
export type Compass = (typeof COMPASS)[number];

/** The eight-point direction a wind of `degrees` blows from. */
export function compass(degrees: number | null | undefined): Compass | null {
  if (degrees === null || degrees === undefined || !Number.isFinite(degrees)) return null;
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return COMPASS[index]!;
}

/** A place the weather is shown for. Kept on the phone only, never sent to our database. */
export type WeatherPlace = {
  name: string;
  /** Province or state, when the source gives one. */
  area: string | null;
  country: string | null;
  countryCode: string | null;
  lat: number;
  lon: number;
  /** area: the tambon already chosen on the home screen; gps: this phone; search: typed. */
  from: "area" | "gps" | "search";
};

export type WeatherHour = {
  /** UTC instant, so the browser can print it in the place's own time zone. */
  at: string;
  tempC: number | null;
  code: number | null;
  rainMm: number;
  chance: number | null;
  isDay: boolean;
};

export type WeatherDay = {
  /** Local date at the place, as YYYY-MM-DD. */
  date: string;
  /** Noon UTC instant of that local date, for printing the weekday. */
  at: string;
  code: number | null;
  maxC: number | null;
  minC: number | null;
  rainMm: number;
  chance: number | null;
};

export type Weather = {
  /** The rounded point the forecast is for. */
  lat: number;
  lon: number;
  /** IANA zone of the place, e.g. Asia/Bangkok: the hours are printed in it. */
  timezone: string;
  /** The model time the current conditions are for (UTC instant). */
  at: string;
  tempC: number | null;
  feelsC: number | null;
  humidity: number | null;
  /** Rain in the last 15 min to an hour, as the model has it. */
  rainMm: number;
  windKmh: number | null;
  windFrom: Compass | null;
  isDay: boolean;
  code: number | null;
  hours: WeatherHour[];
  days: WeatherDay[];
};

/** About 1 km: enough for weather, and no phone's exact position is ever sent on (spec 7). */
export function roundCoord(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Open-Meteo answers in the place's own local time without a zone ("2026-10-09T05:30").
 * With its offset that becomes a real instant, which Intl can print in any zone.
 */
export function localToIso(local: string, offsetSeconds: number): string {
  const ms = Date.parse(`${local}Z`);
  if (!Number.isFinite(ms)) return new Date(0).toISOString();
  return new Date(ms - offsetSeconds * 1000).toISOString();
}

/** The address of a forecast, with only the fields the app shows. */
export function forecastUrl(lat: number, lon: number): string {
  const query = new URLSearchParams({
    latitude: String(roundCoord(lat)),
    longitude: String(roundCoord(lon)),
    current:
      "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day",
    hourly: "temperature_2m,precipitation_probability,precipitation,weather_code,is_day",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max",
    timezone: "auto",
    forecast_days: String(DAYS),
    forecast_hours: String(HOURS),
  });
  return `${FORECAST_API}?${query}`;
}

export function geocodeUrl(name: string, language: string): string {
  const query = new URLSearchParams({ name, count: "6", format: "json", language });
  return `${GEOCODING_API}?${query}`;
}

type RawSeries = Record<string, (number | string | null)[] | undefined>;
type Raw = {
  utc_offset_seconds?: number;
  timezone?: string;
  latitude?: number;
  longitude?: number;
  current?: Record<string, number | string | null>;
  hourly?: RawSeries;
  daily?: RawSeries;
};

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const mm = (value: unknown): number => Math.max(0, num(value) ?? 0);

/**
 * Open-Meteo's answer reduced to what the screens draw. Done on the server, so a phone on slow
 * 3G downloads a few kB instead of the full response, and a missing field never throws.
 */
export function toWeather(raw: Raw): Weather | null {
  const current = raw.current;
  if (!current || typeof current.time !== "string") return null;
  const offset = num(raw.utc_offset_seconds) ?? 0;
  const timezone = typeof raw.timezone === "string" ? raw.timezone : "Asia/Bangkok";
  const hourly = raw.hourly ?? {};
  const daily = raw.daily ?? {};
  const hourTimes = (hourly.time ?? []).filter((t): t is string => typeof t === "string");
  const dayTimes = (daily.time ?? []).filter((t): t is string => typeof t === "string");

  return {
    lat: roundCoord(num(raw.latitude) ?? 0),
    lon: roundCoord(num(raw.longitude) ?? 0),
    timezone,
    at: localToIso(current.time, offset),
    tempC: num(current.temperature_2m),
    feelsC: num(current.apparent_temperature),
    humidity: num(current.relative_humidity_2m),
    rainMm: mm(current.precipitation),
    windKmh: num(current.wind_speed_10m),
    windFrom: compass(num(current.wind_direction_10m)),
    isDay: num(current.is_day) !== 0,
    code: num(current.weather_code),
    hours: hourTimes.slice(0, HOURS).map((time, i) => ({
      at: localToIso(time, offset),
      tempC: num(hourly.temperature_2m?.[i]),
      code: num(hourly.weather_code?.[i]),
      rainMm: mm(hourly.precipitation?.[i]),
      chance: num(hourly.precipitation_probability?.[i]),
      isDay: num(hourly.is_day?.[i]) !== 0,
    })),
    days: dayTimes.slice(0, DAYS).map((date, i) => ({
      date,
      // Midday, so the weekday is right in the place's zone whatever the reader's own zone is.
      at: localToIso(`${date}T12:00`, offset),
      code: num(daily.weather_code?.[i]),
      maxC: num(daily.temperature_2m_max?.[i]),
      minC: num(daily.temperature_2m_min?.[i]),
      rainMm: mm(daily.precipitation_sum?.[i]),
      chance: num(daily.precipitation_probability_max?.[i]),
    })),
  };
}

type RawPlace = {
  name?: string;
  latitude?: number;
  longitude?: number;
  admin1?: string;
  country?: string;
  country_code?: string;
};

/** Open-Meteo's place search reduced to what the picker shows. */
export function toPlaces(raw: { results?: RawPlace[] } | null): WeatherPlace[] {
  return (raw?.results ?? [])
    .filter(
      (r) => typeof r.name === "string" && num(r.latitude) !== null && num(r.longitude) !== null,
    )
    .map((r) => ({
      name: r.name!,
      area: r.admin1 ?? null,
      country: r.country ?? null,
      countryCode: r.country_code ?? null,
      lat: roundCoord(r.latitude!),
      lon: roundCoord(r.longitude!),
      from: "search" as const,
    }));
}

/** "Pattani, Thailand": the place under the name, without repeating the name itself. */
export function placeDetail(place: WeatherPlace): string {
  return [place.area, place.country].filter((part) => part && part !== place.name).join(", ");
}

/** The highest rain in an hour, for scaling the bars; at least 1 mm so a dry week looks flat. */
export function peakRain(hours: WeatherHour[]): number {
  return Math.max(1, ...hours.map((h) => h.rainMm));
}

/** True once a stored reading is too old to read as "now" (it is then shown with its time). */
export function isStale(at: string | null, now: number): boolean {
  if (!at) return true;
  const ms = Date.parse(at);
  return !Number.isFinite(ms) || now - ms > STALE_MS;
}
