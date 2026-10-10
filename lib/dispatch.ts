/**
 * The authority console's own arithmetic (spec 5.2). Pure, so the console's behaviour is decided
 * by tested functions: what state a case is in, how long is left on an offer, how a case is
 * sorted, and where "Navigate" points.
 */

export type EtaBand = "under15" | "to30" | "to60" | "over60" | "unknown";

/** The bands a team may give, in the order they are offered. */
export const ETA_BANDS: EtaBand[] = ["under15", "to30", "to60", "over60", "unknown"];

/** The one-tap reasons for declining. Free text is never asked for in the middle of a flood. */
export const DECLINE_REASONS = ["too_far", "no_boat", "already_out", "cannot"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export type BoardCase = {
  sosId: string;
  createdAt: string;
  status:
    "received" | "assigned" | "en_route" | "on_site" | "rescued" | "safe_cancelled" | "dismissed";
  hazard: string;
  lat: number;
  lon: number;
  accuracyM: number | null;
  locationText: string | null;
  tambon: string | null;
  tambonNameTh: string | null;
  tambonNameEn: string | null;
  peopleCount: number | null;
  vulnerableFlags: Record<string, boolean>;
  depthRef: string | null;
  injuries: string | null;
  note: string | null;
  photos: string[];
  voiceUrl: string | null;
  priorityScore: number;
  hasPhone: boolean;
  suspectedSpam: boolean;
  waitingMinutes: number;
  claimedBy: string | null;
  claimedByName: string | null;
  claimedIsMine: boolean;
  etaBand: EtaBand | null;
  etaGivenAt: string | null;
  offeredTo: string | null;
  offeredIsMine: boolean;
  offerExpiresAt: string | null;
  offerExhausted: boolean;
  myResponse: "accepted" | "declined" | "timed_out" | null;
};

/**
 * What a card says it is. Deliberately not the database status: the console cares about what the
 * person reading it should do next.
 */
export type CaseState =
  | "offered_to_me" // my phone is the one ringing
  | "mine" // my unit holds it
  | "held_by_other" // another unit holds it; I can still see it
  | "searching" // the relay is asking somebody else
  | "unanswered" // the queue ran out: nobody has taken it
  | "closed";

export function caseState(c: BoardCase): CaseState {
  if (c.status === "rescued" || c.status === "safe_cancelled" || c.status === "dismissed") {
    return "closed";
  }
  if (c.claimedIsMine) return "mine";
  if (c.claimedBy) return "held_by_other";
  if (c.offeredIsMine) return "offered_to_me";
  if (c.offerExhausted) return "unanswered";
  return "searching";
}

/** Seconds left on the offer, never negative. Null when nothing is being offered. */
export function secondsLeft(c: BoardCase, now: number): number | null {
  if (!c.offerExpiresAt) return null;
  const left = Math.round((Date.parse(c.offerExpiresAt) - now) / 1000);
  return left > 0 ? left : 0;
}

/**
 * The order of the board: the case ringing my phone first, then the ones nobody has taken, then
 * by how badly it is going (priority), then by how long the person has waited. A case somebody
 * else holds sinks, and a closed one sinks further.
 */
export function sortCases(cases: BoardCase[]): BoardCase[] {
  const rank: Record<CaseState, number> = {
    offered_to_me: 0,
    unanswered: 1,
    searching: 2,
    mine: 3,
    held_by_other: 4,
    closed: 5,
  };
  return [...cases].sort((a, b) => {
    const byState = rank[caseState(a)] - rank[caseState(b)];
    if (byState !== 0) return byState;
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    return b.waitingMinutes - a.waitingMinutes;
  });
}

/** The vulnerable categories someone ticked, in a fixed order so the card never reshuffles. */
export const VULNERABLE_KEYS = [
  "elderly",
  "bedridden",
  "infant_child",
  "pregnant",
  "disability",
  "needs_medicine",
  "needs_oxygen",
  "needs_dialysis",
] as const;

export function vulnerableKeys(flags: Record<string, boolean>): string[] {
  return VULNERABLE_KEYS.filter((k) => flags?.[k]);
}

/**
 * Directions to the case in the phone's own maps app. A plain URL: no API key, no cost, nothing
 * sent to Google until the responder taps it. The console says beside it that road directions do
 * not know which roads are flooded.
 */
export function directionsHref(lat: number, lon: number): string {
  const to = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(to)}&travelmode=driving`;
}

/** The coordinates as a responder would read them out over a radio. */
export function coordsText(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/** Minutes into hours and minutes, for "waiting 1 h 12 min". */
export function splitMinutes(total: number): { hours: number; minutes: number } {
  const t = Math.max(0, Math.round(total));
  return { hours: Math.floor(t / 60), minutes: t % 60 };
}

/**
 * Whether the console should be making a noise: only while a case is actually being offered to
 * this unit, and only while there is time left on it.
 */
export function shouldAlarm(cases: BoardCase[], now: number): boolean {
  return cases.some((c) => caseState(c) === "offered_to_me" && (secondsLeft(c, now) ?? 0) > 0);
}

/** How stale a reading is allowed to be before the board says so, in milliseconds. */
export const BOARD_STALE_MS = 90_000;
