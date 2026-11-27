/**
 * The free-plan meters of the two services Jaga runs on, and what to do about them (the owner,
 * 27 Nov 2026, after Vercel said the team had used 75% of its Active CPU and Supabase said the
 * project was depleting its Disk IO budget: "I will upgrade, but I want to monitor these two until
 * we are really close to the max").
 *
 * Pure: no database, no clock of its own. The page reads the readings and passes the time in, so a
 * test can hold every rule to a date. The limits are the free plans' published ones as of
 * 24 Oct 2026 (docs/runbook.md); the "upgrade at" lines are the runbook's own triggers.
 *
 * Nothing here publishes or changes anything: it reads numbers an admin typed in (or that the
 * database wrote about itself) and says what they suggest. It is advice, so it is shown with its
 * range and its assumptions (safety rule 8: never present a forecast as certain).
 */

export const PLAN_SERVICES = ["vercel", "supabase"] as const;
export type PlanService = (typeof PLAN_SERVICES)[number];

/**
 * How a meter behaves:
 * - cycle: counts up from nought and resets each billing cycle (Vercel's meters, Supabase's egress)
 * - stock: only ever grows, never resets (the size of the database)
 * - flag: a yes or no, "has the provider warned us" (Supabase's Disk IO budget, which has no
 *   figure an admin can read off, only a warning email and a chart)
 */
export type MeterKind = "cycle" | "stock" | "flag";
export type MeterUnit = "hours" | "gb" | "mb" | "count" | "flag";

export type MeterDef = {
  /** Stored in `plan_readings.meter`, and the key under `plans.meter` in the messages. */
  id: string;
  service: PlanService;
  kind: MeterKind;
  unit: MeterUnit;
  /** The free plan's limit, in `unit`. 0 for a flag. */
  limit: number;
  /** Upgrade when the meter passes this share of its limit (0 to 1). */
  trigger: number;
  /** Where on the provider's own site this number is read, for the "how to read it" line. */
  where: string;
};

export const METERS: readonly MeterDef[] = [
  // Vercel Hobby: the CPU is the tight one (runbook, 24 Oct: 47% before launch).
  {
    id: "active_cpu",
    service: "vercel",
    kind: "cycle",
    unit: "hours",
    limit: 4,
    trigger: 0.75,
    where: "usage",
  },
  {
    id: "transfer",
    service: "vercel",
    kind: "cycle",
    unit: "gb",
    limit: 100,
    trigger: 0.5,
    where: "usage",
  },
  {
    id: "cdn_requests",
    service: "vercel",
    kind: "cycle",
    unit: "count",
    limit: 1_000_000,
    trigger: 0.5,
    where: "usage",
  },
  {
    id: "function_calls",
    service: "vercel",
    kind: "cycle",
    unit: "count",
    limit: 1_000_000,
    trigger: 0.5,
    where: "usage",
  },
  // Supabase Free: 500 MB of database, 5 GB egress a cycle, 1 GB of logs (a limit it marks upcoming).
  {
    id: "db_size",
    service: "supabase",
    kind: "stock",
    unit: "mb",
    limit: 500,
    trigger: 0.6,
    where: "usage",
  },
  {
    id: "egress",
    service: "supabase",
    kind: "cycle",
    unit: "gb",
    limit: 5,
    trigger: 0.5,
    where: "usage",
  },
  {
    id: "log_ingest",
    service: "supabase",
    kind: "cycle",
    unit: "gb",
    limit: 1,
    trigger: 0.5,
    where: "usage",
  },
  {
    id: "disk_io",
    service: "supabase",
    kind: "flag",
    unit: "flag",
    limit: 0,
    trigger: 1,
    where: "reports",
  },
];

/**
 * "We have upgraded": an admin writes yes when a service is on a paid plan, and the page stops
 * warning about it (the free limits no longer apply) and the push stops. One per service, so each
 * has its own id. They are not meters of the free plan, so they are kept out of METERS.
 */
export const UPGRADE_MARKS: readonly MeterDef[] = PLAN_SERVICES.map((service) => ({
  id: `${service}_upgraded`,
  service,
  kind: "flag" as const,
  unit: "flag" as const,
  limit: 0,
  trigger: 1,
  where: "billing",
}));

export function meterDef(id: string): MeterDef | undefined {
  return METERS.find((m) => m.id === id) ?? UPGRADE_MARKS.find((m) => m.id === id);
}

export function metersOf(service: PlanService): MeterDef[] {
  return METERS.filter((m) => m.service === service);
}

/** One number somebody (or the nightly snapshot) wrote down. */
export type PlanReading = {
  id?: number;
  service: PlanService;
  meter: string;
  value: number;
  /** ISO time the number was read. */
  at: string;
  /** For a cycle meter: the date (YYYY-MM-DD) the provider says it resets. */
  resetsOn: string | null;
  note: string | null;
  /** True for the database's own nightly snapshot. */
  auto?: boolean;
};

export type MeterStatus = "none" | "ok" | "watch" | "act";

export type Span = { low: number; high: number };

export type MeterEstimate = {
  def: MeterDef;
  latest: PlanReading | null;
  /** Share of the limit used (0 to 1), null for a flag or no reading. */
  share: number | null;
  /** Days since the latest reading. */
  ageDays: number | null;
  /** A reading older than a week is no longer a reading of "now". */
  stale: boolean;
  /** Use per day: `low` is the average so far, `high` the recent pace with the season's margin. */
  perDay: Span | null;
  /** The days left until the trigger line, then the limit (`low` days = the fast case). */
  triggerOn: DateSpan | null;
  limitOn: DateSpan | null;
  /** Where a cycle meter will stand when it resets, at the two paces, as shares of the limit. */
  endShare: Span | null;
  status: MeterStatus;
};

/** A range of dates; `soonest` is the fast case. `nextCycle` says it falls after the next reset. */
export type DateSpan = { soonest: string; latest: string; nextCycle: boolean };

/** The margin on the recent pace: a flood day brings far more visitors than an ordinary one. */
export const FLOOD_MARGIN = 1.5;
/** The flood season in the four provinces: October to December. */
export function inFloodSeason(now: Date): boolean {
  const month = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", month: "numeric" }).format(now),
  );
  return month >= 10 && month <= 12;
}

export const STALE_DAYS = 7;
const DAY = 86_400_000;

const days = (from: number, to: number) => (to - from) / DAY;

/** The same calendar day one month earlier (a cycle's start, from the date it ends). */
function monthBefore(ymd: string): number {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.getTime();
}

function ymdOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The readings of one meter, newest last, trimmed to the cycle the latest one belongs to: those
 * since the latest reading's cycle began, or, when it names no reset date, since the last time the
 * counter went down (which can only be a reset).
 */
function currentCycle(def: MeterDef, readings: PlanReading[]): PlanReading[] {
  const all = readings
    .filter((r) => r.meter === def.id)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const latest = all.at(-1);
  if (!latest || def.kind !== "cycle") return all;
  if (latest.resetsOn) {
    const start = monthBefore(latest.resetsOn);
    return all.filter((r) => Date.parse(r.at) >= start);
  }
  // A cycle is a month at most, so a reading more than 31 days before the latest belongs to an
  // earlier cycle even if its value happens to be lower.
  const floor = Date.parse(latest.at) - 31 * DAY;
  const recent = all.filter((r) => Date.parse(r.at) >= floor);
  let from = 0;
  for (let i = 1; i < recent.length; i++) if (recent[i]!.value < recent[i - 1]!.value) from = i;
  return recent.slice(from);
}

/** The pace of a meter, per day, as a range, or null when two readings are too close to say. */
function pace(def: MeterDef, series: PlanReading[], now: Date): Span | null {
  const latest = series.at(-1);
  if (!latest) return null;
  const margin = inFloodSeason(now) ? FLOOD_MARGIN : 1;
  let low: number | null = null;
  if (def.kind === "cycle" && latest.resetsOn) {
    // A cycle counter starts at nought on its first day: the average is the value over the days gone.
    const gone = days(monthBefore(latest.resetsOn), Date.parse(latest.at));
    if (gone >= 0.5) low = latest.value / gone;
  }
  const first = series[0]!;
  const span = days(Date.parse(first.at), Date.parse(latest.at));
  if (span >= 1 && series.length >= 2) {
    const slope = (latest.value - first.value) / span;
    low = low ?? slope;
  }
  if (low === null || low <= 0) return null;
  // The recent pace: from the newest reading that is at least a day older than the latest.
  let recent = low;
  for (let i = series.length - 2; i >= 0; i--) {
    const gap = days(Date.parse(series[i]!.at), Date.parse(latest.at));
    if (gap >= 1) {
      recent = Math.max(0, (latest.value - series[i]!.value) / gap);
      break;
    }
  }
  return { low, high: Math.max(low, recent) * margin };
}

/** When `target` is reached at one pace: a date in this cycle, in the next, or never within them. */
function reach(
  def: MeterDef,
  latest: PlanReading,
  target: number,
  perDay: number,
): { at: number; nextCycle: boolean } | null {
  const now = Date.parse(latest.at);
  if (latest.value >= target) return { at: now, nextCycle: false };
  if (perDay <= 0) return null;
  const at = now + ((target - latest.value) / perDay) * DAY;
  if (def.kind !== "cycle" || !latest.resetsOn) return { at, nextCycle: false };
  const resets = Date.parse(`${latest.resetsOn}T00:00:00Z`);
  if (at <= resets) return { at, nextCycle: false };
  // The counter starts again at the reset: the same pace would reach the target this long after it.
  const after = resets + (target / perDay) * DAY;
  const length = resets - monthBefore(latest.resetsOn);
  return after - resets <= length ? { at: after, nextCycle: true } : null;
}

function span(
  def: MeterDef,
  latest: PlanReading,
  target: number,
  perDay: Span | null,
): DateSpan | null {
  if (!perDay)
    return latest.value >= target
      ? {
          soonest: ymdOf(Date.parse(latest.at)),
          latest: ymdOf(Date.parse(latest.at)),
          nextCycle: false,
        }
      : null;
  const fast = reach(def, latest, target, perDay.high);
  const slow = reach(def, latest, target, perDay.low);
  if (!fast) return null;
  return {
    soonest: ymdOf(fast.at),
    latest: slow ? ymdOf(slow.at) : ymdOf(fast.at),
    nextCycle: fast.nextCycle,
  };
}

/** What one meter says now. */
export function estimateMeter(
  def: MeterDef,
  readings: readonly PlanReading[],
  now: Date,
): MeterEstimate {
  const series = currentCycle(def, [...readings]);
  const latest = series.at(-1) ?? null;
  const empty: MeterEstimate = {
    def,
    latest,
    share: null,
    ageDays: null,
    stale: false,
    perDay: null,
    triggerOn: null,
    limitOn: null,
    endShare: null,
    status: "none",
  };
  if (!latest) return empty;
  const ageDays = Math.max(0, days(Date.parse(latest.at), now.getTime()));
  const stale = ageDays > STALE_DAYS;

  if (def.kind === "flag") {
    // A warning from the provider in the last fortnight is a warning still in force.
    const live = latest.value > 0 && ageDays <= 14;
    return { ...empty, ageDays, stale: !live && stale, status: live ? "act" : "ok" };
  }

  const share = latest.value / def.limit;
  const perDay = pace(def, series, now);
  const trigger = def.limit * def.trigger;
  const triggerOn = span(def, latest, trigger, perDay);
  const limitOn = span(def, latest, def.limit, perDay);

  let endShare: Span | null = null;
  if (def.kind === "cycle" && latest.resetsOn && perDay) {
    const left = Math.max(0, days(now.getTime(), Date.parse(`${latest.resetsOn}T00:00:00Z`)));
    endShare = {
      low: (latest.value + perDay.low * left) / def.limit,
      high: (latest.value + perDay.high * left) / def.limit,
    };
  }

  let status: MeterStatus = "ok";
  const horizon = (s: DateSpan | null, within: number) =>
    !!s && !s.nextCycle && days(now.getTime(), Date.parse(`${s.soonest}T00:00:00Z`)) <= within;
  if (share >= def.trigger || (endShare && endShare.high >= def.trigger)) {
    status = share >= def.trigger || endShare!.high >= 1 ? "act" : "watch";
  } else if (share >= def.trigger * 0.7 || horizon(triggerOn, def.kind === "stock" ? 60 : 14)) {
    status = "watch";
  }
  // A stock meter that will reach its trigger within a month is no longer "watch".
  if (def.kind === "stock" && horizon(triggerOn, 30)) status = "act";
  return { def, latest, share, ageDays, stale, perDay, triggerOn, limitOn, endShare, status };
}

/** "done": an admin has marked the service as upgraded, so there is nothing left to advise. */
export type Verdict = "now" | "soon" | "later" | "done";

export type Advice = {
  service: PlanService;
  verdict: Verdict;
  meters: MeterEstimate[];
  /** The meters that decided it, worst first. */
  because: MeterEstimate[];
  /** The earliest the upgrade is due: the soonest trigger date of any meter, and the latest-case one. */
  upgradeBy: DateSpan | null;
  /** The earliest the service could stop: the same, for the limits. */
  pausesOn: DateSpan | null;
  floodSeason: boolean;
  /** The day (YYYY-MM-DD) an admin marked it upgraded, when the verdict is "done". */
  upgradedOn: string | null;
  /** True when no meter has a fresh reading: the verdict is then a guess and says so. */
  blind: boolean;
};

const rank: Record<MeterStatus, number> = { none: 0, ok: 1, watch: 2, act: 3 };

function earliest(spans: (DateSpan | null)[]): DateSpan | null {
  const live = spans.filter((s): s is DateSpan => !!s);
  if (live.length === 0) return null;
  const soonest = live.map((s) => s.soonest).sort()[0]!;
  const latest = live.map((s) => s.latest).sort()[0]!;
  return {
    soonest,
    latest: latest < soonest ? soonest : latest,
    nextCycle: live.every((s) => s.nextCycle),
  };
}

/**
 * The advice for one service. "now" when any meter is at its upgrade line or on course to hit its
 * limit before it resets; "soon" when one is getting there, or the flood season is on and any meter
 * is past half; otherwise "later". A flag (the provider's own warning) counts as an upgrade line.
 */
export function adviseService(
  service: PlanService,
  readings: readonly PlanReading[],
  now: Date,
): Advice {
  const meters = metersOf(service).map((d) =>
    estimateMeter(
      d,
      readings.filter((r) => r.service === service),
      now,
    ),
  );
  const floodSeason = inFloodSeason(now);
  const mark = readings
    .filter((r) => r.service === service && r.meter === `${service}_upgraded`)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .at(-1);
  const upgradedOn = mark && mark.value > 0 ? mark.at.slice(0, 10) : null;
  const worst = Math.max(0, ...meters.map((m) => rank[m.status]));
  const halfway = meters.some((m) => m.share !== null && m.share >= 0.5);
  let verdict: Verdict = "later";
  if (upgradedOn) verdict = "done";
  else if (worst >= rank.act) verdict = "now";
  else if (worst >= rank.watch || (floodSeason && halfway)) verdict = "soon";
  const because = meters
    .filter((m) => m.status === "watch" || m.status === "act")
    .sort((a, b) => rank[b.status] - rank[a.status] || (b.share ?? 0) - (a.share ?? 0));
  const live = meters.filter((m) => m.latest && !m.stale);
  return {
    service,
    verdict,
    meters,
    because,
    upgradeBy: earliest(meters.map((m) => m.triggerOn)),
    pausesOn: earliest(meters.map((m) => m.limitOn)),
    floodSeason,
    upgradedOn,
    blind: live.length === 0,
  };
}

/** How long one push stays the only one for an episode that has not ended. */
export const PUSH_EVERY_DAYS = 2;

/**
 * The name of one episode of "upgrade now", for the push to the super admin: the meters at the
 * line and which two-day window it is. The same signature means "already told"; a new meter at
 * the line, or two more days of nobody acting, makes a new one. Null when nothing needs a push.
 */
export function pushSignature(advice: Advice, now: Date): string | null {
  if (advice.verdict !== "now") return null;
  const meters = advice.because
    .map((m) => m.def.id)
    .sort()
    .join("+");
  const window = Math.floor(now.getTime() / (PUSH_EVERY_DAYS * DAY));
  return `${meters || "now"}:${window}`;
}

/**
 * A figure as a person reads it: hours under one as minutes, gigabytes under one as megabytes,
 * counts as 192k or 1.2M. Plain Western digits and unit letters in every language.
 */
export function formatAmount(unit: MeterUnit, value: number): string {
  const round = (v: number, d: number) => String(Number(v.toFixed(d)));
  if (unit === "hours") {
    if (value < 1) return `${Math.round(value * 60)} m`;
    let h = Math.floor(value);
    let m = Math.round((value - h) * 60);
    if (m === 60) {
      h += 1;
      m = 0;
    }
    return m === 0 ? `${h} h` : `${h} h ${m} m`;
  }
  if (unit === "gb") {
    return value < 1 ? `${Math.round(value * 1000)} MB` : `${round(value, value >= 10 ? 1 : 2)} GB`;
  }
  if (unit === "mb") return `${round(value, value >= 10 ? 0 : 1)} MB`;
  if (unit === "count") {
    if (value >= 1_000_000) return `${round(value / 1_000_000, 2)}M`;
    if (value >= 1_000) return `${round(value / 1_000, value >= 100_000 ? 0 : 1)}k`;
    return String(Math.round(value));
  }
  return String(value);
}

/**
 * What an admin types from a provider's page: "3h 12m", "3:12" or "3.2" for hours; "192k" or
 * "1.2M" for a count; "3.6 GB" or "800 MB" for a size. Null when it is not a number.
 */
export function parseAmount(text: string, unit: MeterUnit): number | null {
  const s = text.trim().toLowerCase().replace(/,/g, ".").replace(/\s+/g, " ");
  if (!s) return null;
  if (unit === "flag") return s === "1" || s === "yes" ? 1 : s === "0" || s === "no" ? 0 : null;
  if (unit === "hours") {
    const hm = /^(\d+(?:\.\d+)?)\s*h(?:ours?)?\s*(?:(\d+)\s*m(?:in)?)?$/.exec(s);
    if (hm) return Number(hm[1]) + Number(hm[2] ?? 0) / 60;
    const colon = /^(\d+):(\d{1,2})$/.exec(s);
    if (colon) return Number(colon[1]) + Number(colon[2]) / 60;
    const mins = /^(\d+(?:\.\d+)?)\s*m(?:in)?$/.exec(s);
    if (mins) return Number(mins[1]) / 60;
  }
  const m = /^(\d+(?:\.\d+)?)\s*([a-z]*)$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  const suffix = m[2]!;
  if (unit === "count") {
    if (suffix === "") return n;
    if (suffix === "k") return n * 1_000;
    if (suffix === "m") return n * 1_000_000;
    return null;
  }
  if (unit === "gb") {
    if (suffix === "" || suffix === "gb") return n;
    if (suffix === "mb") return n / 1000;
    if (suffix === "tb") return n * 1000;
    return null;
  }
  if (unit === "mb") {
    if (suffix === "" || suffix === "mb") return n;
    if (suffix === "gb") return n * 1000;
    if (suffix === "kb") return n / 1000;
    return null;
  }
  if (unit === "hours") return suffix === "" || suffix === "h" ? n : null;
  return null;
}
