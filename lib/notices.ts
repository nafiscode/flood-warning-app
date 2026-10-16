/**
 * The bell: what a person missed (the owner's request, 10 Oct).
 *
 * A notification reaches a phone once, at the moment it is sent. Someone asleep, out of signal,
 * or without notifications turned on never sees it. This builds the catch-up list they find when
 * they next open Jaga: the last fourteen days of everything that concerned them, newest first.
 *
 * Nothing here reads the database or the browser. It turns what the app already has — the feed
 * rows from public_notices(), the person's own places, and the SOS cases their phone remembers —
 * into one list of items, each with a stable id so "already read" can be remembered.
 */
import type { Area } from "@/lib/area";
import type { AlertLevel } from "@/lib/brand/tokens";
import { fieldNews, type MyFieldRescue } from "@/lib/field-rescue";
import { unitNews, type FieldWaiting, type UnitRequest } from "@/lib/journey";
import { ALERT_LEVELS } from "@/lib/brand/tokens";
import type { MyPlaces } from "@/lib/me";
import type { SosTimeline } from "@/lib/sos";

/** How far back the bell looks. Fourteen days covers a whole flood episode (owner, 10 Oct). */
export const WINDOW_DAYS = 14;
const WINDOW_MS = WINDOW_DAYS * 24 * 3600_000;

/** A place of the person's that an alert names, for "your home and Mum's house" (spec 4.8). */
export type NoticePlace = { label: string; tambon: string };

type Base = {
  /** Stable across reloads and phones: what "already read" is remembered by. */
  id: string;
  /** When it happened. The list is sorted on this, newest first. */
  at: string;
  /** Which of the person's places it concerns; empty for something sent to everyone. */
  places: NoticePlace[];
};

export type NoticeItem = Base &
  (
    | {
        kind: "alert";
        level: AlertLevel;
        hazard: string;
        reason: string;
        messages: Record<string, string>;
        nextUpdateAt: string | null;
        source: string | null;
        /** The alert this item is about, for the link to the full alert. */
        alertId: string;
        /**
         * Set when none of the person's own places is in the alert: an admin who chose to hear
         * every alert, everywhere. How many tambons it covers, said instead of "your area".
         */
        elsewhere?: number;
      }
    | {
        kind: "alertEnded";
        level: AlertLevel;
        hazard: string;
        messages: Record<string, string>;
        alertId: string;
      }
    | { kind: "announcement"; messages: Record<string, string> }
    | {
        kind: "sos";
        caseId: string;
        event: SosNews;
        unitName: string | null;
        /** A request for food and water reads differently from a rescue. */
        supplies: boolean;
      }
    | {
        kind: "unit";
        event: "verified" | "rejected" | "suspended";
        unitName: string;
        /** The admin's reason, when the registration was turned down. */
        reason?: string | null;
      }
    | { kind: "field"; event: "approved" | "rejected" }
    | { kind: "fieldWaiting"; count: number }
    | { kind: "report"; event: "approved" | "hidden"; tambon: { th: string; en: string } | null }
    | ({ kind: "autoAlarm" } & Omit<AutoAlarm, "id" | "createdAt" | "decidedAt">)
  );

/** What became of one automatic alarm (A8, safety rule 2's one exception). */
export const AUTO_ALARM_STATUSES = [
  "pending",
  "sent",
  "dismissed",
  "auto_published",
  "lapsed",
  "replaced",
] as const;
export type AutoAlarmStatus = (typeof AUTO_ALARM_STATUSES)[number];

/** One automatic alarm, as admin_auto_alarms() gives it. Admins only. */
export type AutoAlarm = {
  id: string;
  status: AutoAlarmStatus;
  level: "warning" | "evacuate";
  zone: string;
  gauge: string | null;
  value: number | null;
  threshold: number | null;
  createdAt: string;
  deadline: string;
  decidedAt: string | null;
  decidedBy: string | null;
  note: string | null;
  alertId: string | null;
  /** Whether what it published was a drill; null when it published nothing. */
  drill: boolean | null;
};

/** One row of admin_auto_alarms() as an AutoAlarm, or null when it is not one. */
export function toAutoAlarm(row: Record<string, unknown>): AutoAlarm | null {
  const createdAt = isoOrNull(row.createdAt);
  const deadline = isoOrNull(row.deadline);
  const status = AUTO_ALARM_STATUSES.find((s) => s === row.status);
  const level = row.level === "warning" || row.level === "evacuate" ? row.level : null;
  if (typeof row.id !== "string" || !createdAt || !deadline || !status || !level) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  return {
    id: row.id,
    status,
    level,
    zone: text(row.zone) ?? "",
    gauge: text(row.gauge),
    value: num(row.value),
    threshold: num(row.threshold),
    createdAt,
    deadline,
    decidedAt: isoOrNull(row.decidedAt),
    decidedBy: text(row.decidedBy),
    note: text(row.note),
    alertId: text(row.alertId),
    drill: typeof row.drill === "boolean" ? row.drill : null,
  };
}

/**
 * An admin's decision on one of the person's own flood reports (/api/me/requests, from
 * my_report_decisions): checked, or taken off the map. The latest decision per report.
 */
export type ReportDecision = {
  reportId: string;
  status: "approved" | "hidden";
  decidedAt: string;
  tambonTh: string | null;
  tambonEn: string | null;
};

/** One row of my_report_decisions() as a ReportDecision, or null when it is not one. */
export function toReportDecision(row: Record<string, unknown>): ReportDecision | null {
  const decidedAt = isoOrNull(row.decided_at);
  if (typeof row.report_id !== "string" || !decidedAt) return null;
  if (row.status !== "approved" && row.status !== "hidden") return null;
  return {
    reportId: row.report_id,
    status: row.status,
    decidedAt,
    tambonTh: typeof row.tambon_th === "string" ? row.tambon_th : null,
    tambonEn: typeof row.tambon_en === "string" ? row.tambon_en : null,
  };
}

/** One row of public_notices(), as /api/public/notices gives it. */
export type NoticeRow = {
  kind: "alert" | "announcement";
  id: string;
  hazard: string | null;
  level: AlertLevel | null;
  reason: string;
  messages: Record<string, string>;
  issuedAt: string;
  nextUpdateAt: string | null;
  endedAt: string | null;
  source: string | null;
  tambons: string[];
};

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function texts(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/**
 * One row of public_notices() as a NoticeRow, or null when it lacks what it needs to be shown.
 * An alert without a level or Thai text is left out rather than shown half (safety rule 3).
 */
export function toNoticeRow(row: Record<string, unknown>): NoticeRow | null {
  const kind = row.kind === "announcement" ? "announcement" : "alert";
  const issuedAt = isoOrNull(row.issued_at);
  const messages = texts(row.messages);
  const level = row.level as AlertLevel | null;
  if (typeof row.id !== "string" || !issuedAt || typeof messages.th !== "string") return null;
  if (kind === "alert" && (!level || !ALERT_LEVELS.includes(level))) return null;
  return {
    kind,
    id: row.id,
    hazard: typeof row.hazard_type === "string" ? row.hazard_type : null,
    level: kind === "alert" ? level : null,
    reason: typeof row.reason === "string" ? row.reason : "",
    messages,
    issuedAt,
    nextUpdateAt: isoOrNull(row.next_update_at),
    endedAt: isoOrNull(row.ended_at),
    source: typeof row.source === "string" && row.source !== "" ? row.source : null,
    tambons: Array.isArray(row.tambons) ? row.tambons.map(String) : [],
  };
}

/** The tambons a person cares about: the area they chose, their home, and the places they watch. */
export function myTambons(area: Area | null, me: MyPlaces | null): string[] {
  const codes = new Set<string>();
  if (area) codes.add(area.code);
  if (me?.signedIn) {
    if (me.home) codes.add(me.home.code);
    for (const place of me.places) if (place.area) codes.add(place.area.code);
  }
  return [...codes].sort();
}

/**
 * Which of the person's places an alert names. The area they chose is included under its own
 * name, so a visitor without an account still reads "Bana" rather than a code.
 */
function placesIn(
  tambons: string[],
  area: Area | null,
  me: MyPlaces | null,
  homeLabel: string,
  areaLabel: (area: Area) => string,
): NoticePlace[] {
  const found: NoticePlace[] = [];
  const seen = new Set<string>();
  const add = (label: string, tambon: string) => {
    const key = `${label}|${tambon}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ label, tambon });
  };
  if (me?.signedIn && me.home && tambons.includes(me.home.code)) add(homeLabel, me.home.code);
  if (me?.signedIn) {
    for (const place of me.places) {
      if (place.area && tambons.includes(place.area.code)) add(place.label, place.area.code);
    }
  }
  if (area && tambons.includes(area.code) && found.length === 0) add(areaLabel(area), area.code);
  return found;
}

/**
 * The steps of their own request that somebody else took (the owner, 13 Oct: a bell item as
 * each step is completed). "received" is not news to the person who pressed the button, and what
 * they did themselves is not either; the arrival estimate is left to the case page, where it is
 * shown as a band with the time it was given.
 */
export const SOS_NEWS = [
  "accepted",
  "assigned_by_admin",
  "en_route",
  "on_site",
  "rescued_by_team",
  "rescued",
  "confirmed",
  "released",
] as const;
export type SosNews = (typeof SOS_NEWS)[number];

const isSosNews = (event: string): event is SosNews =>
  (SOS_NEWS as readonly string[]).includes(event);

export type KnownCase = { id: string; timeline: SosTimeline | null };

/**
 * Everything the bell shows, newest first. `now` decides the fourteen-day window, so the tests
 * and the examples can pick their own moment.
 */
export function buildNotices(input: {
  rows: NoticeRow[];
  area: Area | null;
  me: MyPlaces | null;
  cases: KnownCase[];
  /** The teams this person registered, for news of their verification. */
  units?: UnitRequest[];
  /** Rescues their team found by itself, for news of an admin's decision. */
  field?: MyFieldRescue[];
  /** For an admin: field rescues waiting to be checked. */
  fieldWaiting?: FieldWaiting | null;
  /** What an admin decided about the person's own flood reports. */
  reports?: ReportDecision[];
  /** For an admin: the automatic alarms of the last fourteen days. */
  autoAlarms?: AutoAlarm[];
  now: number;
  /** The word for the person's own home, and how to name a chosen area, both translated. */
  homeLabel: string;
  areaLabel: (area: Area) => string;
}): NoticeItem[] {
  const { rows, area, me, cases, units = [], field = [], now, homeLabel, areaLabel } = input;
  const { fieldWaiting, reports = [], autoAlarms = [] } = input;
  const from = now - WINDOW_MS;
  const items: NoticeItem[] = [];
  const within = (at: string) => {
    const time = Date.parse(at);
    return Number.isFinite(time) && time >= from && time <= now + 60_000;
  };

  for (const row of rows) {
    const places = placesIn(row.tambons, area, me, homeLabel, areaLabel);
    if (row.kind === "announcement") {
      if (within(row.issuedAt)) {
        items.push({
          kind: "announcement",
          id: `ann:${row.id}`,
          at: row.issuedAt,
          places,
          messages: row.messages,
        });
      }
      continue;
    }
    const level = row.level!;
    // An alert still in force is always in the bell, however long ago it was issued: someone who
    // starts using Jaga today must find the warning that has stood for three weeks.
    if (within(row.issuedAt) || (!row.endedAt && Date.parse(row.issuedAt) <= now + 60_000)) {
      items.push({
        kind: "alert",
        id: `alert:${row.id}`,
        at: row.issuedAt,
        places,
        level,
        hazard: row.hazard ?? "flood",
        reason: row.reason,
        messages: row.messages,
        nextUpdateAt: row.nextUpdateAt,
        source: row.source,
        alertId: row.id,
        // None of the person's places is in it: an admin hearing every alert, everywhere.
        ...(places.length === 0 && row.tambons.length > 0 ? { elsewhere: row.tambons.length } : {}),
      });
    }
    // An alert that has been lifted or replaced is news of its own, and keeps its level, so the
    // list never reads as if the danger had simply disappeared (safety rule 3).
    if (row.endedAt && within(row.endedAt)) {
      items.push({
        kind: "alertEnded",
        id: `alert:${row.id}:ended`,
        at: row.endedAt,
        places,
        level,
        hazard: row.hazard ?? "flood",
        messages: row.messages,
        alertId: row.id,
      });
    }
  }

  for (const known of cases) {
    const timeline = known.timeline;
    if (!timeline) continue;
    for (const entry of timeline.events) {
      const at = isoOrNull(entry.at);
      if (!isSosNews(entry.event) || !at || !within(at)) continue;
      items.push({
        kind: "sos",
        // The time is part of the id: a case can be handed back and accepted again, and the
        // second time is news of its own.
        id: `sos:${known.id}:${entry.event}:${at}`,
        at,
        places: [],
        caseId: known.id,
        event: entry.event,
        unitName: entry.unit ?? timeline.unitName,
        supplies: timeline.kind === "supplies",
      });
    }
  }

  for (const unit of units) {
    const news = unitNews(unit);
    if (!news || !within(news.at)) continue;
    items.push({
      kind: "unit",
      id: news.id,
      at: news.at,
      places: [],
      event: news.event,
      unitName: unit.name,
      reason: news.event === "rejected" ? (unit.reviewNote ?? null) : null,
    });
  }

  // One item for the admins, new again each time a newer record starts waiting. Not held to
  // the fourteen days: it stays while something waits.
  if (fieldWaiting && fieldWaiting.count > 0) {
    items.push({
      kind: "fieldWaiting",
      id: `fieldwait:${fieldWaiting.newestId}`,
      at: isoOrNull(fieldWaiting.newestAt) ?? new Date(now).toISOString(),
      places: [],
      count: fieldWaiting.count,
    });
  }

  for (const record of field) {
    const news = fieldNews(record);
    if (!news || !within(news.at)) continue;
    items.push({ kind: "field", id: news.id, at: news.at, places: [], event: news.event });
  }

  // An automatic alarm is news each time its state changes: raised, then sent, dismissed,
  // published by itself or let go because the river fell back.
  for (const alarm of autoAlarms) {
    const at = alarm.status === "pending" ? alarm.createdAt : (alarm.decidedAt ?? alarm.createdAt);
    if (!within(at)) continue;
    items.push({
      kind: "autoAlarm",
      id: `auto:${alarm.id}:${alarm.status}`,
      at,
      places: [],
      status: alarm.status,
      level: alarm.level,
      zone: alarm.zone,
      gauge: alarm.gauge,
      value: alarm.value,
      threshold: alarm.threshold,
      deadline: alarm.deadline,
      decidedBy: alarm.decidedBy,
      note: alarm.note,
      alertId: alarm.alertId,
      drill: alarm.drill,
    });
  }

  for (const decision of reports) {
    const at = isoOrNull(decision.decidedAt);
    if (!at || !within(at)) continue;
    if (decision.status !== "approved" && decision.status !== "hidden") continue;
    items.push({
      kind: "report",
      // The decision and its time are in the id: a report checked and later hidden is news twice.
      id: `report:${decision.reportId}:${decision.status}:${at}`,
      at,
      places: [],
      event: decision.status,
      tambon:
        decision.tambonTh || decision.tambonEn
          ? {
              th: decision.tambonTh ?? decision.tambonEn ?? "",
              en: decision.tambonEn ?? decision.tambonTh ?? "",
            }
          : null,
    });
  }

  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
  return items;
}

/** How many of them this person has not read yet: the number on the bell. */
export function unreadCount(items: NoticeItem[], read: readonly string[]): number {
  const seen = new Set(read);
  return items.filter((item) => !seen.has(item.id)).length;
}

/** The badge never grows past "9+": a bigger number says nothing more and breaks the row. */
export function badgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > 9 ? "9+" : String(count);
}

/** The read list, kept small: only ids still inside the window are worth remembering. */
export function keepRead(read: readonly string[], items: NoticeItem[]): string[] {
  const live = new Set(items.map((item) => item.id));
  return [...new Set(read.filter((id) => live.has(id)))].sort();
}

/**
 * Which sound, if any, the notices call for right now (docs/brand.md "Sound"): any alert for the
 * person's places that is still in force, has not been read and has not rung on this phone
 * before - whenever it was issued, so a person who opens Jaga for the first time hears the
 * alert that was already standing (the owner, 13 Oct). Announcements and anything already
 * lifted are silent. A dam release outranks the plain alert tone: its water is already coming.
 * Each level has its own sound; when several are due, the most serious one plays.
 *
 * `ids` is everything this ring answers for, so each alert rings once on a phone and no more.
 */
export function ringFor(
  items: readonly NoticeItem[],
  read: readonly string[],
  rung: readonly string[],
): { sound: RingSound | null; ids: string[] } {
  const ended = new Set(items.flatMap((i) => (i.kind === "alertEnded" ? [i.alertId] : [])));
  const seen = new Set([...read, ...rung]);
  const due = items.filter(
    (i): i is Extract<NoticeItem, { kind: "alert" }> =>
      i.kind === "alert" &&
      !ended.has(i.alertId) &&
      !seen.has(i.id) &&
      (i.level !== "normal" || isDamRelease(i.source)),
  );
  if (due.length === 0) return { sound: null, ids: [] };
  const has = (level: AlertLevel) => due.some((i) => i.level === level);
  return {
    // One sound for the most serious thing due: a dam release first, then by level.
    sound: due.some((i) => isDamRelease(i.source))
      ? "damRelease"
      : has("evacuate")
        ? "alertEvacuate"
        : has("warning")
          ? "alertWarning"
          : has("watch")
            ? "alertWatch"
            : "alertReturn",
    ids: due.map((i) => i.id),
  };
}

export type RingSound =
  "alertWatch" | "alertWarning" | "alertEvacuate" | "alertReturn" | "damRelease";

function isDamRelease(source: string | null): boolean {
  return !!source && source.startsWith("dam_release");
}
