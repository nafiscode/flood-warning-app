/**
 * The guide tour (the owner, 24 Oct 2026, from A16 in docs/prompts.md): a short introduction to
 * the buttons and sections on a page, for residents and rescue teams (not admins).
 *
 * It explains; it never asks anything of the person. It opens by itself on the first visit to a
 * page, stays out of the way (nothing is dimmed or blocked, every tap still reaches the page),
 * and once closed, by any means, it does not open again by itself. The "Show me around" button
 * on the page opens it whenever they want.
 *
 * Steps point at real elements by selector. A step whose element is not on the page (a button
 * that only a signed-in person sees, a panel the layout folds away) is skipped, so the same tour
 * serves every role and every screen size. tests/unit/guide-tour.test.ts fails when a selector
 * names an attribute that no component draws any more.
 */
export type GuideStep = {
  /** The words in messages `guide.<tour>.<step>.title` / `.body`. */
  id: string;
  /** CSS selector; the first visible match is the one pointed at. */
  target: string;
};

export type GuideTour = {
  id: string;
  /** Matches the path without its language prefix. */
  path: RegExp;
  /**
   * Pages where someone may be asking for help or reporting: the tour never opens by itself
   * there (safety rule 1 keeps every step out of the way of help), only from its button.
   */
  manualOnly?: boolean;
  steps: GuideStep[];
};

export const GUIDE_TOURS: GuideTour[] = [
  {
    id: "home",
    path: /^\/$/,
    steps: [
      { id: "sos", target: '[data-tour="sos"]' },
      { id: "hero", target: "[data-hero]" },
      { id: "area", target: "[data-area-chooser]" },
      { id: "watched", target: "[data-watched]" },
      { id: "map", target: "[data-map-cta]" },
      { id: "supplies", target: "[data-supplies-link]" },
      { id: "bell", target: "[data-notice-bell]" },
      { id: "weather", target: "[data-weather-chip]" },
      { id: "hotlines", target: '[data-tour="hotlines"]' },
      { id: "tabs", target: "[data-phone-tabs]" },
    ],
  },
  {
    id: "map",
    path: /^\/map$/,
    steps: [
      { id: "frame", target: "[data-map-frame]" },
      { id: "zoomAll", target: "[data-zoom-all]" },
      { id: "zoomMine", target: "[data-zoom-mine]" },
      { id: "full", target: '[data-map-full-toggle="open"]' },
      { id: "layers", target: '[data-phone-pill="layers"], [data-console-rail]' },
      { id: "place", target: '[data-phone-pill="place"]' },
      { id: "sky", target: "[data-sky-bar]" },
      { id: "features", target: "[data-map-features]" },
      { id: "outlook", target: "[data-season-outlook]" },
    ],
  },
  {
    id: "account",
    path: /^\/account$/,
    steps: [
      { id: "signIn", target: "[data-sign-in-offer]" },
      { id: "setup", target: 'a[href$="/account/setup"]' },
      { id: "requests", target: "[data-requests-link]" },
      { id: "places", target: 'a[href$="/account/places"]' },
      { id: "household", target: "[data-household-link]" },
      { id: "myCases", target: "[data-my-cases-link]" },
      { id: "console", target: 'a[href$="/authority"]' },
      { id: "register", target: 'a[href$="/authority/register"]' },
      { id: "join", target: "[data-join-link]" },
      { id: "signOut", target: "[data-sign-out]" },
    ],
  },
  {
    id: "requests",
    path: /^\/requests$/,
    steps: [
      { id: "list", target: "[data-my-requests]" },
      { id: "journey", target: "[data-journey]" },
    ],
  },
  {
    id: "supplies",
    path: /^\/supplies$/,
    manualOnly: true,
    steps: [
      { id: "people", target: "[data-supplies-people]" },
      { id: "location", target: "[data-supplies-location]" },
      { id: "note", target: "[data-supplies-note]" },
      { id: "send", target: "[data-supplies-send]" },
    ],
  },
  {
    id: "report",
    path: /^\/report$/,
    manualOnly: true,
    steps: [
      { id: "location", target: "[data-report-location]" },
      { id: "depth", target: "[data-report-depth]" },
      { id: "send", target: "[data-report-send]" },
    ],
  },
  {
    id: "notVerified",
    path: /^\/authority$/,
    steps: [{ id: "waiting", target: '[data-tour="not-verified"]' }],
  },
  {
    id: "console",
    path: /^\/authority$/,
    steps: [
      { id: "tools", target: "[data-team-tools]" },
      { id: "status", target: "[data-alarm]" },
      { id: "duty", target: "[data-duty]" },
      { id: "views", target: "[data-console-view]" },
      { id: "cases", target: "[data-case]" },
      { id: "advance", target: "[data-advance]" },
      { id: "navigate", target: "[data-navigate]" },
      { id: "phone", target: "[data-show-phone]" },
      { id: "complete", target: "[data-complete]" },
      { id: "release", target: "[data-release]" },
      { id: "team", target: "[data-team-link]" },
    ],
  },
  {
    id: "mine",
    path: /^\/authority\/mine$/,
    steps: [
      { id: "cases", target: "[data-my-case]" },
      { id: "navigate", target: "[data-navigate]" },
      { id: "phone", target: "[data-show-phone]" },
      { id: "advance", target: "[data-advance]" },
      { id: "complete", target: "[data-complete]" },
      { id: "open", target: "[data-open-cases]" },
    ],
  },
  {
    id: "team",
    path: /^\/authority\/team$/,
    steps: [
      { id: "waiting", target: "[data-team-waiting]" },
      { id: "invite", target: "[data-invite]" },
    ],
  },
  {
    id: "join",
    path: /^\/authority\/join$/,
    steps: [{ id: "code", target: "[data-join-code]" }],
  },
  {
    id: "register",
    path: /^\/authority\/register$/,
    steps: [{ id: "form", target: "form" }],
  },
  {
    id: "fieldRescue",
    path: /^\/authority\/field-rescue$/,
    manualOnly: true,
    steps: [
      { id: "position", target: "[data-field-position]" },
      { id: "photos", target: "[data-field-photos]" },
      { id: "send", target: "[data-field-send]" },
    ],
  },
];

/** The path without its language prefix: `/th/map` -> `/map`, `/th` -> `/`. */
export function bare(pathname: string): string {
  const stripped = pathname.replace(/^\/(th|ms|en)(?=\/|$)/, "");
  const clean = stripped.length > 1 ? stripped.replace(/\/$/, "") : stripped;
  return clean === "" ? "/" : clean;
}

/** Every tour that belongs to this page (the team page has two: waiting, and verified). */
export function toursFor(pathname: string): GuideTour[] {
  const path = bare(pathname);
  return GUIDE_TOURS.filter((tour) => tour.path.test(path));
}

/** Never on the SOS screens: nothing stands between a person and a request for help. */
export const NO_TOUR = /^\/sos(\/|$)/;

const KEY = "jaga.guide.v2";

/** The key a step is remembered by. */
export const stepKey = (tour: string, step: string) => `${tour}.${step}`;

/**
 * Which steps this device has been shown. It is kept per step, not per tour: a button that only
 * appears later (after sign-in, once a team is verified) is a first sighting when it first
 * appears, however often the page was visited before. Storage may be blocked: then none are.
 */
export function readSeen(): Record<string, true> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, true>) : {};
  } catch {
    return {};
  }
}

export function markSeen(keys: string[]): void {
  try {
    const seen: Record<string, true> = readSeen();
    for (const key of keys) seen[key] = true;
    window.localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    // Blocked storage: the tour will open once more on the next visit, which harms nobody.
  }
}

/** A rectangle in window coordinates. */
export type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * Where the tour's card sits: pinned under the header, pinned above the hotline bar, or beside
 * the thing it points at.
 */
export type CardPlace =
  | { how: "top"; top: number }
  | { how: "bottom"; bottom: number }
  | { how: "beside"; left: number; top: number; width: number };

/** Room kept between the card and the outline of what it points at, in px. */
const GAP = 14;

const overlaps = (a: Rect, b: Rect, gap: number) =>
  a.left < b.right + gap &&
  a.right > b.left - gap &&
  a.top < b.bottom + gap &&
  a.bottom > b.top - gap;

/**
 * Where the card goes so that it never covers the thing it is about (Apple's guidance for a
 * popover that annotates something: the annotated thing stays visible, controls included).
 *
 * The card used to sit centred at the top or the bottom of the window, whichever half the target
 * was not in. That is right for a small target - a readout, a button - and wrong for a tall one:
 * the map fills most of the window on an iPad, so the card landed on top of it, and in portrait
 * on top of the map's own toolbar, the very buttons the tour goes on to describe.
 *
 * So the old choice is kept whenever it is clear of the target, and changes only when it is not:
 * first the other side of the window, then **beside** the target if there is room for the whole
 * card (a landscape iPad has about 400 px free to the right of the map), and only when the target
 * leaves nothing - a portrait iPad - the bottom edge, which leaves the toolbar and the zoom
 * buttons at the top of the map in the clear.
 *
 * Pure so that it can be tested: nothing here reads the page.
 */
export function placeCard(input: {
  /** The part of the target that is on the screen, or null when it has none. */
  ring: Rect | null;
  /** The bottom edge of the frozen header. */
  head: number;
  /** The top edge of the hotline bar. */
  foot: number;
  viewport: { width: number; height: number };
  card: { width: number; height: number };
}): CardPlace {
  const { ring, head, foot, viewport, card } = input;
  const top: CardPlace = { how: "top", top: head + 8 };
  const bottom: CardPlace = { how: "bottom", bottom: viewport.height - foot + 8 };
  if (!ring) return top;

  const left = Math.max(8, (viewport.width - card.width) / 2);
  const box = (place: CardPlace): Rect => {
    if (place.how === "beside") {
      return {
        left: place.left,
        top: place.top,
        right: place.left + place.width,
        bottom: place.top + card.height,
      };
    }
    const y = place.how === "top" ? place.top : viewport.height - place.bottom - card.height;
    return { left, top: y, right: left + card.width, bottom: y + card.height };
  };
  const clear = (place: CardPlace) => !overlaps(box(place), ring, GAP);

  const lowerHalf = (ring.top + ring.bottom) / 2 >= (head + foot) / 2;
  const [first, second] = lowerHalf ? [top, bottom] : [bottom, top];
  if (clear(first)) return first;
  if (clear(second)) return second;

  const roomEnd = viewport.width - 8 - (ring.right + GAP);
  const roomStart = ring.left - GAP - 8;
  if (Math.max(roomEnd, roomStart) >= card.width) {
    const x = roomEnd >= roomStart ? ring.right + GAP : ring.left - GAP - card.width;
    const y = Math.min(Math.max(ring.top, head + 8), Math.max(head + 8, foot - 8 - card.height));
    return { how: "beside", left: x, top: y, width: card.width };
  }
  return bottom;
}
