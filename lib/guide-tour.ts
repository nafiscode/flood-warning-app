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
