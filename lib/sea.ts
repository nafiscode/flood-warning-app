/**
 * The sea off the four provinces' coast (the owner, 15 Oct 2026: tide and waves near the coast on
 * the Flood Risk Map, and a short note for fishermen on whether to go out).
 *
 * Seven points a few kilometres offshore, from Songkhla to Tak Bai, each read from Open-Meteo's
 * marine model (waves, swell, sea level) and its weather model (wind, gusts, thunder). Pure: the
 * route fetches, everything here only reads numbers, so it is all testable without a network.
 *
 * Two rules the whole file keeps (safety rules 2 and 8):
 *  - The note is graded from a model and is advisory. It can say "small boats should stay in
 *    port" (TMD's own words for waves of 2-3 m) or "rough, think twice", and otherwise says the
 *    waves are low in the model - never that the sea is safe. With too little data the grade is
 *    "unknown", never calm.
 *  - Heights of the tide are not shown: the model's sea level sat about 0.7 m off the tide gauges
 *    at Pattani (A8, 14 Oct). Only when it rises and falls, and roughly when it turns.
 */

export const COAST_IDS = [
  "songkhla",
  "chana",
  "thepha",
  "pattani",
  "saiburi",
  "narathiwat",
  "takbai",
] as const;
export type CoastId = (typeof COAST_IDS)[number];

/** Offshore, on the model's sea cells (each checked to answer with waves, 15 Oct). */
export const COAST_POINTS: { id: CoastId; province: string; lat: number; lon: number }[] = [
  { id: "songkhla", province: "90", lat: 7.3, lon: 100.68 },
  { id: "chana", province: "90", lat: 7.05, lon: 100.85 },
  { id: "thepha", province: "90", lat: 6.98, lon: 101.08 },
  { id: "pattani", province: "94", lat: 6.98, lon: 101.35 },
  { id: "saiburi", province: "94", lat: 6.78, lon: 101.7 },
  { id: "narathiwat", province: "96", lat: 6.52, lon: 101.92 },
  { id: "takbai", province: "96", lat: 6.35, lon: 102.2 },
];

export const SEA_URL = "/api/public/sea";
export const SEA_USER_AGENT = "Jaga flood early warning (non-profit)";

export type SeaHour = {
  /** Start of the hour, ms since 1970 (UTC). */
  t: number;
  /** Significant wave height, m. */
  wave: number | null;
  /** Where the waves come from, degrees (0 = from the north). */
  waveFrom: number | null;
  /** Wave period, s. */
  period: number | null;
  swell: number | null;
  /** Wind at 10 m and its gusts, km/h. */
  wind: number | null;
  gust: number | null;
  /** WMO weather code (95-99 = thunderstorm). */
  code: number | null;
  /** Sea level in the model, m: read for rising and falling only, never as a height. */
  sea: number | null;
};

export type SeaPoint = {
  id: CoastId;
  province: string;
  lat: number;
  lon: number;
  hours: SeaHour[];
};
export type SeaData = { fetchedAt: string; points: SeaPoint[] };

/** Hours kept: six behind, for the tide curve's start, and two days ahead. */
export const KEEP_BEHIND_H = 6;
export const KEEP_AHEAD_H = 48;
const HOUR = 3_600_000;

export function marineUrl(points = COAST_POINTS): string {
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat).join(","),
    longitude: points.map((p) => p.lon).join(","),
    hourly: "wave_height,wave_direction,wave_period,swell_wave_height,sea_level_height_msl",
    past_days: "1",
    forecast_days: "3",
    timeformat: "unixtime",
    timezone: "GMT",
  });
  return `https://marine-api.open-meteo.com/v1/marine?${q}`;
}

export function windUrl(points = COAST_POINTS): string {
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat).join(","),
    longitude: points.map((p) => p.lon).join(","),
    hourly: "wind_speed_10m,wind_gusts_10m,weather_code",
    past_days: "1",
    forecast_days: "3",
    timeformat: "unixtime",
    timezone: "GMT",
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

type Hourly = { time?: unknown; [key: string]: unknown };
type RawPoint = { hourly?: Hourly };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const column = (h: Hourly | undefined, key: string): unknown[] =>
  Array.isArray(h?.[key]) ? (h![key] as unknown[]) : [];

/**
 * Open-Meteo answers several points as an array, one answer per point in the order asked (one
 * point alone comes back as a single object). The two models are joined by the hour.
 */
export function toSea(
  marine: unknown,
  wind: unknown,
  now: number,
  points = COAST_POINTS,
): SeaData | null {
  const asList = (raw: unknown): RawPoint[] =>
    Array.isArray(raw)
      ? (raw as RawPoint[])
      : raw && typeof raw === "object"
        ? [raw as RawPoint]
        : [];
  const seas = asList(marine);
  const winds = asList(wind);
  if (seas.length !== points.length) return null;
  const from = now - KEEP_BEHIND_H * HOUR;
  const to = now + KEEP_AHEAD_H * HOUR;
  const out: SeaPoint[] = points.map((point, i) => {
    const m = seas[i]?.hourly;
    const w = winds[i]?.hourly;
    const windAt = new Map<number, number>();
    column(w, "time").forEach((t, j) => {
      if (typeof t === "number") windAt.set(t, j);
    });
    const hours: SeaHour[] = [];
    column(m, "time").forEach((t, j) => {
      if (typeof t !== "number") return;
      const ms = t * 1000;
      if (ms < from || ms > to) return;
      const k = windAt.get(t);
      const at = (key: string) => (k === undefined ? null : num(column(w, key)[k]));
      hours.push({
        t: ms,
        wave: num(column(m, "wave_height")[j]),
        waveFrom: num(column(m, "wave_direction")[j]),
        period: num(column(m, "wave_period")[j]),
        swell: num(column(m, "swell_wave_height")[j]),
        sea: num(column(m, "sea_level_height_msl")[j]),
        wind: at("wind_speed_10m"),
        gust: at("wind_gusts_10m"),
        code: at("weather_code"),
      });
    });
    return { ...point, hours };
  });
  if (out.every((p) => p.hours.length === 0)) return null;
  return { fetchedAt: new Date(now).toISOString(), points: out };
}

export type SeaGrade = "calm" | "rough" | "stay" | "unknown";
export const SEA_GRADES: SeaGrade[] = ["stay", "rough", "calm", "unknown"];

/**
 * The cut-offs, on the model's significant wave height and wind. "Stay" follows TMD's standing
 * wording ("คลื่นสูง 2-3 เมตร ... เรือเล็กควรงดออกจากฝั่ง"); "rough" from a metre of waves, a
 * fresh breeze (Beaufort 5, 29-38 km/h) or gusts a small boat feels. Thunder makes it at least
 * rough: lightning and squalls come with it. Jaga's own choice, recorded in docs/decisions.md.
 */
export const SEA_LIMITS = {
  roughWaveM: 1.0,
  stayWaveM: 2.0,
  roughWindKmh: 30,
  stayWindKmh: 40,
  roughGustKmh: 45,
  stayGustKmh: 60,
} as const;
export const THUNDER_CODES: ReadonlySet<number> = new Set([95, 96, 99]);

/** How far ahead the note looks: a day, which covers a night's fishing trip. */
export const OUTLOOK_H = 24;
/** Fewer hours than this with waves in them, and nothing is said but "no forecast". */
export const MIN_HOURS = 12;

export type SeaReason = "waves" | "wind" | "gusts" | "thunder";

export type SeaOutlook = {
  grade: SeaGrade;
  /** Why it is not calm, most important first. */
  reasons: SeaReason[];
  waveMin: number | null;
  waveMax: number | null;
  /** When the highest waves are, ms. */
  waveMaxAt: number | null;
  windMax: number | null;
  gustMax: number | null;
  thunder: boolean;
  /** The first and last hour looked at, ms. */
  from: number | null;
  to: number | null;
};

const rank: Record<SeaGrade, number> = { unknown: 0, calm: 1, rough: 2, stay: 3 };

export function worse(a: SeaGrade, b: SeaGrade): SeaGrade {
  return rank[a] >= rank[b] ? a : b;
}

export function outlook(
  point: Pick<SeaPoint, "hours">,
  now: number,
  hours = OUTLOOK_H,
): SeaOutlook {
  const window = point.hours.filter((h) => h.t >= now - HOUR && h.t <= now + hours * HOUR);
  const waves = window.filter((h) => h.wave !== null);
  const max = (xs: (number | null)[]) => {
    const ok = xs.filter((x): x is number => x !== null);
    return ok.length > 0 ? Math.max(...ok) : null;
  };
  const waveMax = max(waves.map((h) => h.wave));
  const waveMin = waves.length > 0 ? Math.min(...waves.map((h) => h.wave as number)) : null;
  const top = waves.find((h) => h.wave === waveMax);
  const windMax = max(window.map((h) => h.wind));
  const gustMax = max(window.map((h) => h.gust));
  const thunder = window.some((h) => h.code !== null && THUNDER_CODES.has(h.code));
  const base = {
    waveMin,
    waveMax,
    waveMaxAt: top?.t ?? null,
    windMax,
    gustMax,
    thunder,
    from: window[0]?.t ?? null,
    to: window.at(-1)?.t ?? null,
  };
  if (waves.length < MIN_HOURS || waveMax === null) {
    return { ...base, grade: "unknown", reasons: [] };
  }
  const L = SEA_LIMITS;
  const stay: SeaReason[] = [];
  const rough: SeaReason[] = [];
  if (waveMax >= L.stayWaveM) stay.push("waves");
  else if (waveMax >= L.roughWaveM) rough.push("waves");
  if (windMax !== null && windMax >= L.stayWindKmh) stay.push("wind");
  else if (windMax !== null && windMax >= L.roughWindKmh) rough.push("wind");
  if (gustMax !== null && gustMax >= L.stayGustKmh) stay.push("gusts");
  else if (gustMax !== null && gustMax >= L.roughGustKmh) rough.push("gusts");
  if (thunder) rough.push("thunder");
  const grade: SeaGrade = stay.length > 0 ? "stay" : rough.length > 0 ? "rough" : "calm";
  return { ...base, grade, reasons: [...stay, ...rough] };
}

/** The worst note along the coast, for the section's headline. */
export function coastGrade(data: SeaData | null, now: number): SeaGrade {
  if (!data) return "unknown";
  return data.points.reduce<SeaGrade>((g, p) => worse(g, outlook(p, now).grade), "unknown");
}

/** The hour nearest now, for the map's marks: where the waves are heading. */
export function hourNow(point: Pick<SeaPoint, "hours">, now: number): SeaHour | null {
  let best: SeaHour | null = null;
  for (const h of point.hours) {
    if (Math.abs(h.t - now) > 2 * HOUR) continue;
    if (!best || Math.abs(h.t - now) < Math.abs(best.t - now)) best = h;
  }
  return best;
}

/** Waves are reported by where they come from; the map points where they travel to. */
export function travelBearing(from: number | null): number {
  return from === null ? 0 : (((from + 180) % 360) + 360) % 360;
}

/** Wave heights are said to a tenth of a metre, never more precisely than the model deserves. */
export function metres(x: number | null): string {
  return x === null ? "–" : (Math.round(x * 10) / 10).toFixed(1);
}

/** "0.4–1.2", or one figure when both ends round to the same tenth ("0.1", not "0.1–0.1"). */
export function waveRange(min: number | null, max: number | null): string {
  const a = metres(min);
  const b = metres(max);
  return a === b ? b : `${a}–${b}`;
}

export type TideTurn = { kind: "high" | "low"; t: number };
export type Tide = {
  /** Whether the sea is rising or falling now. */
  now: "rising" | "falling";
  /** The coming turns, in order. */
  turns: TideTurn[];
  /** The curve, as 0..1 of the window's own range, for drawing. No heights are given. */
  curve: { t: number; y: number }[];
};

/** Below this the model has no tide worth drawing (a few centimetres is noise). */
export const TIDE_MIN_RANGE_M = 0.05;

/**
 * Rising or falling, and when it turns. A turn is a local high or low of the hourly series, its
 * time refined by a parabola through it and its two neighbours and rounded to ten minutes - the
 * card says "about" anyway.
 */
export function tide(point: Pick<SeaPoint, "hours">, now: number): Tide | null {
  const series = point.hours.filter((h): h is SeaHour & { sea: number } => h.sea !== null);
  if (series.length < 6) return null;
  const values = series.map((h) => h.sea);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi - lo < TIDE_MIN_RANGE_M) return null;
  const turns: TideTurn[] = [];
  for (let i = 1; i < series.length - 1; i++) {
    const a = series[i - 1]!;
    const b = series[i]!;
    const c = series[i + 1]!;
    const high = b.sea > a.sea && b.sea >= c.sea;
    const low = b.sea < a.sea && b.sea <= c.sea;
    if (!high && !low) continue;
    const denom = a.sea - 2 * b.sea + c.sea;
    const shift = denom === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (a.sea - c.sea)) / denom));
    const t = Math.round((b.t + shift * (c.t - b.t)) / 600_000) * 600_000;
    if (t > now) turns.push({ kind: high ? "high" : "low", t });
  }
  // Rising or falling: the hour either side of now.
  const before = [...series].reverse().find((h) => h.t <= now) ?? series[0]!;
  const after = series.find((h) => h.t > now) ?? series.at(-1)!;
  const rising = after.sea >= before.sea;
  return {
    now: rising ? "rising" : "falling",
    turns,
    curve: series.map((h) => ({ t: h.t, y: (h.sea - lo) / (hi - lo) })),
  };
}

/** The point off the coast nearest a place (Pattani's when there is no place). */
export function nearestCoast(place: { lat: number; lon: number } | null | undefined): CoastId {
  if (!place) return "pattani";
  const away = (p: (typeof COAST_POINTS)[number]) =>
    (p.lat - place.lat) ** 2 + ((p.lon - place.lon) * Math.cos((place.lat * Math.PI) / 180)) ** 2;
  return [...COAST_POINTS].sort((a, b) => away(a) - away(b))[0]!.id;
}

export function isCoastId(value: string): value is CoastId {
  return (COAST_IDS as readonly string[]).includes(value);
}

/** The box around the coast points, with a margin, for "show me the sea". */
export function coastBox(): [number, number, number, number] {
  const lons = COAST_POINTS.map((p) => p.lon);
  const lats = COAST_POINTS.map((p) => p.lat);
  return [
    Math.min(...lons) - 0.35,
    Math.min(...lats) - 0.25,
    Math.max(...lons) + 0.2,
    Math.max(...lats) + 0.15,
  ];
}
