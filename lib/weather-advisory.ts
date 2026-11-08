/**
 * Severe weather worth a notification (the owner's decision, 8 Nov 2026): heavy rain, a
 * thunderstorm or strong wind in the hours ahead, from Open-Meteo.
 *
 * This is NOT an alert. Safety rule 2 says only a human publishes an alert, and nothing here
 * publishes one: no level is set, no tambon changes colour, no alert palette is used, and the
 * words say what the forecast says, name Open-Meteo and give the time the model data is from
 * (safety rules 8 and 10). It is advice about the weather, sent with the ordinary notice
 * vibration and no repeat knocks, so it can never be mistaken for the automated alarm.
 *
 * Pure: hours in, advisories out. The thresholds are constants here so they can be read,
 * argued with and tested; the route that uses them is app/api/weather/advisories/route.ts.
 */
import { FORECAST_API, roundCoord, weatherGroup, type WeatherHour } from "@/lib/weather";

export const ADVISORY_KINDS = ["heavy_rain", "thunder", "wind"] as const;
export type AdvisoryKind = (typeof ADVISORY_KINDS)[number];

/** How far ahead the forecast is read. Beyond half a day a model is too loose to wake a phone for. */
export const AHEAD_HOURS = 12;

/**
 * Heavy rain. Both tests have to mean something on this coast, where 30 mm in an afternoon is an
 * ordinary monsoon shower: one very wet hour, or a half-day that adds up to a soaking.
 * (Provisional, like every threshold before the season: pipeline/thresholds owns the river ones,
 * and these are only about what the sky is doing.)
 */
export const HOUR_MM = 15;
export const SIX_HOUR_MM = 40;

/** Strong wind: the gust, not the mean. 60 km/h is where light roofing and small boats suffer. */
export const GUST_KMH = 60;

/** A forecast condition is only worth a notification if the model half believes it. */
export const CHANCE_MIN = 60;

/** The window a kind is read over, in hours. */
const SIX = 6;

export type Advisory = {
  kind: AdvisoryKind;
  /** The first hour the weather is expected (UTC instant). */
  startsAt: string;
  /** The end of the last hour it is expected (UTC instant). */
  endsAt: string;
  /** mm in the wettest hour, or km/h in the strongest gust. */
  peak: number;
  /** Rain over the spell in mm, for heavy rain; null for the others. */
  totalMm: number | null;
};

/**
 * The address of the forecast an advisory is judged on. It asks for one thing the app's own
 * forecast does not - the wind gust - and only the hours ahead, so the answer stays small.
 */
export function advisoryUrl(lat: number, lon: number): string {
  const query = new URLSearchParams({
    latitude: String(roundCoord(lat)),
    longitude: String(roundCoord(lon)),
    hourly: "precipitation,precipitation_probability,weather_code,wind_gusts_10m",
    timezone: "auto",
    forecast_hours: String(AHEAD_HOURS + 1),
  });
  return `${FORECAST_API}?${query}`;
}

/** The hours still ahead, at most AHEAD_HOURS of them. */
export function aheadOf(
  hours: WeatherHour[],
  now: number,
  gusts: (number | null)[] = [],
): {
  hour: WeatherHour;
  gustKmh: number | null;
}[] {
  const out: { hour: WeatherHour; gustKmh: number | null }[] = [];
  hours.forEach((hour, i) => {
    const at = Date.parse(hour.at);
    if (!Number.isFinite(at) || at + 3_600_000 <= now) return;
    if (out.length >= AHEAD_HOURS) return;
    out.push({ hour, gustKmh: gusts[i] ?? null });
  });
  return out;
}

const endOf = (iso: string): string => new Date(Date.parse(iso) + 3_600_000).toISOString();
const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Every kind of severe weather the hours ahead hold, in no particular order. A kind is reported
 * once, for the first time it happens: a phone is told "heavy rain from 14:00", not told again
 * for every wet hour after it.
 */
export function advisoriesFor(hours: { hour: WeatherHour; gustKmh: number | null }[]): Advisory[] {
  const found: Advisory[] = [];

  // Heavy rain: the first hour over HOUR_MM, or the start of the first six hours over SIX_HOUR_MM.
  let rainAt = -1;
  for (let i = 0; i < hours.length; i++) {
    if (hours[i]!.hour.rainMm >= HOUR_MM) {
      rainAt = i;
      break;
    }
    const window = hours.slice(i, i + SIX);
    if (window.length === SIX) {
      const total = window.reduce((sum, h) => sum + h.hour.rainMm, 0);
      if (total >= SIX_HOUR_MM) {
        rainAt = i;
        break;
      }
    }
  }
  if (rainAt >= 0) {
    // The spell is the wet hours around it, so the card and the notification can say "until".
    let last = rainAt;
    let peak = 0;
    let total = 0;
    for (let i = rainAt; i < hours.length; i++) {
      const mm = hours[i]!.hour.rainMm;
      if (mm < 1 && i > rainAt) break;
      last = i;
      peak = Math.max(peak, mm);
      total += mm;
    }
    found.push({
      kind: "heavy_rain",
      startsAt: hours[rainAt]!.hour.at,
      endsAt: endOf(hours[last]!.hour.at),
      peak: round1(peak),
      totalMm: round1(total),
    });
  }

  // A thunderstorm the model half believes in.
  const thunder = hours.find(({ hour }) => {
    const group = weatherGroup(hour.code);
    const believed = hour.chance === null || hour.chance >= CHANCE_MIN;
    return (group === "thunder" || group === "thunderHail") && believed;
  });
  if (thunder) {
    found.push({
      kind: "thunder",
      startsAt: thunder.hour.at,
      endsAt: endOf(thunder.hour.at),
      peak: thunder.hour.chance ?? 0,
      totalMm: null,
    });
  }

  // Strong wind.
  const windy = hours.filter((h) => (h.gustKmh ?? 0) >= GUST_KMH);
  if (windy.length > 0) {
    found.push({
      kind: "wind",
      startsAt: windy[0]!.hour.at,
      endsAt: endOf(windy[windy.length - 1]!.hour.at),
      peak: Math.round(Math.max(...windy.map((h) => h.gustKmh ?? 0))),
      totalMm: null,
    });
  }

  return found;
}

/**
 * Which one is sent when more than one is forecast. One notification, not three: a phone that
 * buzzes three times in a minute is a phone whose owner turns Jaga off. Heavy rain comes first
 * because it is the one that floods a street; a thunderstorm nearly always arrives with rain
 * anyway, and wind is the least of the three here.
 */
export const SERIOUSNESS: AdvisoryKind[] = ["heavy_rain", "thunder", "wind"];

export function pickAdvisory(found: Advisory[]): Advisory | null {
  for (const kind of SERIOUSNESS) {
    const hit = found.find((a) => a.kind === kind);
    if (hit) return hit;
  }
  return null;
}
