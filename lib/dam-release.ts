import type { DamArrival } from "@/lib/dam-arrival";

/**
 * The dam release notice (docs/spec.md section 15): the words an admin sends when the gates open.
 *
 * **Nothing here is written by the person sending it.** They enter when the gates opened, how much
 * water is leaving, until when if they know, and the level; the sentences come from the reviewed
 * template in `messages/*.json` and are built here, the same way, in all three languages. That is
 * the whole point of this file: a notice that goes to tens of thousands of phones at once must not
 * depend on what somebody could type at two in the morning.
 *
 * The windows it prints are the measured arrival ranges (lib/dam-arrival.ts), never a single time.
 */

export type ReleaseInput = {
  /** The dam and river in the language being written. */
  damName: string;
  river: string;
  operator: string;
  gatesOpenAt: Date;
  releaseCms: number;
  expectedEndAt: Date | null;
  /** When the water is expected to start rising, nearest place to furthest. */
  onset: { from: Date; to: Date } | null;
};

/** What `createTranslator` gives, narrowed to what this file needs. */
export type Say = (key: string, values?: Record<string, string | number>) => string;
/** A Bangkok-time formatter for the language being written. */
export type SayTime = (at: Date) => string;

/**
 * The notice itself. Paragraphs in the order a person needs them: what happened, when the water
 * comes, what to do, and only then how certain any of it is.
 */
export function releaseText(say: Say, time: SayTime, input: ReleaseInput): string {
  const parts = [
    say("release.title", { dam: input.damName }),
    say("release.body", {
      dam: input.damName,
      time: time(input.gatesOpenAt),
      cms: Math.round(input.releaseCms),
      river: input.river,
    }),
  ];
  if (input.onset) {
    parts.push(say("release.window", { from: time(input.onset.from), to: time(input.onset.to) }));
  }
  if (input.expectedEndAt) {
    parts.push(say("release.until", { time: time(input.expectedEndAt) }));
  }
  parts.push(say("release.act"));
  parts.push(say("release.estimate"));
  parts.push(say("release.issuer", { operator: input.operator }));
  return parts.join("\n\n");
}

/** The one line that goes in the alert's `reason`, which safety rule 3 puts on every screen. */
export function releaseReason(say: Say, time: SayTime, input: ReleaseInput): string {
  return say("release.reason", {
    dam: input.damName,
    cms: Math.round(input.releaseCms),
    time: time(input.gatesOpenAt),
  });
}

/**
 * The window for the zone as a whole, from the measured arrivals: the nearest place with its
 * safety margin already taken off, to the furthest place's latest first rise. The same sum the
 * database makes when it stores the alert, kept here so the screen can show it before sending.
 */
export function zoneWindow(
  arrivals: readonly DamArrival[],
  gatesOpenAt: Date,
): { from: Date; to: Date } | null {
  if (arrivals.length === 0) return null;
  const start = gatesOpenAt.getTime();
  if (!Number.isFinite(start)) return null;
  return {
    from: new Date(start + Math.min(...arrivals.map((a) => a.warnFromH)) * 3_600_000),
    to: new Date(start + Math.max(...arrivals.map((a) => a.latestH)) * 3_600_000),
  };
}

/** The nearest and the furthest tambon, for the line the sender reads before they send. */
export function zoneEnds(arrivals: readonly DamArrival[]) {
  if (arrivals.length === 0) return null;
  const sorted = [...arrivals].sort((a, b) => a.kmFromDam - b.kmFromDam);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  return { first, last };
}

export const RELEASE_LEVELS = ["watch", "warning", "evacuate"] as const;
export type ReleaseLevel = (typeof RELEASE_LEVELS)[number];

/**
 * A level is a person's choice, so the form offers three and defaults to none of them being
 * preselected by the figures. `warning` is the form's own starting point only because it is the
 * middle of the three: a release that needs evacuation and one that needs watching are both one
 * tap away from it.
 */
export const DEFAULT_RELEASE_LEVEL: ReleaseLevel = "warning";

export function isReleaseLevel(value: unknown): value is ReleaseLevel {
  return typeof value === "string" && (RELEASE_LEVELS as readonly string[]).includes(value);
}

/**
 * A Bangkok wall-clock string from a form, as an instant. `<input type="datetime-local">` gives
 * "2026-10-13T14:30" with no zone, and the person typing it is reading a Bangkok clock, so it is
 * read as +07:00 whatever the laptop is set to (the owner works in UTC+3).
 */
export function bangkokInput(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const at = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+07:00`);
  return Number.isFinite(at.getTime()) ? at : null;
}

/** The same the other way round, to put a time into a `datetime-local` field. */
export function bangkokValue(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
