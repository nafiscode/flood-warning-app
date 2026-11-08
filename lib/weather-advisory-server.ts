/**
 * The hourly severe-weather run (A16, the owner's decision of 8 Nov 2026).
 *
 * Once an hour the database wakes this (`weather_tick`, migration ..a16_weather_advisory). It
 * asks the database which tambons at least one phone follows, asks Open-Meteo about each of
 * them, and where the hours ahead hold heavy rain, a thunderstorm or strong wind it records one
 * advisory and pushes it to the phones that follow that tambon.
 *
 * It is advice about the weather, not an alert (safety rule 2): no level is set, nothing is
 * published, the words name Open-Meteo and the time of its model data and say that this is not a
 * flood warning (safety rules 8 and 10), and the notification carries the ordinary notice
 * vibration with no repeat knocks, so it can never feel like the alarm.
 *
 * The free tiers set the pace: one forecast request per followed tambon per hour, most-followed
 * first, with a cap - well inside Open-Meteo's non-commercial limits even if every tambon in the
 * four provinces is followed, and nothing at all while no phone follows anything.
 */
import webpush from "web-push";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { weatherPayload, type WeatherDueRow } from "@/lib/push";
import { configured, gateToken } from "@/lib/push-server";
import { createPublicClient } from "@/lib/supabase/public";
import { USER_AGENT } from "@/lib/weather";
import { advisoriesFor, advisoryUrl, aheadOf, pickAdvisory } from "@/lib/weather-advisory";

/** How many places one run asks about. The most-followed come first, so nobody is left out twice. */
export const CELLS_PER_RUN = 60;

/** The same weather is not said again for this long (the database holds to it as well). */
export const GAP_HOURS = 12;

/** How many forecast requests are in flight at once: polite to a free service. */
const LANES = 4;

const WORDS: Record<string, Record<string, string>> = {
  th: th.push.weather,
  ms: ms.push.weather,
  en: en.push.weather,
};

export type WeatherRunOutcome =
  | { skipped: string }
  | { cells: number; advisories: number; sent: number; failed: number; gone: number };

type Cell = {
  tambon: string;
  name_th: string;
  name_en: string;
  lat: number;
  lon: number;
};

type RawHourly = {
  hourly?: {
    time?: string[];
    precipitation?: (number | null)[];
    precipitation_probability?: (number | null)[];
    weather_code?: (number | null)[];
    wind_gusts_10m?: (number | null)[];
  };
  utc_offset_seconds?: number;
};

/**
 * Open-Meteo's hourly answer as the hours the thresholds are read over. The times come back in
 * the place's own local time without a zone, so the offset makes them real instants - the same
 * conversion lib/weather.ts does for the screens.
 */
export function hoursOf(raw: RawHourly): {
  hour: {
    at: string;
    tempC: null;
    code: number | null;
    rainMm: number;
    chance: number | null;
    isDay: boolean;
  };
  gustKmh: number | null;
}[] {
  const hourly = raw.hourly ?? {};
  const offset = typeof raw.utc_offset_seconds === "number" ? raw.utc_offset_seconds : 0;
  const times = (hourly.time ?? []).filter((t): t is string => typeof t === "string");
  return times.map((time, i) => {
    const ms = Date.parse(`${time}Z`);
    const at = new Date(Number.isFinite(ms) ? ms - offset * 1000 : 0).toISOString();
    const rain = hourly.precipitation?.[i];
    const gust = hourly.wind_gusts_10m?.[i];
    const chance = hourly.precipitation_probability?.[i];
    return {
      hour: {
        at,
        tempC: null,
        code: typeof hourly.weather_code?.[i] === "number" ? hourly.weather_code[i]! : null,
        rainMm: typeof rain === "number" && Number.isFinite(rain) ? Math.max(0, rain) : 0,
        chance: typeof chance === "number" ? chance : null,
        isDay: true,
      },
      gustKmh: typeof gust === "number" && Number.isFinite(gust) ? gust : null,
    };
  });
}

/** The model time an answer is for: its first hour. Shown with every advisory (safety rule 8). */
export function issuedAtOf(hours: { hour: { at: string } }[]): string {
  return hours[0]?.hour.at ?? new Date().toISOString();
}

async function forecast(cell: Cell): Promise<RawHourly | null> {
  try {
    const response = await fetch(advisoryUrl(cell.lat, cell.lon), {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as RawHourly;
  } catch {
    // Open-Meteo down, slow or rate-limiting us: this hour passes, the next one tries again.
    return null;
  }
}

/**
 * One run. Never throws: a notification that does not leave changes nothing about the app, and
 * the real warning path (an admin publishing an alert) is untouched by anything here.
 */
export async function runWeatherAdvisories(now = Date.now()): Promise<WeatherRunOutcome> {
  try {
    const token = gateToken();
    if (!token || !configured()) return { skipped: "no_keys" };
    const supabase = createPublicClient();
    const { data, error } = await supabase.rpc("weather_cells", {
      p_token: token,
      p_limit: CELLS_PER_RUN,
    });
    if (error) return { skipped: "not_set_up" };
    const cells = (Array.isArray(data) ? data : []) as Cell[];
    // No phone follows anything, or Jaga is in its quiet hours: nothing to do.
    if (cells.length === 0) return { skipped: "nothing_followed" };

    const queue = [...cells];
    const gone: string[] = [];
    let advisories = 0;
    let sent = 0;
    let failed = 0;

    const lane = async () => {
      for (let cell = queue.pop(); cell; cell = queue.pop()) {
        const raw = await forecast(cell);
        if (!raw) continue;
        const hours = hoursOf(raw);
        const found = advisoriesFor(
          aheadOf(
            hours.map((h) => h.hour),
            now,
            hours.map((h) => h.gustKmh),
          ),
        );
        const advisory = pickAdvisory(found);
        if (!advisory) continue;
        const { data: owed, error: pushError } = await supabase.rpc("weather_advisory_push", {
          p_token: token,
          p_tambon: cell.tambon,
          p_kind: advisory.kind,
          p_starts_at: advisory.startsAt,
          p_ends_at: advisory.endsAt,
          p_peak: advisory.peak,
          p_total_mm: advisory.totalMm,
          p_issued_at: issuedAtOf(hours),
          p_gap_hours: GAP_HOURS,
        });
        // No rows: this weather was already said for this tambon, or the place is under an
        // alert, or Jaga has gone quiet since the cells were listed.
        if (pushError || !Array.isArray(owed) || owed.length === 0) continue;
        advisories++;
        for (const row of owed as (WeatherDueRow & {
          endpoint: string;
          keys: { p256dh: string; auth: string };
        })[]) {
          const payload = weatherPayload(row, WORDS[row.locale] ?? WORDS.th!);
          if (!payload) continue;
          try {
            await webpush.sendNotification(
              { endpoint: row.endpoint, keys: row.keys },
              JSON.stringify(payload),
              // Worth nothing once the weather it speaks of has passed, and never urgent:
              // this is a forecast, not an alert.
              { TTL: 3 * 3600, urgency: "normal" },
            );
            sent++;
          } catch (e) {
            const status = (e as { statusCode?: number }).statusCode;
            if (status === 404 || status === 410) gone.push(row.endpoint);
            else failed++;
          }
        }
      }
    };
    await Promise.all(Array.from({ length: LANES }, lane));
    if (gone.length > 0) {
      // The push services say these phones are gone for good; the database forgets them.
      const { error: forgetError } = await supabase.rpc("push_forget", {
        p_token: token,
        p_endpoints: gone,
      });
      if (forgetError) failed++;
    }
    return { cells: cells.length, advisories, sent, failed, gone: gone.length };
  } catch {
    return { skipped: "error" };
  }
}
