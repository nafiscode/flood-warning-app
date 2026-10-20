import type { AbstractIntlMessages } from "next-intl";
import type { SafePlaceStatus, SafePlaceType } from "@/lib/places";

/**
 * Place checks (owner, 20 Oct): somebody was at a safe place and said what it was like. The
 * shapes the screens use, and when a check has gone stale.
 *
 * Two facts are kept apart on purpose. Whether the *record* is true - it exists, the capacity is
 * about right, the ground floor went under in 2024 - is `verification_status`, structural, good
 * for a season. Whether the place is good *right now* - open, full, water inside - is a check,
 * and it perishes in hours. A check is never a verdict: it is shown as a fact with a time and
 * who said it, because "verified" on a resident's screen reads as "safe to go".
 */

/** Who said it. A resident's check is written by the later phase. */
export const CHECK_SOURCES = ["admin", "team", "resident"] as const;
export type CheckSource = (typeof CHECK_SOURCES)[number];

/** Where the water is, seen from the doorway. */
export const PLACE_WATER = ["dry", "around", "inside"] as const;
export type PlaceWater = (typeof PLACE_WATER)[number];

/** The same three answers a flood report gives about a road (spec 4.5). */
export const PLACE_ROADS = ["car", "motorbike_only", "impassable"] as const;
export type PlaceRoad = (typeof PLACE_ROADS)[number];

/** What a team may say a place is. 'unknown' is not offered: a check that says nothing is not one. */
export const CHECK_STATES = ["open", "full", "closed"] as const;
export type CheckState = (typeof CHECK_STATES)[number];

/**
 * How long a check stays good where this level is in force. The same table as
 * `place_check_window` in the database, kept here so a screen can say "not checked since" with
 * no extra request; the database is the one that decides what is overdue in a list.
 */
export const CHECK_WINDOW_MS: Record<string, number> = {
  evacuate: 2 * 60 * 60 * 1000,
  warning: 6 * 60 * 60 * 1000,
  watch: 24 * 60 * 60 * 1000,
  normal: 7 * 24 * 60 * 60 * 1000,
  return: 7 * 24 * 60 * 60 * 1000,
};

export const checkWindowMs = (level: string | null | undefined): number =>
  CHECK_WINDOW_MS[level ?? "normal"] ?? CHECK_WINDOW_MS.normal!;

/**
 * What a card says about the last check.
 * - `never`: nobody has been. Say so plainly; it is not the same as "fine".
 * - `fresh`: checked, and still inside the window.
 * - `stale`: checked, but longer ago than the level allows. The place keeps its status and gets
 *   a grey marker beside it - stale is a marker, never a downgrade and never hidden
 *   (safety rule 3 treats an alert the same way).
 */
export type Freshness =
  | { state: "never" }
  | { state: "fresh"; at: string; source: CheckSource }
  | { state: "stale"; at: string; source: CheckSource };

/**
 * `dueAt` is when the check goes stale, worked out by the database from the level in force where
 * the place is. It is an absolute instant, so a card cached for offline use still knows when its
 * own reading went stale (safety rule 7). Without one, the window is worked out from the level.
 */
export function freshness(input: {
  checkedAt: string | null | undefined;
  source: CheckSource | null | undefined;
  dueAt?: string | null;
  level?: string | null;
  now?: Date;
}): Freshness {
  const { checkedAt, source, dueAt, level } = input;
  if (!checkedAt || !source) return { state: "never" };
  const at = Date.parse(checkedAt);
  if (!Number.isFinite(at)) return { state: "never" };
  const due = dueAt ? Date.parse(dueAt) : at + checkWindowMs(level);
  const now = (input.now ?? new Date()).getTime();
  const stale = !Number.isFinite(due) ? false : now > due;
  return { state: stale ? "stale" : "fresh", at: checkedAt, source };
}

/** One place on a team's round list, oldest check first. */
export type RoundPlace = {
  id: string;
  name: Record<string, string>;
  type: SafePlaceType;
  tambon: string;
  tambonTh: string;
  tambonEn: string;
  lat: number;
  lon: number;
  status: SafePlaceStatus;
  verified: boolean;
  capacity: number | null;
  needs: string | null;
  checkedAt: string | null;
  checkedSource: CheckSource | null;
  /** When that check goes stale, from the level in force where the place is. */
  dueAt: string | null;
  /** The level in force where the place is, which sets how long a check stays good. */
  level: string;
  /** Was the last check this team's own? The list is a round shared with other teams. */
  mine: boolean;
  /** What residents have said lately. A disputed place is first in the round list. */
  residentsSaid: ResidentsSaid | null;
};

type Row = Record<string, unknown>;

export function toRoundPlace(r: Row): RoundPlace | null {
  if (typeof r.place_id !== "string") return null;
  const text = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  const source = CHECK_SOURCES.find((s) => s === r.checked_source) ?? null;
  return {
    id: r.place_id,
    name: (r.name ?? {}) as Record<string, string>,
    type: r.type as SafePlaceType,
    tambon: String(r.tambon ?? ""),
    tambonTh: String(r.tambon_th ?? ""),
    tambonEn: String(r.tambon_en ?? ""),
    lat: Number(r.lat),
    lon: Number(r.lon),
    status: (r.status ?? "unknown") as SafePlaceStatus,
    verified: r.verification_status === "verified",
    capacity: typeof r.capacity === "number" ? r.capacity : null,
    needs: text(r.needs),
    checkedAt: text(r.checked_at),
    checkedSource: source,
    dueAt: text(r.check_due_at),
    level: String(r.level ?? "normal"),
    mine: r.mine === true,
    residentsSaid: toResidentsSaid(r.residents_said),
  };
}

/** What the round list is sent, and what one check says. */
export type CheckForm = {
  open: CheckState;
  water: PlaceWater | null;
  road: PlaceRoad | null;
  needs: string;
};

export const CHECKS_URL = "/api/authority/places";

/**
 * How overdue a place is, in whole hours past its window; 0 while it is still good and null when
 * nobody has ever been. Only for ordering and for "longest unchecked" on the round list - it is
 * never shown to a resident as a number.
 */
export function overdueHours(p: RoundPlace, now: Date = new Date()): number | null {
  if (!p.checkedAt) return null;
  const due = p.dueAt ? Date.parse(p.dueAt) : Date.parse(p.checkedAt) + checkWindowMs(p.level);
  const past = now.getTime() - due;
  return past <= 0 ? 0 : Math.floor(past / (60 * 60 * 1000));
}

/**
 * The words the round list needs in the browser. The three about the road are the flood report's
 * own (spec 4.5) - the same three answers, so they are asked in the same words - but copied into
 * this namespace rather than pulling all 47 report keys onto a screen that needs four of them. A
 * test pins them equal to their source.
 */
export function placeChecksMessages(messages: AbstractIntlMessages): AbstractIntlMessages {
  const all = messages as Record<string, AbstractIntlMessages>;
  return { placeChecks: all.placeChecks!, places: all.places! };
}

/**
 * What residents have said about a place lately: counts of people, never who they are. Null when
 * nobody has said anything inside the window (12 h, or the place's own shorter window under a
 * warning or an evacuate).
 *
 * This never becomes the badge. A false "closed" turns people away from a dry shelter and a
 * false "open" sends somebody into a flooded one, so what residents say is drawn as its own
 * attributed line and the status above it is only ever moved by an admin or by a team covering
 * the place (migration ..a10_resident_place_checks).
 */
export type ResidentsSaid = {
  /** How many different people said each thing. One person repeating themselves counts once. */
  counts: Partial<Record<SafePlaceStatus, number>>;
  people: number;
  latest: string | null;
  /** Two or more people disagreeing with what the card says. One person is never a dispute. */
  disputed: boolean;
};

export function toResidentsSaid(value: unknown): ResidentsSaid | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const counts: Partial<Record<SafePlaceStatus, number>> = {};
  const from = (raw.counts ?? {}) as Record<string, unknown>;
  for (const state of ["open", "full", "closed", "unknown"] as const) {
    const n = Number(from[state]);
    if (Number.isFinite(n) && n > 0) counts[state] = Math.trunc(n);
  }
  const people = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (people === 0) return null;
  return {
    counts,
    people,
    latest: typeof raw.latest === "string" ? raw.latest : null,
    disputed: raw.disputed === true,
  };
}

/** The one thing most people said, for the single line a card has room for. */
export function loudest(said: ResidentsSaid): { state: SafePlaceStatus; people: number } {
  const entries = Object.entries(said.counts) as [SafePlaceStatus, number][];
  // Sorted so the answer cannot depend on the order the database happened to return.
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [state, people] = entries[0]!;
  return { state, people };
}

/** Where a resident sends their own check. The team's round list has its own address. */
export const RESIDENT_CHECK_URL = "/api/places/check";
