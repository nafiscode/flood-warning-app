import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * SITREP for a verified unit (owner, 18 Nov 2026): the situation report a team or an agency can
 * print, file, or hand to a district officer at a meeting.
 *
 * Jaga's consoles are live screens. A SITREP is the opposite: one page, frozen at a stated moment,
 * that answers "what is happening in our area, and what have we done about it" for somebody who
 * was not looking at the screen. That is what gets read out at the 08:00 meeting and attached to
 * the memo asking for boats.
 *
 * Four rules govern every line of this file:
 *
 *   1. **Counts only, never a person** (safety rules 5 and 6). No point, no phone, no name, no
 *      requester's words, no photo, no team position. The database function decides this, not the
 *      page - but it matters most here, because a SITREP is forwarded by design: it goes to the
 *      district office, into a group chat, onto a projector. Anything personal in it would travel
 *      exactly as far. That is the whole reason the owner's answer was "counts only".
 *   2. **It is not an alert** (safety rule 2). It reports the alerts that a person published and
 *      what the rivers read; it cannot raise a level, suggest one, or notify anybody.
 *   3. **It is never certain** (safety rule 8). Resident reports are what people said, not a
 *      survey; gauge readings carry their own observation time; the period is stated at the top of
 *      every page and every file. `LIMITS` is rendered with the report and a test holds it there.
 *   4. **Stale is a marker, never a lower level** (safety rule 3). An alert past its next-update
 *      time keeps its level in the report and gains the "not updated since" marker, exactly as it
 *      does on a resident's screen.
 */

/** Bangkok is UTC+7 with no daylight saving, which is why this arithmetic is allowed to be plain. */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

/** The cut-offs a twice-daily SITREP is written to, in Bangkok hours. */
export const CUT_OFF_HOURS = [6, 18] as const;

/** The longest period one report may cover; the database refuses more. */
export const MAX_DAYS = 7;

export type Period = { from: Date; to: Date; cutOff: boolean };

/**
 * The period a report covers by default: the 24 hours ending at the last 06:00 or 18:00 Bangkok
 * cut-off that has passed.
 *
 * Why a cut-off and not simply "the last 24 hours": two units reporting the same flood should be
 * reporting the same hours, or the numbers cannot be added up at the district office. A rolling
 * window makes every copy of the report incomparable with every other.
 */
export function defaultPeriod(now: Date = new Date()): Period {
  const bangkok = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  const hour = bangkok.getUTCHours();
  const latest = [...CUT_OFF_HOURS].reverse().find((h) => hour >= h);
  const to = new Date(
    Date.UTC(
      bangkok.getUTCFullYear(),
      bangkok.getUTCMonth(),
      bangkok.getUTCDate(),
      latest ?? CUT_OFF_HOURS[CUT_OFF_HOURS.length - 1]!,
    ) -
      BANGKOK_OFFSET_MS -
      // Before the first cut-off of the day, the last one that passed was yesterday evening's.
      (latest === undefined ? 24 * 60 * 60 * 1000 : 0),
  );
  return { from: new Date(to.getTime() - 24 * 60 * 60 * 1000), to, cutOff: true };
}

/**
 * The period asked for in the query, or the default. A bad value is not an error: it falls back to
 * the default, because a mistyped URL must not leave a crew staring at an error page.
 */
export function periodFromQuery(
  from: string | null | undefined,
  to: string | null | undefined,
  now: Date = new Date(),
): Period {
  const a = from ? new Date(from) : null;
  const b = to ? new Date(to) : null;
  if (!a || !b || Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return defaultPeriod(now);
  if (b <= a) return defaultPeriod(now);
  if (b.getTime() - a.getTime() > MAX_DAYS * 24 * 60 * 60 * 1000) return defaultPeriod(now);
  if (b.getTime() > now.getTime() + 60_000) return defaultPeriod(now);
  const d = defaultPeriod(now);
  return { from: a, to: b, cutOff: a.getTime() === d.from.getTime() && b.getTime() === d.to.getTime() };
}

/** A date for a `datetime-local` input, in Bangkok time, which is the clock the form speaks. */
export function toLocalInput(d: Date): string {
  return new Date(d.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 16);
}

/** Back from that input. The form has no time zone, so Bangkok is assumed, never the laptop's. */
export function fromLocalInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00Z`);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() - BANGKOK_OFFSET_MS);
}

/** A document id a copy in circulation can be traced back by: unit, cut-off day and half. */
export function documentId(unitId: string, period: Period): string {
  const b = new Date(period.to.getTime() + BANGKOK_OFFSET_MS);
  const day = b.toISOString().slice(0, 10).replace(/-/g, "");
  const half = b.getUTCHours() < 12 ? "AM" : "PM";
  return `JAGA-SITREP-${day}-${half}-${unitId.slice(0, 8).toUpperCase()}`;
}

export const LEVELS = ["evacuate", "warning", "watch", "return", "normal"] as const;
export type Level = (typeof LEVELS)[number];

/** The four limits, rendered with every report in every format (safety rule 8). */
export const LIMITS = ["counts", "reportsAreWhatPeopleSaid", "gaugeTime", "notAnAlert"] as const;

export type SitrepAlert = {
  level: Level;
  hazard: string;
  reason: string | null;
  issued_at: string;
  next_update_at: string | null;
  stale: boolean;
  automatic: boolean;
  tambons: { th: string; en: string }[] | null;
};

export type SitrepTambon = {
  code: string;
  th: string;
  en: string;
  district_th: string;
  district_en: string;
  level: Level | null;
  new_cases: number;
  new_people: number;
  open_now: number;
  waiting_now: number;
  closed_rescued: number;
  field_people: number;
  reports: number;
  roads_cut: number;
  worst_depth: string | null;
};

export type SitrepPlace = {
  name: Record<string, string> | null;
  type: string;
  status: string;
  capacity: number | null;
  checked_at: string | null;
  tambon_th: string;
  tambon_en: string;
};

export type SitrepGauge = {
  code: string;
  name: Record<string, string> | null;
  basin: string | null;
  value: number | null;
  observed_at: string | null;
  status: string | null;
  rise_3h: number | null;
  bank_m: number | null;
};

export type Sitrep = {
  unit: { id: string; name: string; org: string | null; capabilities: string[] };
  from: string;
  to: string;
  generated_at: string;
  area: { tambons: number; districts: number; provinces: { th: string; en: string }[] };
  alerts_now: SitrepAlert[];
  alerts_issued: Partial<Record<Level, number>>;
  sos: {
    new_cases: number;
    new_rescue: number;
    new_supplies: number;
    new_people: number;
    new_vulnerable: number;
    new_spam: number;
    merged: number;
    open_now: number;
    waiting_now: number;
    closed_rescued: number;
    closed_safe: number;
    closed_dismissed: number;
  };
  field_rescues: { records: number; people: number };
  reports: { reports: number; deep: number; roads_cut: number; rising: number };
  by_tambon: SitrepTambon[];
  places: {
    open: number;
    full: number;
    closed: number;
    unknown: number;
    capacity_open: number;
    list: SitrepPlace[];
  };
  gauges: SitrepGauge[];
};

/**
 * Read one report. The database decides whether this caller may have it at all, for which unit,
 * and what goes in it; this only asks. An error is passed back as null so a page can say "not
 * available" rather than crash a crew's phone mid-flood.
 */
export async function readSitrep(
  supabase: SupabaseClient,
  unitId: string,
  period: Period,
): Promise<Sitrep | null> {
  const { data, error } = await supabase.rpc("unit_sitrep", {
    p_unit: unitId,
    p_from: period.from.toISOString(),
    p_to: period.to.toISOString(),
  });
  if (error || !data) return null;
  return data as Sitrep;
}

/** The level a whole report leads with: the highest live one anywhere in the unit's area. */
export function headlineLevel(s: Sitrep): Level | null {
  for (const level of LEVELS) {
    if (s.alerts_now.some((a) => a.level === level)) return level;
  }
  return null;
}

/** The rows of the per-tambon table, in the order the report prints them. */
export function tambonRows(s: Sitrep): SitrepTambon[] {
  return [...s.by_tambon].sort(
    (a, b) =>
      b.open_now - a.open_now ||
      b.new_cases - a.new_cases ||
      a.district_th.localeCompare(b.district_th, "th") ||
      a.th.localeCompare(b.th, "th"),
  );
}

/** One row per tambon for the CSV, flat and with the same numbers as the page. */
export const CSV_COLUMNS = [
  "tambon_code",
  "tambon",
  "district",
  "alert_level",
  "new_cases",
  "new_people",
  "open_now",
  "waiting_now",
  "closed_rescued",
  "field_rescue_people",
  "reports",
  "roads_cut",
  "worst_depth",
] as const;

export function csvRow(t: SitrepTambon, locale: string): (string | number)[] {
  const th = locale === "th";
  return [
    t.code,
    th ? t.th : t.en,
    th ? t.district_th : t.district_en,
    t.level ?? "",
    t.new_cases,
    t.new_people,
    t.open_now,
    t.waiting_now,
    t.closed_rescued,
    t.field_people,
    t.reports,
    t.roads_cut,
    t.worst_depth ?? "",
  ];
}

/** A file name a copy on a desk can be identified by, without a unit name in it (it travels). */
export function fileName(unitId: string, period: Period, ext: string): string {
  return `${documentId(unitId, period).toLowerCase()}.${ext}`;
}
