import type { DamSignal } from "@/lib/dam";
/**
 * The admins' war room: the shapes the screen reads, and the arithmetic behind the triage. Pure
 * functions only, so the rules that decide "nobody has answered this for 23 minutes" are tested
 * on their own and the same numbers come out on the server and in the browser.
 *
 * Nothing here holds a phone number. The board carries only `hasPhone`; a number is asked for
 * one case at a time through the logged reveal function (safety rule 5).
 */

export type SosCaseStatus =
  "received" | "assigned" | "en_route" | "rescued" | "safe_cancelled" | "dismissed";

/** A case on the board, as /api/admin/war-room sends it. */
export type SosCase = {
  id: string;
  createdAt: string;
  closedAt: string | null;
  status: SosCaseStatus;
  hazard: string;
  lat: number | null;
  lon: number | null;
  accuracyM: number | null;
  locationText: string | null;
  tambon: string | null;
  tambonTh: string | null;
  tambonEn: string | null;
  districtTh: string | null;
  provinceTh: string | null;
  provinceCode: string | null;
  peopleCount: number | null;
  vulnerable: Record<string, boolean>;
  depth: string | null;
  injuries: string | null;
  note: string | null;
  photos: number;
  hasVoice: boolean;
  batteryPct: number | null;
  onBehalf: boolean;
  onBehalfNote: string | null;
  hasPhone: boolean;
  requesterName: string | null;
  priority: number;
  suspectedSpam: boolean;
  spamDismissedAt: string | null;
  duplicateOf: string | null;
  possibleDuplicateOf: string | null;
  mergedIn: number;
  unitId: string | null;
  unitName: string | null;
  orgName: string | null;
  claimedAt: string | null;
  lastEvent: string | null;
  lastEventAt: string | null;
  unitsCovering: number;
};

export type Overview = {
  people: number;
  peopleNew7d: number;
  peopleWithHome: number;
  watchedPlaces: number;
  watchedNotify: number;
  unitsVerified: number;
  unitsPending: number;
  tambonsCovered: number;
  tambonsTotal: number;
  tambonsUncovered: number;
  sosOpen: number;
  sosWaiting: number;
  sosOverdue: number;
  sosWorking: number;
  sos24h: number;
  sosClosed24h: number;
  sosSpamOpen: number;
  oldestWaitingAt: string | null;
  reports72h: number;
  reportsPending: number;
  unclaimedMinutes: number;
};

export type WarRoomBoard = {
  now: number;
  overview: Overview;
  cases: SosCase[];
  /** The dams and whether one of them is waiting for an admin to judge it (spec section 15). */
  dams: DamBoardRow[];
};

/**
 * One dam as the admins see it: the figures, what the code made of them, and - the only thing
 * here that asks anything of a person - whether a confirmed release is waiting to be reviewed.
 *
 * Code raised the notice; it did not send anything and could not (safety rule 2). What is sent
 * afterwards is the dam release notice of spec section 15, by a person.
 */
export type DamBoardRow = {
  code: string;
  name: Record<string, string>;
  river: Record<string, string>;
  operator: string;
  signal: DamSignal | null;
  notice: {
    id: string;
    status: "open" | "sent" | "dismissed" | "ended";
    raisedAt: string;
    reasons: string[];
    reviewedAt: string | null;
    reviewedByName: string | null;
    note: string | null;
  } | null;
  tambonsMain: number;
  tambonsTributary: number;
  /** How the last hourly fetch went, so a silent feed is visible rather than looking calm. */
  feed: { ok: boolean | null; ranAt: string | null; error: string | null };
};

/** Counts per tambon: how many people live there, how many places are watched there. */
export type WatchedCount = {
  tambon: string;
  tambonTh: string;
  tambonEn: string;
  districtTh: string;
  provinceCode: string;
  places: number;
  notify: number;
  owners: number;
  homes: number;
};

export type PeoplePoint = { lat: number; lon: number; tambon: string | null; role: string };

export type ReportPoint = {
  id: string;
  createdAt: string;
  lat: number | null;
  lon: number | null;
  tambon: string | null;
  tambonTh: string | null;
  depth: string | null;
  trend: string | null;
  roadAccess: string | null;
  moderation: string;
  photos: number;
  anonymous: boolean;
};

export type WarRoomMapData = {
  watched: WatchedCount[];
  people: PeoplePoint[];
  reports: ReportPoint[];
};

/** One registered person, as the People tab reads them. Never a phone number, only `hasPhone`. */
export type Person = {
  userId: string;
  displayName: string;
  role: string;
  locale: string;
  createdAt: string;
  tambon: string | null;
  tambonTh: string | null;
  tambonEn: string | null;
  districtTh: string | null;
  provinceTh: string | null;
  lat: number | null;
  lon: number | null;
  hasPhone: boolean;
  phoneVerified: boolean;
  hasLine: boolean;
  watchedPlaces: number;
  sosSent: number;
  reportsSent: number;
};

export type PeoplePage = { rows: Person[]; total: number; search: string; offset: number };

/** A line in a case's history (sos_events), with the unit and the actor named. */
export type HistoryRow = {
  at: string;
  event: string;
  note: string | null;
  unitName: string | null;
  actorName: string | null;
  photos: number;
};

export type UnitOption = {
  id: string;
  unitName: string;
  orgName: string;
  orgType: string;
  capabilities: string[];
  openCases: number;
};

/**
 * Where a case stands, from the war room's point of view. Only four states, because only four
 * things can be done about one:
 *  - `overdue`: open, nobody has accepted it, and it has waited longer than the setting. Act now.
 *  - `waiting`: open, nobody has accepted it yet, still inside the window.
 *  - `working`: a unit holds it. Watch it.
 *  - `closed`: rescued, cancelled by the sender, or dismissed. Nothing to do.
 * The state is never carried by colour alone: every card shows the icon and the words too.
 */
export type CaseState = "overdue" | "waiting" | "working" | "closed";

const OPEN: SosCaseStatus[] = ["received", "assigned", "en_route"];

export function isOpen(c: SosCase): boolean {
  return OPEN.includes(c.status);
}

/** Minutes since the SOS was sent (or until it was closed). Never negative. */
export function ageMinutes(c: SosCase, now: number): number {
  const end = c.closedAt ? Date.parse(c.closedAt) : now;
  return Math.max(0, Math.floor((end - Date.parse(c.createdAt)) / 60_000));
}

/** Minutes the case has waited with nobody on it: stops when a unit accepts, or at closure. */
export function waitingMinutes(c: SosCase, now: number): number {
  const end = c.claimedAt ? Date.parse(c.claimedAt) : c.closedAt ? Date.parse(c.closedAt) : now;
  return Math.max(0, Math.floor((end - Date.parse(c.createdAt)) / 60_000));
}

export function caseState(c: SosCase, now: number, unclaimedMinutes: number): CaseState {
  if (!isOpen(c)) return "closed";
  if (c.unitId) return "working";
  return waitingMinutes(c, now) >= unclaimedMinutes ? "overdue" : "waiting";
}

/**
 * The order the board is read in: the longest unanswered first, because that is the only queue
 * that costs lives. Priority breaks a tie between two cases of the same age (people counted,
 * vulnerable flags, injuries: sos_priority() in the database).
 */
export function sortCases(cases: SosCase[], now: number, unclaimedMinutes: number): SosCase[] {
  const rank: Record<CaseState, number> = { overdue: 0, waiting: 1, working: 2, closed: 3 };
  return [...cases].sort((a, b) => {
    const byState =
      rank[caseState(a, now, unclaimedMinutes)] - rank[caseState(b, now, unclaimedMinutes)];
    if (byState !== 0) return byState;
    const byWait = waitingMinutes(b, now) - waitingMinutes(a, now);
    if (byWait !== 0) return byWait;
    if (b.priority !== a.priority) return b.priority - a.priority;
    return Date.parse(b.createdAt) - Date.parse(a.createdAt);
  });
}

export type Triage = {
  overdue: SosCase[];
  waiting: SosCase[];
  working: SosCase[];
  closed: SosCase[];
};

/** The board split into the four states, each already in reading order. */
export function triage(cases: SosCase[], now: number, unclaimedMinutes: number): Triage {
  const out: Triage = { overdue: [], waiting: [], working: [], closed: [] };
  for (const c of sortCases(cases, now, unclaimedMinutes)) {
    out[caseState(c, now, unclaimedMinutes)].push(c);
  }
  return out;
}

/** A case nobody can take: open, unanswered, and no verified unit covers its tambon. */
export function hasNoUnit(c: SosCase): boolean {
  return isOpen(c) && !c.unitId && c.unitsCovering === 0;
}

/** The vulnerable flags that are set, as their keys, in a fixed order for a stable read. */
const VULNERABLE_ORDER = [
  "bedridden",
  "needs_oxygen",
  "needs_dialysis",
  "needs_medicine",
  "disability",
  "pregnant",
  "infant_child",
  "elderly",
];
export function vulnerableKeys(flags: Record<string, boolean> | null | undefined): string[] {
  if (!flags) return [];
  const set = Object.keys(flags).filter((k) => flags[k]);
  const known = VULNERABLE_ORDER.filter((k) => set.includes(k));
  return [...known, ...set.filter((k) => !VULNERABLE_ORDER.includes(k)).sort()];
}

/**
 * Cases per hour over the last `hours`, oldest bucket first, for the small bar strip. One series,
 * one hue: a count, not a status.
 */
export function casesPerHour(
  cases: SosCase[],
  now: number,
  hours = 24,
): { from: number; count: number }[] {
  const hour = 3_600_000;
  const start = Math.floor(now / hour) * hour - (hours - 1) * hour;
  const buckets = Array.from({ length: hours }, (_, i) => ({ from: start + i * hour, count: 0 }));
  for (const c of cases) {
    const t = Date.parse(c.createdAt);
    const i = Math.floor((t - start) / hour);
    if (i >= 0 && i < hours) buckets[i]!.count += 1;
  }
  return buckets;
}

/** The highest count in a strip, at least 1, so a bar's height never divides by zero. */
export function peak(buckets: { count: number }[]): number {
  return Math.max(1, ...buckets.map((b) => b.count));
}

/**
 * The tambons that carry the most people, for the "where everyone is" list beside the map.
 * Watched places and homes are counted together: both are someone who expects a warning here.
 */
export function topAreas(counts: WatchedCount[], limit = 8): WatchedCount[] {
  return [...counts]
    .sort((a, b) => b.homes + b.places - (a.homes + a.places) || a.tambon.localeCompare(b.tambon))
    .slice(0, limit);
}

/** "2 ชม. 5 น." style parts for a waiting time; the screen puts the words around them. */
export function splitMinutes(total: number): { hours: number; minutes: number } {
  const t = Math.max(0, Math.floor(total));
  return { hours: Math.floor(t / 60), minutes: t % 60 };
}

/**
 * Google Maps directions to a case, the same link the authority console uses (spec 5.5). It is
 * always paired on screen with the warning that road directions don't know which roads are
 * flooded.
 */
export function directionsHref(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
}
