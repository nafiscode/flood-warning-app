/**
 * Ratings and feedback (A15, spec section 17). Everything here is pure, so the chip lists, the
 * 30-day gate and the rule about when an ask may be shown at all can be tested without a browser.
 *
 * **The codes are the contract.** Each chip has a stable code that is stored in the database and
 * counted; its words live in `messages/*.json`. Rewording a chip must never break its count, and
 * removing a code from this list does not delete the rows that carry it - it only stops it being
 * offered, which is why the public page reads a chip's words through a lookup that tolerates a
 * code it no longer knows.
 */

/** The faces, 1 to 5. Each is shown as a face, a word and a number: never colour alone. */
export const RATINGS = [1, 2, 3, 4, 5] as const;
export type Rating = (typeof RATINGS)[number];

/**
 * "What you love about Jaga": the things Jaga is for (spec 17). `other` is last and always last,
 * because a list that ends in "other" invites the box underneath it.
 */
export const LIKED = [
  "warns_in_time",
  "asking_is_easy",
  "risk_map",
  "safe_places",
  "river_levels",
  "bad_signal",
  "hotlines",
  "easy_language",
  "no_signup",
  "other",
] as const;

/**
 * "What should be better". This list names Jaga's real weak points rather than a flattering set,
 * and it deliberately offers **both** `late_warning` and `too_many_warnings`: a warning system
 * fails in both directions, and only the people living there can say which way it is failing
 * (spec 17, safety rule 8). Do not drop either one to make the numbers look better.
 */
export const IMPROVE = [
  "late_warning",
  "too_many_warnings",
  "area_not_covered",
  "no_team_came",
  "slow_to_open",
  "map_hard_to_read",
  "malay_incomplete",
  "safe_place_wrong",
  "no_notifications",
  "hard_for_elders",
  "other",
] as const;

export type LikedCode = (typeof LIKED)[number];
export type ImproveCode = (typeof IMPROVE)[number];

/** The triage states of an item, in the order an admin walks them (spec 8). */
export const FEEDBACK_STATUSES = ["new", "read", "planned", "done", "wont_do", "hidden"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/** Where a comment stands on its way to the public page. */
export const PUBLIC_STATUSES = ["not_requested", "pending", "approved", "refused"] as const;
export type PublicStatus = (typeof PUBLIC_STATUSES)[number];

/** Where the person was asked. "menu" is the page opened on purpose. */
export const MOMENTS = ["menu", "closed_request", "ended_report", "finished_case", "line"] as const;
export type Moment = (typeof MOMENTS)[number];

/** What the form sends. Nothing in it is required (spec 17). */
export type FeedbackInput = {
  rating: Rating | null;
  liked: string[];
  likedNote: string;
  improve: string[];
  improveNote: string;
  contactOk: boolean;
  contact: string;
  publicOk: boolean;
  displayName: string;
};

export const EMPTY_FEEDBACK: FeedbackInput = {
  rating: null,
  liked: [],
  likedNote: "",
  improve: [],
  improveNote: "",
  contactOk: false,
  contact: "",
  publicOk: false,
  displayName: "",
};

/** Whether there is anything at all to send. A form with nothing in it is not an error. */
export function hasAnswer(input: FeedbackInput): boolean {
  return (
    input.rating !== null ||
    input.liked.length > 0 ||
    input.improve.length > 0 ||
    input.likedNote.trim() !== "" ||
    input.improveNote.trim() !== ""
  );
}

/**
 * Only a comment with words in it can be shown on the page, so the "show this on Jaga's feedback
 * page" tick is offered only once there are words. A bare rating has nothing to publish.
 */
export function canBePublic(input: FeedbackInput): boolean {
  return input.likedNote.trim() !== "" || input.improveNote.trim() !== "";
}

/** A chip set with one code turned on or off. `other` is an ordinary chip here. */
export function toggle(chosen: string[], code: string): string[] {
  return chosen.includes(code) ? chosen.filter((c) => c !== code) : [...chosen, code];
}

// ── The quiet asks ───────────────────────────────────────────────────────────

/** Asked once, and never again within 30 days on that phone (spec 17). */
export const ASK_GAP_MS = 30 * 24 * 3_600_000;

/** The phone's memory of the ask: when it was last shown, and whether it was answered. */
export type AskMemory = { shownAt: number; sent?: boolean };

/**
 * Whether a quiet ask may be shown at this moment. The order of these checks is the safety rule:
 *
 *  - **`tense`** - the person's own area or a watched place is at Warning or Evacuate. Nothing
 *    invites anybody to rate an app while their village is being told to leave (spec 17, and the
 *    same discipline as the donation rules, safety rule 9). This is first because it overrides
 *    everything else, including a moment that would otherwise be fine.
 *  - **`quietScreen`** - an SOS, food-and-water, report or alert screen. The ask never appears
 *    there, whatever else is true.
 *  - the 30-day gap on this phone.
 *
 * `shownAt` of null is a phone that has never been asked.
 */
export function askAllowed(input: {
  tense: boolean;
  quietScreen: boolean;
  shownAt: number | null;
  now: number;
}): boolean {
  if (input.tense || input.quietScreen) return false;
  if (input.shownAt === null) return true;
  // A clock that has been moved backwards must not open the gate; treat it as just asked.
  if (input.shownAt > input.now) return false;
  return input.now - input.shownAt >= ASK_GAP_MS;
}

/**
 * The screens an ask or a link to the feedback page never appears on (spec 17): asking for help,
 * asking for food and water, reporting, and the pages where an alert is read. The feedback page
 * itself is not in the list: it stays reachable at its address throughout - it is the invitation
 * that stops, not the door.
 *
 * `/flood` is here because a place's page is where its alert is read.
 *
 * **"Never while a request is open" is not in this list**, because it is not a question about the
 * address: the pages where a person or a team reads how a request is going are allowed to carry
 * the ask once nothing of theirs is still open, which is exactly the moment spec 17 asks for. The
 * caller passes that as the ask's `when`.
 */
const QUIET_SCREENS = /^\/(sos|supplies|report|flood)(\/|$)/;

/** Whether this address is one of the screens above. Takes a path without its language prefix. */
export function quietScreen(path: string): boolean {
  return QUIET_SCREENS.test(path);
}

/**
 * The screen a piece of feedback is about, as a short stable code: the address with its language
 * prefix and its ids taken off, so "/th/flood/950101" and "/en/flood/940201" are one screen.
 * Admins group the ratings by this, so it has to stay comparable between releases.
 */
export function screenCode(pathname: string): string {
  const path = pathname.replace(/^\/(en|ms|th)(?=\/|$)/, "") || "/";
  const trimmed = path.replace(/\/+$/, "") || "/";
  return (
    trimmed
      // An id, a code or a uuid in the path is not part of the screen's name.
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "/:id")
      .replace(/\/\d{4,}/g, "/:id")
      .slice(0, 120) || "/"
  );
}

// ── The published figures ────────────────────────────────────────────────────

export type ChipCount = { code: string; count: number };
export type ImproveCount = ChipCount & {
  /** What was done about it, per language, as an admin wrote it. */
  done?: Record<string, string> | null;
  changeRef?: string | null;
};
export type MonthFigure = {
  month: string;
  answers: number;
  enough: boolean;
  average: number | null;
};
export type PublicFigures = {
  minAnswers: number;
  answers: number;
  rated: number;
  enough: boolean;
  average: number | null;
  months: MonthFigure[];
  liked: ChipCount[];
  improve: ImproveCount[];
};

export type PublicComment = {
  id: string;
  month: string;
  displayName: string | null;
  rating: number | null;
  liked: string[];
  likedNote: string | null;
  improve: string[];
  improveNote: string | null;
};

/** What was done about a chip, in the reader's language, falling back to Thai. */
export function outcomeText(
  done: Record<string, string> | null | undefined,
  locale: string,
): string | null {
  if (!done) return null;
  return done[locale] ?? done.th ?? done.en ?? null;
}

/**
 * How many more answers a period needs before anything may be published. Shown instead of a
 * number, because "we are 8 answers short" is itself an honest figure (spec 17).
 */
export function answersShort(figures: Pick<PublicFigures, "answers" | "minAnswers">): number {
  return Math.max(0, figures.minAnswers - figures.answers);
}
