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

/** The one-tap reasons for giving a case back. The database only asks that there is one. */
export const RELEASE_REASONS = ["cannot_reach", "no_boat", "other_emergency", "cannot"] as const;
export type ReleaseReason = (typeof RELEASE_REASONS)[number];

/** A village near a case: the team's board names it, so a crew can ask the way there. */
export type CaseVillage = { nameTh: string; nameEn: string | null; distanceM: number };

/** How far, in words a crew can use: to 50 m under a kilometre, else to 0.1 km. */
export function villageDistance(m: number): { unit: "m" | "km"; value: number } {
  if (m < 1000) return { unit: "m", value: Math.max(50, Math.round(m / 50) * 50) };
  return { unit: "km", value: Math.round(m / 100) / 10 };
}

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
  /** The name of the unit the relay is asking now, for "being offered to [unit]" (spec 5.2). */
  offeredToName: string | null;
  offeredIsMine: boolean;
  offerExpiresAt: string | null;
  offerExhausted: boolean;
  myResponse: "accepted" | "declined" | "timed_out" | null;
  /** Set only by a confirmation. "rescued" without it is a rescue nobody has confirmed yet. */
  closedAt: string | null;
  /** When the team holding the case reported the rescue. */
  completedAt: string | null;
  /** How many evidence photos the team attached. The photos themselves are asked for by a tap. */
  proofCount: number;
  /** The nearest village to the case's point, within 5 km (S3 villages, 16 Oct); absent when none. */
  village?: CaseVillage | null;
  /** The waiting time has passed and this caller is not the reporting team (spec 5.4). */
  canConfirm: boolean;
  /** A rescue, or a request for food, water and essentials from someone who is safe (spec 4.10). */
  kind: "rescue" | "supplies";
  /** What a supply request asks for, from the fixed list in lib/sos.ts. */
  needs: string[];
  needsNote: string | null;
  /** How long what they have will last: "none", "today" or "days". */
  suppliesLeft: string | null;
};

/** What a card shows once its photos and voice note were asked for: short-lived links. */
export type CaseMedia = { photos: string[]; voice: string | null; proof: string[] };

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
  | "awaiting" // a team reported the rescue; nobody has confirmed it yet
  | "closed";

export function caseState(c: BoardCase): CaseState {
  if (c.status === "rescued" && !c.closedAt) return "awaiting";
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
    awaiting: 4.5,
    closed: 5,
  };
  // A supply request nobody holds comes after every rescue case nobody holds: on a board that
  // has both, the lives are read first.
  const waitingSupplies: Partial<Record<CaseState, number>> = {
    offered_to_me: 2.1,
    unanswered: 2.2,
    searching: 2.3,
  };
  // A case this team has just accepted and not yet given an estimate for stays right under the
  // ringing one: the card is asking a question, and it must not drop out of sight to be asked.
  // A reported rescue this team may now confirm is a job waiting for it, so it rises too.
  const place = (c: BoardCase) =>
    caseState(c) === "mine" && c.etaBand === null
      ? 0.5
      : caseState(c) === "awaiting" && c.canConfirm
        ? 2.5
        : c.kind === "supplies"
          ? (waitingSupplies[caseState(c)] ?? rank[caseState(c)])
          : rank[caseState(c)];
  return [...cases].sort((a, b) => {
    const byState = place(a) - place(b);
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
 * Whether the console should be making a noise: only while a rescue case is actually being
 * offered to this unit, and only while there is time left on it. A supply request never rings
 * the alarm (decision of 13 October): it has a sound of its own, played once.
 */
export function shouldAlarm(cases: BoardCase[], now: number): boolean {
  return cases.some(
    (c) =>
      c.kind !== "supplies" && caseState(c) === "offered_to_me" && (secondsLeft(c, now) ?? 0) > 0,
  );
}

/** The supply requests being offered to this unit now, for the one soft sound each gets. */
export function supplyOffers(cases: BoardCase[], now: number): string[] {
  return cases
    .filter(
      (c) =>
        c.kind === "supplies" && caseState(c) === "offered_to_me" && (secondsLeft(c, now) ?? 0) > 0,
    )
    .map((c) => c.sosId);
}

/** How stale a reading is allowed to be before the board says so, in milliseconds. */
export const BOARD_STALE_MS = 90_000;

/** One of the caller's own verified units, for the on-duty switch and the phone tick. */
export type MyUnit = {
  id: string;
  name: string;
  orgName: string;
  onDuty: boolean;
  sharesPocPhone: boolean;
};

/** Everything the console draws. `readAt` is the server's clock, which the countdown follows. */
export type AuthorityBoard = { cases: BoardCase[]; units: MyUnit[]; readAt: string };

/**
 * What the team holding a case reports next: on the way, then arrived. Null when there is nothing
 * further to report from here (closing a case is the requester's word, or a later step).
 */
export function nextStep(c: BoardCase): "en_route" | "on_site" | null {
  if (!c.claimedIsMine) return null;
  if (c.status === "assigned") return "en_route";
  if (c.status === "en_route") return "on_site";
  return null;
}

/** A team may report the rescue from any step after accepting: nobody taps every step. */
export function canReportRescue(c: BoardCase): boolean {
  return (
    c.claimedIsMine &&
    (c.status === "assigned" || c.status === "en_route" || c.status === "on_site")
  );
}

/** Whole hours since the team reported the rescue, for "reported 13 h ago". */
export function hoursSince(iso: string | null, now: number): number {
  if (!iso) return 0;
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 3_600_000));
}

/** The card keeps asking for an arrival estimate until one is given (spec 5.2). */
export function needsEta(c: BoardCase): boolean {
  return caseState(c) === "mine" && c.etaBand === null;
}

/** The countdown as it is drawn: 1:05, 0:42. */
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type BoardScope = "open" | "closed";
export type BoardKind = "all" | "rescue" | "supplies";

/**
 * The board's own filter (spec 5.1): open or closed cases, one tambon, vulnerable people only,
 * and one kind of request.
 */
export function filterCases(
  cases: BoardCase[],
  filter: {
    scope: BoardScope;
    tambon: string | null;
    vulnerableOnly: boolean;
    kind?: BoardKind;
  },
): BoardCase[] {
  return cases.filter((c) => {
    const closed = caseState(c) === "closed";
    if ((filter.scope === "closed") !== closed) return false;
    if (filter.kind && filter.kind !== "all" && c.kind !== filter.kind) return false;
    if (filter.tambon && c.tambon !== filter.tambon) return false;
    if (filter.vulnerableOnly && vulnerableKeys(c.vulnerableFlags).length === 0) return false;
    return true;
  });
}

/** The tambons that have a case on the board, for the filter. Sorted so the list never jumps. */
export function tambonsOnBoard(cases: BoardCase[]): { code: string; th: string; en: string }[] {
  const seen = new Map<string, { code: string; th: string; en: string }>();
  for (const c of cases) {
    if (c.tambon && !seen.has(c.tambon)) {
      seen.set(c.tambon, {
        code: c.tambon,
        th: c.tambonNameTh ?? c.tambon,
        en: c.tambonNameEn ?? c.tambon,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.code.localeCompare(b.code));
}
