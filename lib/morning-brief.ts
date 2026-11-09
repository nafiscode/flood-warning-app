/**
 * The morning weather brief (the owner's request, 8 Nov 2026): what today's weather is where
 * the person lives, in one or two sentences, with the hours rain is expected.
 *
 * It is ordinary weather, not a flood warning. It carries no alert level, it is never painted in
 * an alert hue, and it always shows the time the model data is from and names the source
 * (safety rule 8, docs/brand.md). Rain is given as "about N mm", never as a promise.
 *
 * Everything here is pure: a `Weather` from lib/weather.ts in, numbers and keys out, so the words
 * can live in messages/*.json in three languages (CLAUDE.md, UI text) and a test can hold the
 * arithmetic. The card that draws it is components/home/MorningBrief.tsx.
 */
import {
  DRY_MM,
  isWet,
  localDate,
  weatherGroup,
  type Weather,
  type WeatherDay,
  type WeatherGroup,
  type WeatherHour,
} from "@/lib/weather";

/**
 * An hour counts as a spell of rain from here up. Not DRY_MM (0.1 mm, the model's trace): in a
 * monsoon month almost every hour holds a trace, and a spell built on it runs from breakfast to
 * midnight and tells nobody anything. One millimetre in an hour is rain you would want a coat
 * for; anything under it is said as light rain without hours (the owner, 9 Nov 2026).
 */
export const WINDOW_MM = 1;

/** Below this, in the hours ahead, the day is called dry: the model's own trace (lib/weather). */
export const TRACE_MM = DRY_MM;

/** The heaviest stretch is named to the hour, over at most this many hours. */
export const HEAVY_HOURS = 3;

/** A heaviest stretch worth naming holds at least this much rain. */
export const HEAVY_MIN_MM = 2;

/**
 * From here up, the rain is spread over too much of the day to be given as times: the card says
 * it rains on and off, and names the heaviest stretch instead.
 */
export const SPREAD_HOURS = 6;

/** Two wet spells this close together are one spell, not two: nobody plans around a 60 min gap. */
export const MERGE_GAP_HOURS = 1;

/** How many spells are named. Beyond two, "rain on and off" says more than a list of times. */
export const MAX_WINDOWS = 2;

/** A spell of rain expected today: the hours it covers and the wettest hour in it. */
export type RainWindow = {
  /** First wet hour (UTC instant). */
  from: string;
  /** The end of the last wet hour, so a single 14:00 hour reads as 14:00–15:00. */
  to: string;
  /** Rain in the wettest hour of the spell, mm. */
  peakMm: number;
  /** Rain over the whole spell, mm. */
  totalMm: number;
  /** The worst condition in the spell: what the icon shows. */
  group: WeatherGroup;
};

export type MorningBrief = {
  /** The local date at the place the brief is for, YYYY-MM-DD. */
  date: string;
  /** Where in the day the reader is: it changes the words, not the forecast. */
  part: "morning" | "afternoon" | "evening";
  /** The headline condition: the worst wet hour still to come today, else the day's own code. */
  group: WeatherGroup;
  /** Hours of today still ahead. Empty late at night, when the brief speaks of tomorrow. */
  aheadHours: number;
  maxC: number | null;
  minC: number | null;
  /** The day's rain total from the model, mm. */
  rainMm: number;
  /** The day's highest hourly chance of rain, percent, when the model gives one. */
  chance: number | null;
  /** The spells of rain still ahead today, in time order; the two wettest when there are more. */
  windows: RainWindow[];
  /**
   * The heaviest stretch of the day, at most HEAVY_HOURS long: the hours to plan around. Null
   * when the rain is too light or too even for one stretch to be worth naming.
   */
  heaviest: RainWindow | null;
  /** The rain covers so much of the day that naming its hours says nothing (SPREAD_HOURS). */
  spread: boolean;
  /** Rain is expected, but all of it too light for a spell: said as light rain, without hours. */
  trace: boolean;
  /** True when more spells were found than are named. */
  more: boolean;
  /** No rain expected in the hours still ahead. */
  dry: boolean;
  /** The model time this is built from (UTC instant): shown, always (safety rule 8). */
  issuedAt: string;
  /** The place's zone, for printing the hours in it. */
  timezone: string;
};

/** The local hour (0-23) an instant falls on at the place. */
export function localHour(iso: string | number, timezone: string): number {
  const ms = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(ms)) return 0;
  try {
    const text = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hour12: false,
    }).format(new Date(ms));
    const hour = Number.parseInt(text, 10);
    return Number.isFinite(hour) ? hour % 24 : 0;
  } catch {
    return new Date(ms).getUTCHours();
  }
}

/**
 * Morning until 11:00, afternoon until 17:00, evening after that - the place's own clock, not
 * the reader's. The owner's send time for the brief is 06:30 Asia/Bangkok (8 Nov 2026), which
 * falls in "morning"; someone opening Jaga at four in the afternoon gets the same forecast with
 * the rest of the day in it instead of a greeting that has gone stale.
 */
export function dayPart(now: number, timezone: string): MorningBrief["part"] {
  const hour = localHour(now, timezone);
  if (hour < 11) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

/** The wettest of two groups, so a spell with one thundery hour is shown as thundery. */
const RANK: WeatherGroup[] = [
  "clear",
  "mainlyClear",
  "partlyCloudy",
  "overcast",
  "fog",
  "drizzle",
  "rainLight",
  "showers",
  "rain",
  "showersHeavy",
  "rainHeavy",
  "snow",
  "thunder",
  "thunderHail",
];

export function worseGroup(a: WeatherGroup, b: WeatherGroup): WeatherGroup {
  return RANK.indexOf(b) > RANK.indexOf(a) ? b : a;
}

/** One hour later, as an instant: the end of the last hour of a spell. */
const hourAfter = (iso: string): string => new Date(Date.parse(iso) + 3_600_000).toISOString();

/**
 * The spells of rain in a run of hours. Hours are expected in order; a gap of one dry hour
 * inside a spell keeps it one spell (MERGE_GAP_HOURS).
 */
export function rainWindows(hours: WeatherHour[]): RainWindow[] {
  const spells: RainWindow[] = [];
  for (const hour of hours) {
    if (hour.rainMm < WINDOW_MM) continue;
    const group = weatherGroup(hour.code);
    const open = spells[spells.length - 1];
    // The gap is measured in time, not in rows: an hour missing from the forecast is a gap of
    // its own, and the hours of a day are not always all there.
    const gapHours = open ? (Date.parse(hour.at) - Date.parse(open.to)) / 3_600_000 : 0;
    if (open && gapHours <= MERGE_GAP_HOURS) {
      open.to = hourAfter(hour.at);
      open.peakMm = Math.max(open.peakMm, hour.rainMm);
      open.totalMm = Math.round((open.totalMm + hour.rainMm) * 10) / 10;
      open.group = worseGroup(open.group, group);
    } else {
      spells.push({
        from: hour.at,
        to: hourAfter(hour.at),
        peakMm: hour.rainMm,
        totalMm: Math.round(hour.rainMm * 10) / 10,
        group,
      });
    }
  }
  return spells;
}

/** The hours a run of spells covers in all, in hours. */
export function spanHours(windows: RainWindow[]): number {
  return windows.reduce((sum, w) => sum + (Date.parse(w.to) - Date.parse(w.from)) / 3_600_000, 0);
}

/**
 * The wettest stretch of at most `maxHours` consecutive hours: where the rain is concentrated,
 * which is what someone deciding when to go out actually needs. Hours must be next to each other
 * in time, so a gap in the forecast cannot be read across. Null when the heaviest stretch there
 * is holds less than HEAVY_MIN_MM: then there is no "heaviest", only rain.
 */
export function heaviestWindow(hours: WeatherHour[], maxHours = HEAVY_HOURS): RainWindow | null {
  let best: WeatherHour[] = [];
  let bestMm = 0;
  for (let start = 0; start < hours.length; start += 1) {
    const run: WeatherHour[] = [];
    let total = 0;
    for (let i = start; i < hours.length && run.length < maxHours; i += 1) {
      const hour = hours[i]!;
      const previous = run[run.length - 1];
      if (previous && Date.parse(hour.at) - Date.parse(previous.at) !== 3_600_000) break;
      run.push(hour);
      total = Math.round((total + hour.rainMm) * 10) / 10;
      if (total > bestMm) {
        bestMm = total;
        best = [...run];
      }
    }
  }
  const first = best[0];
  const last = best[best.length - 1];
  if (!first || !last || bestMm < HEAVY_MIN_MM) return null;
  return {
    from: first.at,
    to: hourAfter(last.at),
    peakMm: Math.max(...best.map((h) => h.rainMm)),
    totalMm: bestMm,
    group: best.map((h) => weatherGroup(h.code)).reduce(worseGroup),
  };
}

/**
 * Today's brief for one place, from the forecast the app already holds.
 *
 * `now` is the clock, so the brief speaks of the hours still ahead rather than the whole day:
 * at six in the morning that is the whole day, and at nine in the evening it is almost nothing -
 * and then the card says so instead of promising rain that has already fallen.
 */
export function morningBrief(weather: Weather | null, now: number): MorningBrief | null {
  if (!weather) return null;
  const timezone = weather.timezone;
  const today = localDate(new Date(now).toISOString(), timezone);
  // The hours of today that have not happened yet. The hour in progress counts as ahead: rain
  // at 14:20 is news at 14:05.
  const ahead = weather.hours.filter((hour) => {
    const at = Date.parse(hour.at);
    return Number.isFinite(at) && at + 3_600_000 > now && localDate(hour.at, timezone) === today;
  });
  const day: WeatherDay | undefined = weather.days.find((d) => d.date === today) ?? weather.days[0];
  const spells = rainWindows(ahead);
  // The two wettest spells, not the first two: on a day with a shower at breakfast and a
  // downpour at four, the downpour is the one that must be named. Shown in time order.
  const named = [...spells]
    .sort((a, b) => b.totalMm - a.totalMm)
    .slice(0, MAX_WINDOWS)
    .sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  const heaviest = heaviestWindow(ahead);
  const spread = spanHours(spells) >= SPREAD_HOURS;
  const wetAhead = ahead.some((hour) => hour.rainMm >= TRACE_MM);
  const wettest = ahead.reduce<WeatherGroup | null>((worst, hour) => {
    const group = weatherGroup(hour.code);
    if (!isWet(group)) return worst;
    return worst ? worseGroup(worst, group) : group;
  }, null);

  return {
    date: today,
    part: dayPart(now, timezone),
    group: wettest ?? weatherGroup(day?.code ?? weather.code),
    aheadHours: ahead.length,
    maxC: day?.maxC ?? null,
    minC: day?.minC ?? null,
    rainMm: Math.round((day?.rainMm ?? 0) * 10) / 10,
    chance: day?.chance ?? null,
    windows: named,
    heaviest:
      // Only where it adds something: a single short spell has already been named to the hour.
      heaviest && (spread || spells.length > MAX_WINDOWS || spanHours(named) > HEAVY_HOURS + 1)
        ? heaviest
        : null,
    spread,
    trace: spells.length === 0 && wetAhead,
    more: spells.length > MAX_WINDOWS,
    dry: !wetAhead,
    issuedAt: weather.at,
    timezone,
  };
}
