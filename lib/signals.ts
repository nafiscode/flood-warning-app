/**
 * The admins' signal dashboard (spec 6.3, A8): what the gauges, the rain, the modelled discharge
 * and the tide say for each warning zone, and a *suggested* level with the reasons behind it.
 *
 * Pure: no database, no clock of its own. The suggestion is advice to a person. Nothing in the
 * app publishes an alert from it (safety rule 2), and every figure carries its own time, because
 * the feeds lag by hours and a stale reading must never pass for the river as it is now
 * (safety rules 3 and 8).
 */

export type Point = [at: number, value: number];
export type Level = "watch" | "warning" | "evacuate";
export const LEVELS: Level[] = ["watch", "warning", "evacuate"];
export type SignalKey =
  "rain_72h_mm" | "rain_24h_mm" | "rain_72h_forecast_mm" | "key_level_m" | "upstream_level_m";
export const SIGNAL_KEYS: SignalKey[] = [
  "rain_72h_mm",
  "rain_24h_mm",
  "rain_72h_forecast_mm",
  "key_level_m",
  "upstream_level_m",
];

export type Threshold = {
  signal: SignalKey;
  levels: Partial<Record<Level, number>>;
  provisional: boolean;
  updatedAt: number | null;
};

export type Gauge = {
  id?: string;
  /** Set to the automated alarm (the owner's decision of 14 Oct 2026). */
  auto?: boolean;
  code: string;
  thaiwaterId: number | null;
  name: Record<string, string | null>;
  agency: string | null;
  bank: number | null;
  watch: number | null;
  series: Point[];
  /** The gauge's own three levels (gauge_levels), when the database holds them. */
  levels?: GaugeLevels | null;
  /** How fast its past floods fell back (gauge_recession, science plan Module 5). */
  recession?: Recession | null;
};

/** Hours from a flood's peak to staying below a line, over the gauge's past floods. */
export type Spread = { p25: number; p50: number; p75: number };

/** One gauge's record of past floods falling back (science plan Module 5, 15 Oct 2026). */
export type Recession = {
  events: number;
  overBank: number;
  censored: number;
  /** Peak to below the bank, floods that went over it. */
  toBank: Spread | null;
  /** Peak to below Warning, floods that went over the bank: the figure to read after an Evacuate. */
  toWarningOverBank: Spread | null;
  /** Peak to below Warning, every flood that reached Warning. */
  toWarning: Spread | null;
  firstSeason: number | null;
  lastSeason: number | null;
  tidal: boolean;
  lake: boolean;
  bankSuspect: boolean;
  usable: boolean;
};

function spread(p25: unknown, p50: unknown, p75: unknown): Spread | null {
  const [a, b, c] = [numberOrNull(p25), numberOrNull(p50), numberOrNull(p75)];
  return a === null || b === null || c === null ? null : { p25: a, p50: b, p75: c };
}

/** `admin_gauge_recession()` rows, joined onto every gauge by station id. */
export function withRecession(data: Signals, rows: unknown): Signals {
  if (!Array.isArray(rows)) return data;
  const byId = new Map<string, Recession>();
  for (const r of rows as Row[]) {
    const m = (r.method ?? {}) as Row;
    const flags = (m.flags ?? {}) as Row;
    const ob = (m.to_warning_h_over_bank ?? {}) as Row;
    byId.set(String(r.station_id), {
      events: numberOrNull(r.events) ?? 0,
      overBank: numberOrNull(m.over_bank) ?? 0,
      censored: numberOrNull(r.censored) ?? 0,
      toBank: spread(r.to_bank_h_p25, r.to_bank_h_p50, r.to_bank_h_p75),
      toWarningOverBank: spread(ob.p25, ob.p50, ob.p75),
      toWarning: spread(r.to_warning_h_p25, r.to_warning_h_p50, r.to_warning_h_p75),
      firstSeason: numberOrNull(r.first_season),
      lastSeason: numberOrNull(r.last_season),
      tidal: flags.tidal === true,
      lake: flags.lake === true,
      bankSuspect: flags.bank_suspect === true,
      usable: m.usable === true,
    });
  }
  const put = <G extends Gauge>(g: G): G => ({
    ...g,
    recession: (g.id && byId.get(g.id)) || null,
  });
  return {
    ...data,
    zones: data.zones.map((z) => ({
      ...z,
      key: z.key ? put(z.key) : null,
      upstream: z.upstream ? put(z.upstream) : null,
      others: z.others.map(put),
    })),
    allGauges: data.allGauges?.map(put),
  };
}

/**
 * A duration the way an admin writes a return window: whole hours under two days, then days to the
 * nearest half (the range is widened outward, so a window is never narrower than the record).
 */
export function returnSpan(
  hours: number,
  side: "low" | "high" | "mid" = "mid",
): {
  unit: "hours" | "days";
  value: number;
} {
  if (hours < 48) {
    const v =
      side === "low" ? Math.floor(hours) : side === "high" ? Math.ceil(hours) : Math.round(hours);
    return { unit: "hours", value: Math.max(0, v) };
  }
  const halves = hours / 12;
  const v =
    side === "low" ? Math.floor(halves) : side === "high" ? Math.ceil(halves) : Math.round(halves);
  return { unit: "days", value: v / 2 };
}

export type Zone = {
  id: string;
  basin: string;
  name: Record<string, string>;
  key: Gauge | null;
  upstream: Gauge | null;
  others: Gauge[];
  thresholds: Threshold[];
  /** Hourly basin rain from a weather model: hours behind `now` are its analysis, ahead its forecast. */
  rain: Point[];
  /** The wettest of five weather models each hour (the forecast rule, 14 Oct 2026). */
  rainWettest?: Point[];
  discharge: Point[];
  tide: Point[];
  forecastIssuedAt: number | null;
  tambonCount?: number;
  outline?: GeoJSON.Geometry | null;
};

/** A gauge on the map of all gauges: where it is and which zone holds it. */
export type MapGauge = Gauge & {
  lon: number;
  lat: number;
  zoneId: string | null;
};

/** Watch, Warning and Evacuate for one gauge, suggested by the pipeline or set by an admin. */
export type GaugeLevels = {
  watch: number | null;
  warning: number | null;
  evacuate: number | null;
  provisional: boolean;
  how: string | null;
  floods: number | null;
  bankSuspect: boolean;
  neverReachedBank: boolean;
  note: string | null;
};

/** `admin_gauge_levels()` rows, joined onto every gauge (the map's and the zones') by station id. */
export function withGaugeLevels(data: Signals, rows: unknown): Signals {
  if (!Array.isArray(rows)) return data;
  const byId = new Map<string, GaugeLevels>();
  for (const r of rows as Row[]) {
    const m = (r.method ?? {}) as Row;
    byId.set(String(r.station_id), {
      watch: numberOrNull(r.watch_m),
      warning: numberOrNull(r.warning_m),
      evacuate: numberOrNull(r.evacuate_m),
      provisional: r.provisional !== false,
      how: typeof m.how === "string" ? m.how : null,
      floods: numberOrNull(m.floods),
      bankSuspect: m.bank_suspect === true,
      neverReachedBank: m.never_reached_bank === true,
      note: typeof m.note === "string" ? m.note : null,
    });
  }
  const put = <G extends Gauge>(g: G): G => ({ ...g, levels: (g.id && byId.get(g.id)) || null });
  return {
    ...data,
    zones: data.zones.map((z) => ({
      ...z,
      key: z.key ? put(z.key) : null,
      upstream: z.upstream ? put(z.upstream) : null,
      others: z.others.map(put),
    })),
    allGauges: data.allGauges?.map(put),
  };
}

export type AutoSettings = { graceMinutes: number; maxAgeH: number; mode: "drill" | "real" };
export type AutoEvent = {
  id: string;
  zoneId: string;
  gauge: string | null;
  level: "warning" | "evacuate";
  value: number;
  threshold: number;
  observedAt: number | null;
  createdAt: number | null;
  deadline: number | null;
  status: "pending" | "sent" | "dismissed" | "auto_published" | "lapsed" | "replaced";
  alertId: string | null;
};

export type Feed = { at: number; ok: boolean; error: string | null } | null;
export type Signals = {
  now: number;
  zones: Zone[];
  feeds: { gauges: Feed; signals: Feed };
  auto?: AutoSettings;
  events?: AutoEvent[];
  allGauges?: MapGauge[];
};

const HOUR = 3_600_000;
/** A gauge silent for longer than this cannot speak for the river as it is now. */
export const GAUGE_STALE_H = 6;
/** The forecast is fetched hourly; older than this, the fetch has been failing. */
export const FORECAST_STALE_H = 3;

type Row = Record<string, unknown>;
const time = (v: unknown): number | null => {
  const t = typeof v === "string" || typeof v === "number" ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : null;
};
const points = (v: unknown): Point[] =>
  (Array.isArray(v) ? v : [])
    .map((p): Point | null => {
      const t = Array.isArray(p) ? time(p[0]) : null;
      const x = Array.isArray(p) && p[1] !== null && p[1] !== "" ? Number(p[1]) : NaN;
      return t !== null && Number.isFinite(x) ? [t, x] : null;
    })
    .filter((p): p is Point => p !== null)
    .sort((a, b) => a[0] - b[0]);
const numberOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function toGauge(row: Row): Gauge {
  return {
    id: typeof row.id === "string" ? row.id : undefined,
    auto: row.auto === true,
    code: String(row.code ?? ""),
    thaiwaterId: numberOrNull(row.thaiwaterId),
    name: (row.name ?? {}) as Gauge["name"],
    agency: typeof row.agency === "string" ? row.agency : null,
    bank: numberOrNull(row.bank),
    watch: numberOrNull(row.watch),
    series: points(row.series),
  };
}

function toFeed(v: unknown): Feed {
  const row = (v ?? null) as Row | null;
  const at = row ? time(row.at) : null;
  return row && at !== null
    ? { at, ok: row.ok === true, error: typeof row.error === "string" ? row.error : null }
    : null;
}

/** The database's answer (`admin_signals`), made safe to draw. */
export function toSignals(raw: unknown): Signals {
  const data = (raw ?? {}) as Row;
  const zones = (Array.isArray(data.zones) ? data.zones : []).map((z: Row): Zone => {
    const gauges = (Array.isArray(z.gauges) ? z.gauges : []).map((g) => toGauge(g as Row));
    const roles = (z.roles ?? {}) as Row;
    const key = gauges.find((g) => g.thaiwaterId !== null && g.thaiwaterId === roles.key) ?? null;
    const upstream =
      gauges.find((g) => g.thaiwaterId !== null && g.thaiwaterId === roles.upstream) ?? null;
    return {
      id: String(z.id ?? ""),
      basin: String(z.basin ?? ""),
      name: (z.name ?? {}) as Zone["name"],
      key,
      upstream,
      others: gauges.filter((g) => g !== key && g !== upstream),
      thresholds: (Array.isArray(z.thresholds) ? z.thresholds : [])
        .map((t: Row): Threshold | null => {
          const signal = SIGNAL_KEYS.find((k) => k === t.signal);
          if (!signal) return null;
          const levels: Threshold["levels"] = {};
          for (const level of LEVELS) {
            const v = numberOrNull(((t.levels ?? {}) as Row)[level]);
            if (v !== null) levels[level] = v;
          }
          return {
            signal,
            levels,
            provisional: t.provisional !== false,
            updatedAt: time(t.updatedAt),
          };
        })
        .filter((t): t is Threshold => t !== null),
      rain: points(z.rain),
      discharge: points(z.discharge),
      tide: points(z.tide),
      forecastIssuedAt: time(z.issuedAt),
      tambonCount: numberOrNull(z.tambons) ?? 0,
      outline: (z.outline ?? null) as GeoJSON.Geometry | null,
    };
  });
  const auto = (data.auto ?? {}) as Row;
  const events = (Array.isArray(data.events) ? data.events : []).map((e: Row): AutoEvent => ({
    id: String(e.id ?? ""),
    zoneId: String(e.zoneId ?? ""),
    gauge: typeof e.gauge === "string" ? e.gauge : null,
    level: e.level === "evacuate" ? "evacuate" : "warning",
    value: Number(e.value ?? 0),
    threshold: Number(e.threshold ?? 0),
    observedAt: time(e.observedAt),
    createdAt: time(e.createdAt),
    deadline: time(e.deadline),
    status:
      (["pending", "sent", "dismissed", "auto_published", "lapsed", "replaced"] as const).find(
        (x) => x === e.status,
      ) ?? "lapsed",
    alertId: typeof e.alertId === "string" ? e.alertId : null,
  }));
  const allGauges = (Array.isArray(data.allGauges) ? data.allGauges : [])
    .map((g: Row): MapGauge | null => {
      const lon = Number(g.lon);
      const lat = Number(g.lat);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      return { ...toGauge(g), lon, lat, zoneId: typeof g.zoneId === "string" ? g.zoneId : null };
    })
    .filter((g): g is MapGauge => g !== null);
  return {
    now: time(data.now) ?? 0,
    zones,
    auto: {
      graceMinutes: numberOrNull(auto.grace_minutes) ?? 20,
      maxAgeH: numberOrNull(auto.max_age_h) ?? 3,
      mode: auto.mode === "real" ? "real" : "drill",
    },
    events,
    allGauges,
    feeds: {
      gauges: toFeed((data.feeds as Row | undefined)?.gauges),
      signals: toFeed((data.feeds as Row | undefined)?.signals),
    },
  };
}

export type GaugeNow = {
  value: number;
  at: number;
  ageH: number;
  stale: boolean;
  /** Change over about six hours, when a reading that old exists. */
  riseM: number | null;
  belowBankM: number | null;
};

export function gaugeNow(gauge: Gauge | null, now: number): GaugeNow | null {
  const last = gauge?.series.at(-1);
  if (!gauge || !last) return null;
  const [at, value] = last;
  const before = gauge.series.filter(([t]) => t <= at - 5 * HOUR && t >= at - 8 * HOUR).at(-1);
  const ageH = Math.max(0, (now - at) / HOUR);
  return {
    value,
    at,
    ageH,
    stale: ageH > GAUGE_STALE_H,
    riseM: before ? value - before[1] : null,
    belowBankM: gauge.bank === null ? null : gauge.bank - value,
  };
}

/** Sum of the hours in (from, to]. */
export function rainBetween(rain: Point[], from: number, to: number): number {
  let sum = 0;
  for (const [t, mm] of rain) if (t > from && t <= to) sum += mm;
  return sum;
}

export type RainNow = {
  past24: number;
  past72: number;
  next24: number;
  /** The largest 72-hour total the forecast holds in the next three days, and when it ends. */
  peak72: number;
  peak72At: number | null;
  hasPast: boolean;
  hasForecast: boolean;
};

export function rainNow(rain: Point[], now: number): RainNow {
  let peak72 = 0;
  let peak72At: number | null = null;
  for (const [t] of rain) {
    if (t <= now || t > now + 72 * HOUR) continue;
    const total = rainBetween(rain, t - 72 * HOUR, t);
    if (total > peak72) {
      peak72 = total;
      peak72At = t;
    }
  }
  return {
    past24: rainBetween(rain, now - 24 * HOUR, now),
    past72: rainBetween(rain, now - 72 * HOUR, now),
    next24: rainBetween(rain, now, now + 24 * HOUR),
    peak72,
    peak72At,
    hasPast: rain.some(([t]) => t <= now && t > now - 72 * HOUR),
    hasForecast: rain.some(([t]) => t > now),
  };
}

export type ReasonKind =
  | "keyAtBank"
  | "keyNearBank"
  | "keyAtWatch"
  | "upstreamOverBank"
  | "rain72"
  | "rain72Forecast"
  | "rain24"
  | "rain24Forecast"
  | "rain72Wettest";

export type Reason = {
  kind: ReasonKind;
  level: Level;
  value: number;
  threshold: number;
  at: number | null;
};

export type Suggestion = {
  /** The highest level any reason gives; null when nothing reaches a threshold. */
  level: Level | null;
  reasons: Reason[];
  /** Why the suggestion may be missing something: what could not be judged. */
  blind: ("keyGaugeStale" | "keyGaugeMissing" | "rainMissing" | "forecastStale" | "noThresholds")[];
};

const rank = (level: Level | null) => (level === null ? -1 : LEVELS.indexOf(level));

export function thresholdOf(zone: Zone, signal: SignalKey, level: Level): number | null {
  return zone.thresholds.find((t) => t.signal === signal)?.levels[level] ?? null;
}

/**
 * What the figures suggest. Each rule is one a person can check against the charts:
 *
 *   - the key gauge at or over its Evacuate level (its bank): Evacuate;
 *   - the key gauge at or over its Warning level, or the upstream gauge over its own bank: Warning;
 *   - rain over the basin in the last 24 or 72 hours at or over its threshold: that threshold's level;
 *   - the same totals reached only in the forecast: never more than Watch, because a forecast is
 *     not an observation.
 *
 * A stale gauge gives no reason at all, in either direction, and is named under `blind`.
 */
export function suggest(zone: Zone, now: number): Suggestion {
  const reasons: Reason[] = [];
  const blind: Suggestion["blind"] = [];
  if (zone.thresholds.length === 0) blind.push("noThresholds");

  const key = gaugeNow(zone.key, now);
  if (!key) blind.push("keyGaugeMissing");
  else if (key.stale) blind.push("keyGaugeStale");
  else {
    const evacuate = thresholdOf(zone, "key_level_m", "evacuate");
    const warning = thresholdOf(zone, "key_level_m", "warning");
    if (evacuate !== null && key.value >= evacuate)
      reasons.push({
        kind: "keyAtBank",
        level: "evacuate",
        value: key.value,
        threshold: evacuate,
        at: key.at,
      });
    else if (warning !== null && key.value >= warning)
      reasons.push({
        kind: "keyNearBank",
        level: "warning",
        value: key.value,
        threshold: warning,
        at: key.at,
      });
    else {
      const watch = thresholdOf(zone, "key_level_m", "watch");
      if (watch !== null && key.value >= watch)
        reasons.push({
          kind: "keyAtWatch",
          level: "watch",
          value: key.value,
          threshold: watch,
          at: key.at,
        });
    }
  }

  const up = gaugeNow(zone.upstream, now);
  const upLimit = thresholdOf(zone, "upstream_level_m", "warning") ?? zone.upstream?.bank ?? null;
  if (up && !up.stale && upLimit !== null && up.value >= upLimit)
    reasons.push({
      kind: "upstreamOverBank",
      level: "warning",
      value: up.value,
      threshold: upLimit,
      at: up.at,
    });

  const rain = rainNow(zone.rain, now);
  if (!rain.hasPast) blind.push("rainMissing");
  if (zone.forecastIssuedAt === null || now - zone.forecastIssuedAt > FORECAST_STALE_H * HOUR)
    blind.push("forecastStale");
  const forecastWatch = thresholdOf(zone, "rain_72h_forecast_mm", "watch");
  const wettest = zone.rainWettest ?? [];
  if (forecastWatch !== null && wettest.some(([t]) => t > now)) {
    const next72 = rainBetween(wettest, now, now + 72 * HOUR);
    if (next72 >= forecastWatch)
      reasons.push({
        kind: "rain72Wettest",
        level: "watch",
        value: next72,
        threshold: forecastWatch,
        at: now + 72 * HOUR,
      });
  }
  for (const [signal, past, ahead, kinds] of [
    ["rain_72h_mm", rain.past72, rain.peak72, ["rain72", "rain72Forecast"]],
    ["rain_24h_mm", rain.past24, rain.next24, ["rain24", "rain24Forecast"]],
  ] as const) {
    const levels = zone.thresholds.find((t) => t.signal === signal)?.levels ?? {};
    const reached = [...LEVELS]
      .reverse()
      .find((l) => levels[l] !== undefined && past >= levels[l]!);
    if (reached && rain.hasPast) {
      reasons.push({
        kind: kinds[0],
        level: reached,
        value: past,
        threshold: levels[reached]!,
        at: now,
      });
    } else if (rain.hasForecast && !(signal === "rain_72h_mm" && forecastWatch !== null)) {
      // The 72-hour forecast has its own rule above once its threshold exists.
      const lowest = LEVELS.find((l) => levels[l] !== undefined);
      if (lowest && ahead >= levels[lowest]!)
        reasons.push({
          kind: kinds[1],
          level: "watch",
          value: ahead,
          threshold: levels[lowest]!,
          at: signal === "rain_72h_mm" ? rain.peak72At : now + 24 * HOUR,
        });
    }
  }

  reasons.sort((a, b) => rank(b.level) - rank(a.level));
  return { level: reasons[0]?.level ?? null, reasons, blind };
}

/** Axis range that holds every value and every reference line, with a little room. */
export function span(values: number[], pad = 0.08): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [0, 1];
  const lo = Math.min(...finite);
  const hi = Math.max(...finite);
  const room = Math.max((hi - lo) * pad, 0.05);
  return [lo - room, hi + room];
}

/** An SVG path through the points, broken where two readings are more than `gapH` hours apart. */
export function linePath(
  series: Point[],
  x: (t: number) => number,
  y: (v: number) => number,
  gapH = 4,
): string {
  let d = "";
  let prev: number | null = null;
  for (const [t, v] of series) {
    d += `${prev === null || t - prev > gapH * HOUR ? "M" : "L"}${x(t).toFixed(1)} ${y(v).toFixed(1)}`;
    prev = t;
  }
  return d;
}

/**
 * Where one gauge stands, for the map's colour and its words. A zone's key gauge is measured
 * against that zone's Warning and Evacuate levels; any other gauge against its own bank. Silent
 * for six hours: `stale`, whatever it last read.
 */
export type GaugeState = "evacuate" | "warning" | "near" | "normal" | "stale" | "nolevels";
export const GAUGE_STATES: GaugeState[] = [
  "evacuate",
  "warning",
  "near",
  "normal",
  "stale",
  "nolevels",
];

export function gaugeState(
  gauge: Gauge,
  now: number,
  levels?: Partial<Record<Level, number | null>>,
): GaugeState {
  const st = gaugeNow(gauge, now);
  if (!st || st.stale) return "stale";
  const own = levels ?? {};
  // Without levels of its own, a gauge is measured against its bank as before: Warning at the
  // bank, "near" half a metre below it.
  const evacuate = own.evacuate ?? null;
  const warning = own.warning ?? (own.evacuate == null ? gauge.bank : null);
  const watch = own.watch ?? (gauge.bank !== null ? gauge.bank - 0.5 : null);
  if (evacuate === null && warning === null && watch === null) return "nolevels";
  if (evacuate !== null && st.value >= evacuate) return "evacuate";
  if (warning !== null && st.value >= warning) return "warning";
  if (watch !== null && st.value >= watch) return "near";
  return "normal";
}

/**
 * The levels a map gauge is measured against: its own (gauge_levels), with a zone's key gauge
 * taking its zone's Warning and Evacuate, which are the same numbers once an admin has set them.
 */
export function mapLevels(gauge: MapGauge, zones: Zone[]): Partial<Record<Level, number | null>> {
  const own = gauge.levels;
  const key = keyLevelsFor(gauge, zones);
  return {
    watch: own?.watch ?? null,
    warning: key?.warning ?? own?.warning ?? null,
    evacuate: key?.evacuate ?? own?.evacuate ?? null,
  };
}

/** The key gauge's levels for a map gauge, when it is one. */
export function keyLevelsFor(
  gauge: MapGauge,
  zones: Zone[],
): Partial<Record<Level, number>> | undefined {
  const zone = zones.find(
    (z) => z.key && gauge.thaiwaterId !== null && z.key.thaiwaterId === gauge.thaiwaterId,
  );
  return zone?.thresholds.find((t) => t.signal === "key_level_m")?.levels;
}

/** `admin_signal_wettest()`: { zone id: [[time, mm], ...] }, joined onto the zones. */
export function withWettest(data: Signals, raw: unknown): Signals {
  if (!raw || typeof raw !== "object") return data;
  const byZone = raw as Record<string, unknown>;
  return {
    ...data,
    zones: data.zones.map((z) => {
      const rows = byZone[z.id];
      if (!Array.isArray(rows)) return z;
      const series: Point[] = [];
      for (const r of rows) {
        if (!Array.isArray(r)) continue;
        const t = Date.parse(String(r[0]));
        const v = Number(r[1]);
        if (Number.isFinite(t) && Number.isFinite(v)) series.push([t, v]);
      }
      return { ...z, rainWettest: series.sort((a, b) => a[0] - b[0]) };
    }),
  };
}
