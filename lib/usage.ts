/**
 * Who uses Jaga (the owner, 14 Oct): the shapes the admins' usage dashboard draws, how a phone's
 * own description of itself is read, and the small sums behind the dashboard's notes. Pure: no
 * fetching here, so every rule has a test.
 *
 * What is counted and what never is, in short (the migration a13_usage_log has the long form):
 * a random install code made on the phone, never joined to an account; the tambon the person
 * chose in the app; a rough city from the internet address, cut to 0.1 degree; the kind of phone
 * and browser. No GPS, no name, no number, no internet address.
 */

export type Count = { k: string; n: number };

export type TambonCount = {
  code: string;
  nameTh: string;
  nameEn: string;
  province: string;
  lat: number;
  lon: number;
  n: number;
};

export type IpPlace = {
  country: string | null;
  city: string | null;
  lat: number;
  lon: number;
  n: number;
};

export type WatchedTambon = Omit<TambonCount, "n"> & {
  places: number;
  owners: number;
  homes: number;
};

export type DayPoint = {
  day: string;
  devices: number;
  newDevices: number;
  returning: number;
  sessions: number;
  views: number;
  minutes: number;
};

export type TimePoint = { t: string; n: number };

export type UsageData = {
  at: string;
  days: number;
  now: {
    live: number;
    signedIn: number;
    installed: number;
    tambons: TambonCount[];
    noArea: number;
    places: IpPlace[];
    screens: Count[];
    devices: Count[];
  };
  /** Phones on screen in each five minutes of the last three hours. */
  pulse: TimePoint[];
  /** Phones with the app open in each hour of the last two days. */
  hours: TimePoint[];
  today: { devices: number; sessions: number; views: number; newDevices: number; minutes: number };
  series: DayPoint[];
  totals: {
    devicesEver: number;
    sessionsEver: number;
    viewsEver: number;
    minutesEver: number;
    since: string | null;
    devices: number;
    installed: number;
    pushOn: number;
    signedIn: number;
    watching: number;
    withArea: number;
    abroad: number;
    abroadWatching: number;
  };
  rhythm: { dow: number; hour: number; n: number }[];
  mix: {
    device: Count[];
    os: Count[];
    browser: Count[];
    inApp: Count[];
    locale: Count[];
    net: Count[];
    memory: Count[];
    country: Count[];
  };
  screens: { k: string; views: number; devices: number }[];
  entries: Count[];
  areas: TambonCount[];
  ipPlaces: IpPlace[];
  watched: WatchedTambon[];
  engagement: {
    medianSeconds: number | null;
    medianViews: number | null;
    sessionsPerDevice: number | null;
    cohort: number;
    backWithinWeek: number;
    stillAfterWeek: number;
    dau: number | null;
    mau: number;
  };
  speed: {
    fcp50: number | null;
    fcp75: number | null;
    ready50: number | null;
    ready75: number | null;
    measured: number;
  };
  actions: {
    sos: number;
    reports: number;
    accounts: number;
    watchedPlaces: number;
    pushSubs: number;
    lineFollows: number;
  };
  alerts: { at: string; level: string }[];
};

/** The windows the dashboard offers, in days. */
export const USAGE_WINDOWS = [1, 7, 30, 90] as const;
export type UsageWindow = (typeof USAGE_WINDOWS)[number];

export function readWindow(value: unknown): UsageWindow {
  const n = Number(value);
  return (USAGE_WINDOWS as readonly number[]).includes(n) ? (n as UsageWindow) : 7;
}

// ── Reading the database's answer ────────────────────────────────────────────

type Raw = Record<string, unknown>;
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v) || 0);
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const list = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const obj = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});

const counts = (v: unknown): Count[] => list(v).map((r) => ({ k: String(r.k), n: num(r.n) }));
const tambons = (v: unknown): TambonCount[] =>
  list(v).map((r) => ({
    code: String(r.code),
    nameTh: String(r.nameTh ?? ""),
    nameEn: String(r.nameEn ?? ""),
    province: String(r.province ?? ""),
    lat: num(r.lat),
    lon: num(r.lon),
    n: num(r.n),
  }));
const places = (v: unknown): IpPlace[] =>
  list(v).map((r) => ({
    country: str(r.country),
    city: str(r.city),
    lat: num(r.lat),
    lon: num(r.lon),
    n: num(r.n),
  }));
const times = (v: unknown): TimePoint[] => list(v).map((r) => ({ t: String(r.t), n: num(r.n) }));

/** The jsonb from admin_usage() as the dashboard's shape; anything missing reads as nothing. */
export function toUsage(raw: unknown): UsageData {
  const r = obj(raw);
  const now = obj(r.now);
  const today = obj(r.today);
  const totals = obj(r.totals);
  const mix = obj(r.mix);
  const eng = obj(r.engagement);
  const speed = obj(r.speed);
  const actions = obj(r.actions);
  return {
    at: String(r.at ?? new Date(0).toISOString()),
    days: num(r.days) || 7,
    now: {
      live: num(now.live),
      signedIn: num(now.signedIn),
      installed: num(now.installed),
      tambons: tambons(now.tambons),
      noArea: num(now.noArea),
      places: places(now.places),
      screens: counts(now.screens),
      devices: counts(now.devices),
    },
    pulse: times(r.pulse),
    hours: times(r.hours),
    today: {
      devices: num(today.devices),
      sessions: num(today.sessions),
      views: num(today.views),
      newDevices: num(today.newDevices),
      minutes: num(today.minutes),
    },
    series: list(r.series).map((d) => ({
      day: String(d.day),
      devices: num(d.devices),
      newDevices: num(d.newDevices),
      returning: num(d.returning),
      sessions: num(d.sessions),
      views: num(d.views),
      minutes: num(d.minutes),
    })),
    totals: {
      devicesEver: num(totals.devicesEver),
      sessionsEver: num(totals.sessionsEver),
      viewsEver: num(totals.viewsEver),
      minutesEver: num(totals.minutesEver),
      since: str(totals.since),
      devices: num(totals.devices),
      installed: num(totals.installed),
      pushOn: num(totals.pushOn),
      signedIn: num(totals.signedIn),
      watching: num(totals.watching),
      withArea: num(totals.withArea),
      abroad: num(totals.abroad),
      abroadWatching: num(totals.abroadWatching),
    },
    rhythm: list(r.rhythm).map((x) => ({ dow: num(x.dow), hour: num(x.hour), n: num(x.n) })),
    mix: {
      device: counts(mix.device),
      os: counts(mix.os),
      browser: counts(mix.browser),
      inApp: counts(mix.inApp),
      locale: counts(mix.locale),
      net: counts(mix.net),
      memory: counts(mix.memory),
      country: counts(mix.country),
    },
    screens: list(r.screens).map((s) => ({
      k: String(s.k),
      views: num(s.views),
      devices: num(s.devices),
    })),
    entries: counts(r.entries),
    areas: tambons(r.areas),
    ipPlaces: places(r.ipPlaces),
    watched: list(r.watched).map((w) => ({
      code: String(w.code),
      nameTh: String(w.nameTh ?? ""),
      nameEn: String(w.nameEn ?? ""),
      province: String(w.province ?? ""),
      lat: num(w.lat),
      lon: num(w.lon),
      places: num(w.places),
      owners: num(w.owners),
      homes: num(w.homes),
    })),
    engagement: {
      medianSeconds: numOrNull(eng.medianSeconds),
      medianViews: numOrNull(eng.medianViews),
      sessionsPerDevice: numOrNull(eng.sessionsPerDevice),
      cohort: num(eng.cohort),
      backWithinWeek: num(eng.backWithinWeek),
      stillAfterWeek: num(eng.stillAfterWeek),
      dau: numOrNull(eng.dau),
      mau: num(eng.mau),
    },
    speed: {
      fcp50: numOrNull(speed.fcp50),
      fcp75: numOrNull(speed.fcp75),
      ready50: numOrNull(speed.ready50),
      ready75: numOrNull(speed.ready75),
      measured: num(speed.measured),
    },
    actions: {
      sos: num(actions.sos),
      reports: num(actions.reports),
      accounts: num(actions.accounts),
      watchedPlaces: num(actions.watchedPlaces),
      pushSubs: num(actions.pushSubs),
      lineFollows: num(actions.lineFollows),
    },
    alerts: list(r.alerts).map((a) => ({ at: String(a.at), level: String(a.level) })),
  };
}

// ── What a phone says about itself ───────────────────────────────────────────

export type Agent = {
  device: "phone" | "tablet" | "desktop" | "other";
  os: string;
  osMajor: number | null;
  browser: string;
  /** The app whose built-in browser this is (LINE, Facebook...), or null. */
  inApp: string | null;
};

/**
 * The kind of device, system and browser, from the browser's own description. `touchPoints` is
 * the phone's own count: an iPad asking for the desktop site says "Macintosh" and has five.
 */
export function readAgent(ua: string, touchPoints = 0): Agent {
  const s = ua ?? "";
  let os = "other";
  let osMajor: number | null = null;
  const major = (re: RegExp) => {
    const m = s.match(re);
    return m?.[1] ? Number(m[1]) : null;
  };
  const ipad = /iPad/.test(s) || (/Macintosh/.test(s) && touchPoints > 1);
  if (/Android/.test(s)) {
    os = "Android";
    osMajor = major(/Android (\d+)/);
  } else if (ipad) {
    os = "iPadOS";
    osMajor = major(/OS (\d+)_/) ?? major(/Version\/(\d+)/);
  } else if (/iPhone|iPod/.test(s)) {
    os = "iOS";
    osMajor = major(/OS (\d+)_/);
  } else if (/CrOS/.test(s)) os = "ChromeOS";
  else if (/Windows/.test(s)) os = "Windows";
  else if (/Macintosh|Mac OS X/.test(s)) os = "macOS";
  else if (/Linux/.test(s)) os = "Linux";

  let inApp: string | null = null;
  if (/\bLine\//i.test(s)) inApp = "LINE";
  else if (/FBAN|FBAV|FB_IAB/.test(s))
    inApp = /Messenger|FBAN\/Messenger|MESSENGER/i.test(s) ? "Messenger" : "Facebook";
  else if (/Instagram/.test(s)) inApp = "Instagram";
  else if (/TikTok|musical_ly|BytedanceWebview/i.test(s)) inApp = "TikTok";

  let browser = "other";
  if (inApp) browser = inApp;
  else if (/SamsungBrowser/.test(s)) browser = "Samsung Internet";
  else if (/Edg(A|iOS)?\//.test(s)) browser = "Edge";
  else if (/OPR\/|Opera/.test(s)) browser = "Opera";
  else if (/Firefox|FxiOS/.test(s)) browser = "Firefox";
  else if (/CriOS|Chrome\//.test(s)) browser = "Chrome";
  else if (/Safari\//.test(s)) browser = "Safari";

  let device: Agent["device"] = "other";
  if (ipad || /Tablet/.test(s) || (/Android/.test(s) && !/Mobile/.test(s))) device = "tablet";
  else if (/Mobi|iPhone|iPod|Android/.test(s)) device = "phone";
  else if (/Windows|Macintosh|CrOS|Linux|X11/.test(s)) device = "desktop";
  return { device, os, osMajor, browser, inApp };
}

/** A header value Vercel sends URL-encoded (city names with spaces, Thai letters). */
export function headerText(value: string | null, max = 80): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(value).slice(0, max) || null;
  } catch {
    return value.slice(0, max) || null;
  }
}

/** A coordinate from a header, cut to a tenth of a degree, or null. */
export function roughCoordinate(value: string | null, limit: number): number | null {
  if (value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.abs(n) > limit) return null;
  return Math.round(n * 10) / 10;
}

// ── Sums for the dashboard ───────────────────────────────────────────────────

/** Part of a whole as a whole percentage, 0 when there is no whole. */
export function share(part: number, whole: number): number {
  if (!whole || whole <= 0) return 0;
  return Math.round((Math.max(0, part) / whole) * 100);
}

/** One step of the path from "opened" to "keeps watch": how many, and the share of the first. */
export type FunnelStep = { key: string; n: number; share: number };

/**
 * From a phone that opened Jaga to a phone that is ready for a flood: chose its area, added to
 * the home screen, turned notifications on, signed in, watches a place for someone.
 */
export function funnel(totals: UsageData["totals"]): FunnelStep[] {
  const steps: [string, number][] = [
    ["opened", totals.devices],
    ["area", totals.withArea],
    ["installed", totals.installed],
    ["push", totals.pushOn],
    ["signedIn", totals.signedIn],
    ["watching", totals.watching],
  ];
  return steps.map(([key, n]) => ({ key, n, share: share(n, totals.devices) }));
}

/** A 7 x 24 grid (Monday first, Bangkok hours) of how often the app is opened, and its peak. */
export function rhythmGrid(rhythm: UsageData["rhythm"]): {
  cells: number[][];
  max: number;
  peak: { dow: number; hour: number; n: number } | null;
} {
  const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  let peak: { dow: number; hour: number; n: number } | null = null;
  for (const r of rhythm) {
    if (r.dow < 1 || r.dow > 7 || r.hour < 0 || r.hour > 23) continue;
    cells[r.dow - 1]![r.hour] = (cells[r.dow - 1]![r.hour] ?? 0) + r.n;
  }
  let max = 0;
  cells.forEach((row, d) =>
    row.forEach((n, h) => {
      if (n > max) {
        max = n;
        peak = { dow: d + 1, hour: h, n };
      }
    }),
  );
  return { cells, max, peak };
}

/** The step of the five-step teal scale a cell falls on (0 = nothing). */
export function heatStep(n: number, max: number): number {
  if (n <= 0 || max <= 0) return 0;
  return Math.min(5, Math.max(1, Math.ceil((n / max) * 5)));
}

/**
 * What an alert did to the number of people opening Jaga: phones in the hour it went out and the
 * hour after, against the mean of the three hours before. Only for alerts inside the hourly
 * series with three hours before them; `ratio` is null when nobody was there before.
 */
export type AlertLift = {
  at: string;
  level: string;
  before: number;
  after: number;
  ratio: number | null;
};

export function alertLift(hours: TimePoint[], alerts: UsageData["alerts"]): AlertLift[] {
  const index = new Map(hours.map((h, i) => [Date.parse(h.t), i]));
  const out: AlertLift[] = [];
  for (const a of alerts) {
    const at = Date.parse(a.at);
    if (Number.isNaN(at)) continue;
    const hourStart = at - (at % 3_600_000);
    const i = index.get(hourStart);
    if (i === undefined || i < 3) continue;
    const before = (hours[i - 1]!.n + hours[i - 2]!.n + hours[i - 3]!.n) / 3;
    const after = Math.max(hours[i]!.n, hours[i + 1]?.n ?? 0);
    out.push({
      at: a.at,
      level: a.level,
      before: Math.round(before * 10) / 10,
      after,
      ratio: before > 0 ? Math.round((after / before) * 10) / 10 : null,
    });
  }
  return out;
}

/** A note the dashboard raises when a figure says something an admin or developer should act on. */
export type Insight = {
  key: string;
  values: Record<string, string | number>;
  tone: "note" | "good";
};

const sumOf = (list: Count[], keys: string[]) =>
  list.filter((c) => keys.includes(c.k)).reduce((a, c) => a + c.n, 0);
const total = (list: Count[]) => list.reduce((a, c) => a + c.n, 0);

/**
 * The few things worth saying about the window, each with the figure behind it. A rule only
 * speaks when there are enough phones for a share to mean something (MIN_DEVICES).
 */
export const MIN_DEVICES = 10;

export function insights(d: UsageData): Insight[] {
  const out: Insight[] = [];
  const devices = d.totals.devices;
  if (devices < MIN_DEVICES) return out;

  const slow = sumOf(d.mix.net, ["slow-2g", "2g", "3g"]);
  const netKnown = total(d.mix.net.filter((c) => c.k !== "unknown"));
  if (netKnown >= MIN_DEVICES && share(slow, netKnown) >= 20) {
    out.push({ key: "slowNet", values: { share: share(slow, netKnown) }, tone: "note" });
  }
  const lowMemory = sumOf(d.mix.memory, ["le2"]);
  const memKnown = total(d.mix.memory.filter((c) => c.k !== "unknown"));
  if (memKnown >= MIN_DEVICES && share(lowMemory, memKnown) >= 20) {
    out.push({ key: "lowMemory", values: { share: share(lowMemory, memKnown) }, tone: "note" });
  }
  const inApp = total(d.mix.inApp);
  if (share(inApp, devices) >= 15) {
    const top = d.mix.inApp[0]?.k ?? "";
    out.push({ key: "inApp", values: { share: share(inApp, devices), app: top }, tone: "note" });
  }
  const noArea = devices - d.totals.withArea;
  if (share(noArea, devices) >= 30) {
    out.push({ key: "noArea", values: { share: share(noArea, devices) }, tone: "note" });
  }
  if (d.totals.installed > 0 && share(d.totals.pushOn, d.totals.installed) < 50) {
    out.push({
      key: "pushGap",
      values: { share: share(d.totals.installed - d.totals.pushOn, d.totals.installed) },
      tone: "note",
    });
  }
  if (d.totals.abroadWatching > 0) {
    out.push({ key: "abroad", values: { count: d.totals.abroadWatching }, tone: "good" });
  }
  const ms = sumOf(d.mix.locale, ["ms"]);
  if (share(ms, devices) >= 10) {
    out.push({ key: "malay", values: { share: share(ms, devices) }, tone: "note" });
  }
  if (d.speed.measured >= MIN_DEVICES && (d.speed.fcp75 ?? 0) > 3000) {
    out.push({
      key: "slowFirstScreen",
      values: { seconds: secondsText(d.speed.fcp75!) },
      tone: "note",
    });
  }
  if (d.engagement.cohort >= MIN_DEVICES) {
    const back = share(d.engagement.backWithinWeek, d.engagement.cohort);
    out.push({ key: "comeBack", values: { share: back }, tone: back >= 40 ? "good" : "note" });
  }
  const lifts = alertLift(d.hours, d.alerts).filter((l) => (l.ratio ?? 0) >= 2);
  if (lifts.length > 0) {
    const best = lifts.reduce((a, b) => ((b.ratio ?? 0) > (a.ratio ?? 0) ? b : a));
    out.push({ key: "alertLift", values: { ratio: best.ratio ?? 0 }, tone: "good" });
  }
  return out;
}

/** Seconds with one decimal, from milliseconds. */
export function secondsText(ms: number): string {
  return (Math.round(ms / 100) / 10).toFixed(1);
}

/** A duration in whole minutes and seconds, for "a visit lasts about...". */
export function minutesAndSeconds(seconds: number | null): { m: number; s: number } | null {
  if (seconds === null || !Number.isFinite(seconds)) return null;
  const whole = Math.max(0, Math.round(seconds));
  return { m: Math.floor(whole / 60), s: whole % 60 };
}

/** Phones in an average day of the last 30, against phones in those 30 days (0-100). */
export function stickiness(dau: number | null, mau: number): number | null {
  if (dau === null || mau <= 0) return null;
  return share(dau, mau);
}

/** The largest of a list of numbers, at least 1 so a scale never divides by nothing. */
export function scaleMax(values: number[]): number {
  return Math.max(1, ...values);
}
