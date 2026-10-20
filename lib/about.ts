/**
 * "Who built Jaga" (the owner's request, 20 Oct 2026): one public page about the founder and
 * developer, for two readers who arrive with opposite questions.
 *
 * 1. Someone who found the app and does not know whether to trust it. They need to know that the
 *    person behind a flood-warning app has actually done flood work, and they need to be able to
 *    check that for themselves rather than take the page's word for it.
 * 2. Someone who knows the owner personally but has never seen their professional side. For them
 *    the page has to make Jaga look inevitable rather than surprising: every part of this app is
 *    something the owner was already paid to do somewhere else.
 *
 * So the page is a career *line*, not a CV: each step carries one highlighted sentence naming the
 * part of Jaga that came out of it (`CAREER_STEPS[].gave`). It also says plainly what the owner
 * did not do - the data is other people's, the alerts are published by people, the code was
 * written with an assistant under review - because a trust page that only boasts is not one.
 *
 * Pure data, so a test can hold every step and credential to a line in all three languages, and
 * hold the page to the rules it must not break: no personal phone number anywhere (safety rule 5
 * - the owner's number is on their own portfolio, not here), and the project address is read from
 * `CONTACT_EMAIL` rather than written into a file.
 */

export type AboutIcon = "cap" | "drop" | "satellite" | "build" | "plane";

/** A step on the way to Jaga. The years are text, so a draft can say "to present". */
export type CareerStep = {
  /** Message key under `about.road.steps.<key>`. */
  key: string;
  icon: AboutIcon;
  /** How many `what.<n>` lines the step has. */
  what: number;
};

/**
 * The four steps, oldest first, because the point of the page is the direction of travel: civil
 * engineering, then flood and dam work, then a national Earth-observation programme, then
 * building and shipping enterprise systems. Jaga needs all four, and it is the last one that
 * explains why this is a working service and not a prototype.
 */
export const CAREER_STEPS: CareerStep[] = [
  { key: "degree", icon: "cap", what: 2 },
  { key: "ilf", icon: "drop", what: 3 },
  { key: "airbus", icon: "satellite", what: 4 },
  { key: "egis", icon: "build", what: 3 },
];

/** What the owner did on Jaga, what was done with help, and what is not theirs at all. */
export const SCOPE_PARTS = ["mine", "assisted", "theirs"] as const;
export type ScopePart = (typeof SCOPE_PARTS)[number];

/** How many points each scope column has (`about.scope.<part>.points.<n>`). */
export const SCOPE_POINTS: Record<ScopePart, number> = { mine: 4, assisted: 3, theirs: 3 };

/** The promises the page makes, and the limits it admits in the same breath. */
export const TRUST_POINTS = ["nonprofit", "humans", "open", "nomoney", "limits"] as const;

/** The compact credential lists at the foot of the page. */
export const CREDENTIAL_GROUPS = ["education", "membership", "training", "languages"] as const;
export type CredentialGroup = (typeof CREDENTIAL_GROUPS)[number];

/** How many lines each credential group has (`about.credentials.<group>.items.<n>`). */
export const CREDENTIAL_ITEMS: Record<CredentialGroup, number> = {
  education: 2,
  membership: 1,
  training: 4,
  languages: 6,
};

/**
 * Where a reader can go and check. Addresses only - never a phone number, and never the project
 * address, which the page reads from the environment at render time.
 *
 * There is deliberately **no link to the source code** (the owner, 20 Oct 2026). Two places in the
 * page's own words already say the code is public and can be read; a button pointing every visitor
 * at a repository is a different thing, and this page is not here to recruit readers for it.
 *
 * `rel="me"` is deliberate on the two that are the owner's own pages: it is the one standing
 * claim this page makes that a reader can verify from the other end.
 */
export type AboutLink = { key: string; href: string; me?: boolean };

export const ABOUT_LINKS: AboutLink[] = [
  { key: "portfolio", href: "https://nafis-portfolio.pages.dev/", me: true },
  { key: "linkedin", href: "https://www.linkedin.com/in/nafis-damae", me: true },
];

/**
 * The portrait at `public/about/<PORTRAIT>`: the owner cut out of their own photo, standing in
 * the page's own light rather than in the office they were photographed in.
 *
 * It is a WebP because it carries real transparency, and at 25 KB it costs a quarter of what the
 * same cut-out does as a PNG. Until a portrait exists the page draws the initials in the brand
 * colours, the way the credits cards do for an organisation with no logo, so the page is complete
 * either way and the slot never changes size (components/about/Portrait.module.css).
 */
export const PORTRAIT = "nafis.webp";

/**
 * Whether that file is actually in place. The page is written, reviewed and translated long
 * before a photo is chosen, so this is the single switch between the initials and the portrait:
 * put the file there with `.claude/local/q-portrait.mjs`, turn this to true, and every screen
 * that draws the portrait follows. Nothing else moves, because the slot is the same size either
 * way (components/about/Portrait.module.css).
 */
export const PORTRAIT_READY = true;

/** The initials the page falls back to, from the Latin name in `about.name`. */
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * The journey across industries, taken from the owner's own portfolio: water infrastructure and
 * energy, then defence and space, then aviation and airports. Three industries in a decade.
 *
 * It sits above the career cards because it is the shape of the whole thing in one line, and
 * because it is the page's answer to "how is any of this one career": each move was onto
 * unfamiliar ground, and Jaga is the three of them arriving in the same place.
 */
export type Sector = { key: string; icon: AboutIcon };

export const SECTORS: Sector[] = [
  { key: "water", icon: "drop" },
  { key: "space", icon: "satellite" },
  { key: "aviation", icon: "plane" },
];
