import type { AbstractIntlMessages } from "next-intl";
import { ALERT_LEVELS, type AlertLevel } from "@/lib/brand/tokens";

/**
 * The alert console's shapes and arithmetic (spec 6.2). Nothing here talks to the database or
 * the browser, so all of it is unit-tested. The database decides everything again when an alert
 * is published; this file only keeps the screen honest about what it is about to ask for.
 */

/** "The next update is in ...": an admin picks one of these, never types a clock time. */
export const NEXT_UPDATE_HOURS = [1, 2, 3, 6, 12, 24] as const;

/** Levels an admin can issue. Normal is the absence of an alert, not something to publish. */
export const ISSUABLE_LEVELS = ["watch", "warning", "evacuate", "return"] as const;

export type AlertTemplate = {
  id: string;
  code: string;
  level: AlertLevel;
  label: Record<string, string>;
  reason: Record<string, string>;
};

export type AlertEvent = {
  action: string;
  at: string;
  by: string | null;
  details: Record<string, unknown>;
};

export type AdminAlert = {
  id: string;
  level: AlertLevel;
  reason: string;
  messages: Record<string, string>;
  issuedAt: string;
  nextUpdateAt: string;
  onset: [string, string] | null;
  returnWindow: [string, string] | null;
  issuedBy: string | null;
  drill: boolean;
  /** "dam_release" for a notice sent from the dam panel; null for one made here. */
  kind: string | null;
  tambons: string[];
  supersededBy: string | null;
  cancelledAt: string | null;
  endedAt: string | null;
  events: AlertEvent[];
};

export type AlertState = "inForce" | "superseded" | "cancelled";

export function alertState(a: Pick<AdminAlert, "supersededBy" | "cancelledAt">): AlertState {
  if (a.cancelledAt) return "cancelled";
  return a.supersededBy ? "superseded" : "inForce";
}

type Row = Record<string, unknown>;

const iso = (v: unknown): string | null => {
  if (typeof v !== "string" && !(v instanceof Date)) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const pair = (a: unknown, b: unknown): [string, string] | null => {
  const from = iso(a);
  const to = iso(b);
  return from && to ? [from, to] : null;
};
const strings = (v: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries((v ?? {}) as Row).filter((e): e is [string, string] => typeof e[1] === "string"),
  );

export function toAdminAlert(r: Row): AdminAlert | null {
  const level = r.level as AlertLevel;
  const issuedAt = iso(r.issued_at);
  const nextUpdateAt = iso(r.next_update_at);
  if (typeof r.alert_id !== "string" || !ALERT_LEVELS.includes(level) || !issuedAt || !nextUpdateAt)
    return null;
  return {
    id: r.alert_id,
    level,
    reason: String(r.reason ?? ""),
    messages: strings(r.messages),
    issuedAt,
    nextUpdateAt,
    onset: pair(r.onset_from, r.onset_to),
    returnWindow: pair(r.return_from, r.return_to),
    issuedBy: typeof r.issued_by_name === "string" && r.issued_by_name ? r.issued_by_name : null,
    drill: r.is_drill === true,
    kind: typeof r.kind === "string" ? r.kind : null,
    tambons: Array.isArray(r.tambons) ? r.tambons.map(String) : [],
    supersededBy: typeof r.superseded_by === "string" ? r.superseded_by : null,
    cancelledAt: iso(r.cancelled_at),
    endedAt: iso(r.ended_at),
    events: (Array.isArray(r.events) ? (r.events as Row[]) : []).map((e) => ({
      action: String(e.action),
      at: iso(e.at) ?? "",
      by: typeof e.by === "string" && e.by ? e.by : null,
      details: (e.details ?? {}) as Record<string, unknown>,
    })),
  };
}

export function toTemplate(r: Row): AlertTemplate | null {
  const level = r.level as AlertLevel;
  if (typeof r.id !== "string" || !ALERT_LEVELS.includes(level)) return null;
  return {
    id: r.id,
    code: String(r.code),
    level,
    label: strings(r.label),
    reason: strings(r.reason),
  };
}

/**
 * Who a drill is sent to (A10, the owner on 20 Oct). An empty list is the drill there has
 * always been: published, kept, and shown to nobody. The admin may tick several; they add up.
 */
export const DRILL_AUDIENCES = ["admins", "rescue", "units", "everyone"] as const;
export type DrillAudience = (typeof DRILL_AUDIENCES)[number];

/** The ticked audiences, in the order above, with anything unknown dropped. */
export function drillAudience(values: unknown[]): DrillAudience[] {
  const ticked = new Set(values.map(String));
  return DRILL_AUDIENCES.filter((a) => ticked.has(a));
}

/** What the review step shows before anything is sent. */
export type AlertPreview = {
  level: AlertLevel;
  reason: string;
  messages: Record<string, string>;
  tambons: number;
  reach: {
    homes: number;
    watched: number;
    /** Signed in, never chose a place: told about every alert (owner, 21 Oct). */
    noPlace: number;
    people: number;
    push: number;
    line: number;
  };
  /** This month's LINE messages, when the quota is being tracked (A7). */
  lineQuota: { used: number; limit: number } | null;
  /** Alerts already in force that share a tambon with this one. */
  overlaps: { id: string; level: AlertLevel; drill: boolean; shared: number }[];
  /**
   * Who a sent drill would reach, which is not the alert's reach unless the audience is
   * everyone: the admins and the covering teams are told wherever they live. Null when no
   * audience is ticked, so there is nothing to send.
   */
  drillReach: { people: number; push: number; line: number } | null;
};

export function toPreview(v: unknown): AlertPreview | null {
  const r = (v ?? {}) as Row;
  const level = r.level as AlertLevel;
  const messages = strings(r.messages);
  if (!ALERT_LEVELS.includes(level) || !messages.th) return null;
  const reach = (r.reach ?? {}) as Row;
  const quota = r.lineQuota as Row | null | undefined;
  const n = (x: unknown) => Math.max(0, Math.trunc(Number(x ?? 0)) || 0);
  return {
    level,
    reason: String(r.reason ?? ""),
    messages,
    tambons: n(r.tambons),
    reach: {
      homes: n(reach.homes),
      watched: n(reach.watched),
      noPlace: n(reach.noPlace),
      people: n(reach.people),
      push: n(reach.push),
      line: n(reach.line),
    },
    lineQuota: quota ? { used: n(quota.used), limit: n(quota.limit) } : null,
    overlaps: (Array.isArray(r.overlaps) ? (r.overlaps as Row[]) : [])
      .filter((o) => ALERT_LEVELS.includes(o.level as AlertLevel))
      .map((o) => ({
        id: String(o.id),
        level: o.level as AlertLevel,
        drill: o.drill === true,
        shared: n(o.shared),
      })),
    drillReach: r.drillReach
      ? {
          people: n((r.drillReach as Row).people),
          push: n((r.drillReach as Row).push),
          line: n((r.drillReach as Row).line),
        }
      : null,
  };
}

/**
 * LINE messages this alert would use against what is left this month. Null when nothing is
 * tracked yet; "over" is a warning for the admin, never a reason to hold an alert back.
 */
export function lineQuotaAfter(
  preview: Pick<AlertPreview, "reach" | "lineQuota" | "drillReach">,
): { after: number; limit: number; over: boolean } | null {
  if (!preview.lineQuota || preview.lineQuota.limit <= 0) return null;
  // A drill spends the quota too, and a drill to the teams spends much less than the alert
  // would: the admin should see the number that is about to be spent, not the other one.
  const sending = preview.drillReach?.line ?? preview.reach.line;
  const after = preview.lineQuota.used + sending;
  return { after, limit: preview.lineQuota.limit, over: after > preview.lineQuota.limit };
}

/** What is ticked in the area chooser: whole provinces, whole districts, zones, single tambons. */
export type AreaChoice = {
  provinces: string[];
  districts: string[];
  tambons: string[];
  zones: string[];
  /**
   * "Everywhere people use Jaga": every tambon that is somebody's home or watched place. The
   * browser is never given that list - the form sends a tick and the server works out the
   * codes - so this is a boolean here and codes by the time chosenTambons sees it.
   */
  people?: boolean;
};

/**
 * The tambon codes a choice comes to. DOPA codes nest (province 2 digits, district 4, tambon 6),
 * so a whole province or district is a prefix. Anything that is not a known tambon is dropped
 * here and refused by the database, so a stale form cannot name a place that does not exist.
 */
export function chosenTambons(
  all: readonly string[],
  choice: AreaChoice,
  zoneTambons: Readonly<Record<string, readonly string[]>> = {},
  /** The codes the "everywhere people use Jaga" tick comes to, read from the database. */
  peopleTambons: readonly string[] = [],
): string[] {
  const provinces = new Set(choice.provinces);
  const districts = new Set(choice.districts);
  const single = new Set(choice.tambons);
  for (const zone of choice.zones) for (const code of zoneTambons[zone] ?? []) single.add(code);
  if (choice.people) for (const code of peopleTambons) single.add(code);
  return all
    .filter(
      (code) =>
        single.has(code) || districts.has(code.slice(0, 4)) || provinces.has(code.slice(0, 2)),
    )
    .sort();
}

export function areaChoice(values: (name: string) => unknown[]): AreaChoice {
  const list = (name: string) => values(name).map(String).filter(Boolean);
  return {
    provinces: list("province"),
    districts: list("district"),
    tambons: list("tambon"),
    zones: list("zone"),
    people: values("people").some((v) => String(v) === "yes"),
  };
}

/** One of the offered waits, as a number of hours; anything else is null. */
export function updateHours(value: unknown): number | null {
  const hours = Number(value);
  return (NEXT_UPDATE_HOURS as readonly number[]).includes(hours) ? hours : null;
}

/**
 * A `datetime-local` value read as a Bangkok clock time, whatever zone the admin's laptop is in
 * (the owner works three or four hours behind the service area). Bangkok has no daylight saving,
 * so the offset is fixed. Empty or malformed gives null.
 */
export function bangkokToIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}:00+07:00`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Both ends or neither, and the end after the start. "half" and "order" name what is wrong. */
export function windowOf(
  from: unknown,
  to: unknown,
): { ok: true; range: [string, string] | null } | { ok: false; error: "half" | "order" } {
  const blank = (v: unknown) => typeof v !== "string" || v.trim() === "";
  if (blank(from) && blank(to)) return { ok: true, range: null };
  const a = bangkokToIso(from);
  const b = bangkokToIso(to);
  if (!a || !b) return { ok: false, error: "half" };
  if (Date.parse(a) >= Date.parse(b)) return { ok: false, error: "order" };
  return { ok: true, range: [a, b] };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** The only texts the review step needs in the browser: its own, and the level names. */
export function alertReviewMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const all = messages as Record<string, Record<string, AbstractIntlMessages>>;
  return {
    alertConsole: { review: all.alertConsole!.review! },
    alert: { level: all.alert!.level! },
  };
}
