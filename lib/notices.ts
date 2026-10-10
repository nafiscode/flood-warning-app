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
      }
    | {
        kind: "alertEnded";
        level: AlertLevel;
        hazard: string;
        messages: Record<string, string>;
        alertId: string;
      }
    | { kind: "announcement"; messages: Record<string, string> }
    | { kind: "sos"; caseId: string; event: SosNews; unitName: string | null }
  );

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
 * The steps of their own SOS worth catching up on. "received" is not news to the person who
 * pressed the button, and the details they added themselves are not either; the arrival estimate
 * is left to the case page, where it is shown as a band with the time it was given.
 */
export const SOS_NEWS = ["accepted", "assigned_by_admin", "en_route", "rescued"] as const;
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
  now: number;
  /** The word for the person's own home, and how to name a chosen area, both translated. */
  homeLabel: string;
  areaLabel: (area: Area) => string;
}): NoticeItem[] {
  const { rows, area, me, cases, now, homeLabel, areaLabel } = input;
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
    if (within(row.issuedAt)) {
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
      });
    }
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
