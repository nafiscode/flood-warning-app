/**
 * The Thai Meteorological Department's own forecast model, as a second opinion beside Open-Meteo.
 *
 * Why two models (owner's request, 18 Nov 2026): Jaga must never present a forecast as certain
 * (safety rule 8), and the most honest way to show that is two independent forecasts of the same
 * rain. Where they agree, a reader can lean on the number. Where they disagree - 20 mm against
 * 80 mm for the same night - that disagreement *is* the forecast, and hiding it behind one tidy
 * figure would be a lie of omission. TMD also runs at 3 km over Thailand against Open-Meteo's
 * global grid, so near the hills behind Yala and Narathiwat it has detail the global model cannot.
 *
 * What this never does: raise a level, publish anything, or feed the automated alarm. The alarm
 * reads gauges, not forecasts (safety rule 2), and nothing here is wired to it.
 *
 * **Access.** TMD's model API is free but needs an account, and registering asks for personal
 * details, so only the owner can do it (data.tmd.go.th/nwpapi/register). Without `TMD_NWP_TOKEN`
 * every function here reports that it is not configured and **the app behaves exactly as it did
 * before**: the Open-Meteo forecast is shown alone, with no gap, no error and no mention of TMD.
 * Set the token and the comparison appears by itself.
 *
 * **Verified against the live API on 19 Nov 2026**, with the owner's token, at four points
 * (Pattani, Yala, Narathiwat, Hat Yai). What the real endpoint does, as against the docs it was
 * written from:
 * - The top-level key is `WeatherForecasts`. The other spellings TMD's own documentation shows
 *   (`WeatherForcasts`, `WeatherForecast`) are still accepted below, because a government feed
 *   that disagrees with itself in writing may yet change its mind in production.
 * - `location` comes back as TMD's **grid point**, not the point asked for - about 1 km off at
 *   these latitudes. The forecast therefore reports the position it is actually for.
 * - `duration=24` gave 24 hourly entries starting at the current Bangkok hour, each stamped
 *   `+07:00`, with `rain`, `tc` and `cond` present on every one.
 * - Condition codes 2-6 were seen live and all map to groups the app already draws; the rest of
 *   the table is from the documentation and an unknown code yields a null group, never a wrong one.
 * The reader stays deliberately forgiving: it ignores fields it does not know and returns null
 * rather than throwing or half-reading, so a changed API costs the comparison card and nothing else.
 */

export const NWP_API = "https://data.tmd.go.th/nwpapi/v1/forecast/location/hourly/at";

/** How many hours ahead are compared. TMD's hourly model runs to 72 h; the limit per call is 48. */
export const HOURS = 24;

/** The fields asked for: hourly rain, temperature and TMD's own condition code. */
export const FIELDS = ["rain", "tc", "cond"] as const;

/**
 * TMD's condition codes, from its documentation. Mapped onto the groups the app already draws and
 * has words for in three languages (lib/weather.ts), so nothing new has to be translated.
 */
export const COND_GROUPS: Record<number, string> = {
  1: "clear",
  2: "partlyCloudy",
  3: "partlyCloudy",
  4: "overcast",
  5: "rainLight",
  6: "rain",
  7: "rainHeavy",
  8: "thunder",
  9: "clear",
  10: "clear",
  11: "clear",
  12: "clear",
};

export type TmdForecastHour = {
  /** The hour, as an instant. */
  at: string;
  rainMm: number | null;
  tempC: number | null;
  /** One of the app's own weather groups, or null when TMD sent no condition. */
  group: string | null;
};

export type TmdForecast = {
  lat: number;
  lon: number;
  hours: TmdForecastHour[];
  /** Rain over the hours returned, in mm. */
  rainMm: number;
};

/** Is TMD's model available to this deployment at all? */
export function hasToken(): boolean {
  return Boolean(process.env.TMD_NWP_TOKEN);
}

/**
 * The address for a point. `date` and `hour` are left off on purpose: TMD then starts from the
 * current hour, which is what a reader wants and what keeps one cached answer valid for everyone.
 */
export function forecastUrl(lat: number, lon: number, hours = HOURS): string {
  const url = new URL(NWP_API);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("fields", FIELDS.join(","));
  url.searchParams.set("duration", String(Math.min(Math.max(hours, 1), 48)));
  return url.toString();
}

/** A finite number, or null. Never NaN, and never 0 for a missing value. */
function num(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Read TMD's answer.
 *
 * Returns null - never throws, and never a half-built forecast - for anything it cannot read, so
 * that a changed API or an error page costs the reader the comparison card and nothing else.
 */
export function toForecast(raw: unknown): TmdForecast | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  // TMD's docs show both spellings; accept either, and a bare array too.
  const listed =
    (Array.isArray(body.WeatherForcasts) && body.WeatherForcasts) ||
    (Array.isArray(body.WeatherForecasts) && body.WeatherForecasts) ||
    (Array.isArray(body.WeatherForecast) && body.WeatherForecast) ||
    (Array.isArray(raw) ? (raw as unknown[]) : null);
  if (!listed || listed.length === 0) return null;

  const first = listed[0];
  if (typeof first !== "object" || first === null) return null;
  const record = first as Record<string, unknown>;
  const location = (record.location ?? {}) as Record<string, unknown>;
  const lat = num(location.lat);
  const lon = num(location.lon);
  const entries = Array.isArray(record.forecasts) ? record.forecasts : null;
  if (lat === null || lon === null || !entries) return null;

  const hours: TmdForecastHour[] = [];
  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    // TMD stamps its hours with +07:00, so Date.parse gives the right instant.
    const at = typeof row.time === "string" ? Date.parse(row.time) : NaN;
    if (!Number.isFinite(at)) continue;
    const data = (row.data ?? {}) as Record<string, unknown>;
    const cond = num(data.cond);
    hours.push({
      at: new Date(at).toISOString(),
      rainMm: num(data.rain),
      tempC: num(data.tc),
      group: cond === null ? null : (COND_GROUPS[cond] ?? null),
    });
  }
  if (hours.length === 0) return null;

  const rainMm = hours.reduce((total, hour) => total + (hour.rainMm ?? 0), 0);
  return { lat, lon, hours, rainMm: Math.round(rainMm * 10) / 10 };
}

/* ------------------------------------------------- comparing the two models */

/**
 * How far apart two forecasts of the same rain are.
 *
 * The test is not "do the numbers match" - two models never match - but "would a reader act
 * differently". The thresholds are deliberately coarse, and the words the card uses are chosen
 * from them rather than from a percentage, because a percentage between 2 mm and 6 mm means
 * nothing to anyone.
 */
export type Agreement = "agree" | "differ" | "farApart";

/** Below this, both models are describing a dry or nearly dry day: no disagreement worth naming. */
export const QUIET_MM = 5;

export function agreement(a: number, b: number): Agreement {
  const low = Math.min(a, b);
  const high = Math.max(a, b);
  if (high < QUIET_MM) return "agree";
  // A 20 mm night against a 25 mm night is the same night. A 20 mm night against a 60 mm one is
  // not, and that is worth a reader's attention whichever way round it falls.
  if (high - low < 10 || high < low * 1.5) return "agree";
  return high > low * 3 && high - low >= 30 ? "farApart" : "differ";
}

/** Rain over the next `hours` hours of an Open-Meteo forecast, to compare like with like. */
export function sumRain(
  hours: { at: string; rainMm: number }[],
  from: number,
  count = HOURS,
): number {
  const total = hours
    .filter((hour) => {
      const at = Date.parse(hour.at);
      return Number.isFinite(at) && at >= from && at < from + count * 3_600_000;
    })
    .reduce((sum, hour) => sum + hour.rainMm, 0);
  return Math.round(total * 10) / 10;
}
