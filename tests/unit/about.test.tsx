import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { About } from "@/components/about/About";
import {
  SECTORS,
  CREDENTIAL_GROUPS,
  CREDENTIAL_ITEMS,
  initialsOf,
  PORTRAIT_READY,
  type AboutLink,
  type CareerStep,
  SCOPE_PARTS,
  SCOPE_POINTS,
  TRUST_POINTS,
} from "@/lib/about";
import { renderWithAbout, ABOUT, HAS_ABOUT } from "./about-content";

const ALL = ABOUT;
/** One English line by path, for the assertions that quote the page back to itself. */
const line = (path: string) => read(ABOUT.en, path) as string;

/**
 * The career steps and the addresses live with the copy, not in this repository (the owner,
 * 20 Oct 2026), so the tests read them from exactly where the page does.
 */
const STEPS = ((ABOUT.en.road as { order?: CareerStep[] })?.order ?? []) as CareerStep[];
const LINKS = ((ABOUT.en.check as { at?: AboutLink[] })?.at ?? []) as AboutLink[];
type Tree = { [key: string]: string | Tree };
const read = (tree: Tree, path: string) =>
  path
    .split(".")
    .reduce<string | Tree | undefined>(
      (node, key) => (typeof node === "object" ? node[key] : undefined),
      tree,
    );
const root = (messages: unknown) => messages as Tree;

describe.skipIf(!HAS_ABOUT)("who built Jaga: the lines", () => {
  it("has every line of the page in Thai, Malay and English", () => {
    const keys = [
      "link",
      "title",
      "name",
      "nameThai",
      "role",
      "lead",
      "audience",
      "portraitAlt",
      "why.title",
      "why.p1",
      "why.p2",
      "why.p3",
      "why.p4",
      "journey.title",
      "journey.lead",
      "journey.note",
      "journey.andJaga",
      ...SECTORS.flatMap((sector) => [
        `journey.sectors.${sector.key}.short`,
        `journey.sectors.${sector.key}.years`,
        `journey.sectors.${sector.key}.name`,
        `journey.sectors.${sector.key}.tag`,
      ]),
      "road.title",
      "road.lead",
      "road.gaveLabel",
      "scope.title",
      "scope.lead",
      "scope.credits",
      "trust.title",
      "credentials.title",
      "credentials.malayNote",
      "check.title",
      "check.lead",
      "check.emailTitle",
      "check.emailText",
      "check.noPhone",
      "closing.title",
      "closing.text",
      "closing.how",
      "closing.features",
      "closing.map",
      ...["years", "flood", "reservoirs", "forecast", "theos"].map((k) => `stats.${k}`),
      ...STEPS.flatMap((step) => [
        ...["years", "title", "where", "gave"].map((k) => `road.steps.${step.key}.${k}`),
        ...Array.from({ length: step.what }, (_, i) => `road.steps.${step.key}.what.${i + 1}`),
      ]),
      ...SCOPE_PARTS.flatMap((part) => [
        `scope.${part}.title`,
        ...Array.from({ length: SCOPE_POINTS[part] }, (_, i) => `scope.${part}.points.${i + 1}`),
      ]),
      ...TRUST_POINTS.flatMap((key) => [`trust.points.${key}.title`, `trust.points.${key}.text`]),
      ...CREDENTIAL_GROUPS.flatMap((group) => [
        `credentials.${group}.title`,
        ...Array.from(
          { length: CREDENTIAL_ITEMS[group] },
          (_, i) => `credentials.${group}.items.${i + 1}`,
        ),
      ]),
      ...LINKS.flatMap((link) => [`check.links.${link.key}.title`, `check.links.${link.key}.text`]),
    ];
    for (const [locale, messages] of Object.entries(ALL)) {
      for (const key of keys) {
        expect(typeof read(root(messages), key), `${locale} ${key}`).toBe("string");
      }
    }
  });
});

/**
 * The rules this page must not break. It is the one page in Jaga that is *about* a person, which
 * is exactly why the privacy rules need a test here rather than trust.
 */
describe.skipIf(!HAS_ABOUT)("who built Jaga: the rules", () => {
  /**
   * Safety rule 5: personal phone numbers are never public, and the owner's own is no exception -
   * it is on their portfolio, which this page links to, and not in the app. The page says so, so
   * the words "phone number" appear; what must never appear is a number to dial.
   *
   * The four official hotlines are the deliberate exception, and only in the one line that is
   * there to put them first.
   */
  it("carries no personal phone number, in any language", () => {
    const HOTLINES = ["1784", "1669", "191", "199"];
    for (const [locale, messages] of Object.entries(ALL)) {
      const page = JSON.stringify(root(messages));
      // A country code and at least seven more digits: any real number, however it is spaced.
      expect(/\+\d[\d\s().-]{7,}/.test(page), `${locale} has a dialable number`).toBe(false);
      const trust = read(root(messages), "trust.points.nonprofit.text") as string;
      for (const line of HOTLINES) expect(trust, `${locale} hotline ${line}`).toContain(line);
    }
  });

  /**
   * The owner's note of 17 Oct 2026: an em dash reads as machine-written. The rest of
   * messages/*.json carries two in all, and this page - the one that has to sound like a person -
   * must carry none.
   */
  it("uses no em or en dashes", () => {
    for (const [locale, messages] of Object.entries(ALL)) {
      expect(/[—–]/.test(JSON.stringify(root(messages))), `${locale} has a long dash`).toBe(false);
    }
  });

  /** docs/brand.md: the name is written "Jaga". Never JAGA, never จากา in running text. */
  it("never shouts or transliterates the brand name", () => {
    for (const [locale, messages] of Object.entries(ALL)) {
      const page = JSON.stringify(root(messages));
      expect(/JAGA/.test(page), `${locale} says JAGA`).toBe(false);
      expect(/จากา/.test(page), `${locale} says จากา`).toBe(false);
    }
  });

  /** Every address a reader is sent to is somewhere they can actually check the claims. */
  it("sends the reader to the owner's own pages, over https", () => {
    for (const link of LINKS) expect(link.href).toMatch(/^https:\/\//);
    expect(LINKS.filter((l) => l.me).length).toBe(2);
  });

  /**
   * The owner, 20 Oct 2026: the page's own words already say the code is public, and that is
   * enough - no button pointing every visitor at the repository. The wording stays and the link
   * goes, so this holds both halves of that at once.
   */
  it("says the code is public but offers nobody a link to it", () => {
    for (const link of LINKS) expect(link.href).not.toMatch(/github/i);
    for (const [locale, messages] of Object.entries(ALL)) {
      expect(/github/i.test(JSON.stringify(root(messages))), `${locale} names GitHub`).toBe(false);
      const said = [
        read(root(messages), "scope.assisted.points.3"),
        read(root(messages), "trust.points.open.text"),
      ].join(" ");
      expect(typeof said, locale).toBe("string");
    }
    const { container } = renderWithAbout(<About />, "en");
    expect(container.querySelector('a[href*="github"]'), "a link to the repository").toBeNull();
    expect(container.textContent).toContain(line("trust.points.open.title"));
  });

  /** The scholarship is the Bahrain government's (the owner, 20 Oct 2026), not a royal one. */
  it("names the scholarship correctly, in every language", () => {
    for (const [locale, messages] of Object.entries(ALL)) {
      const page = JSON.stringify(root(messages));
      expect(/royal|พระราชทาน/i.test(page), `${locale} still says royal`).toBe(false);
    }
  });
});

describe.skipIf(!HAS_ABOUT)("who built Jaga: the page", () => {
  it("draws every step, with the line saying what it gave Jaga", () => {
    const { container } = renderWithAbout(<About />, "en");
    for (const step of STEPS) {
      const card = container.querySelector(`[data-about-step="${step.key}"]`);
      expect(card, step.key).not.toBeNull();
      expect(card?.textContent).toContain(line("road.gaveLabel"));
    }
    expect(container.querySelectorAll("[data-about-scope]").length).toBe(SCOPE_PARTS.length);
    expect(container.querySelectorAll("[data-about-sector]").length).toBe(SECTORS.length);
    // Every employer with a mark shows it, and the line saying whose marks they are is there.
    const withLogos = STEPS.filter((s) => s.logo);
    expect(container.querySelectorAll("[data-about-logo]").length).toBe(withLogos.length);
    for (const step of withLogos) {
      const mark = container.querySelector(`[data-about-logo="${step.logo}"] img`);
      expect(mark?.getAttribute("src"), step.key).toBe(`/about/logos/${step.logo}.png`);
      // A picture of a name, beside the name: nothing for a screen reader to read twice.
      expect(mark?.getAttribute("alt"), step.key).toBe("");
    }
    expect(container.textContent).toContain(line("road.marks"));
    expect(container.querySelectorAll("[data-about-trust]").length).toBe(TRUST_POINTS.length);
  });

  /**
   * The portrait slot has to leave the page complete whether or not a photo exists, because the
   * page was written, reviewed and translated before one was chosen.
   */
  it("draws the portrait, and falls back to initials without one", () => {
    const { container } = renderWithAbout(<About />, "en");
    const slot = container.querySelector("[data-about-portrait]");
    expect(slot?.getAttribute("data-about-portrait")).toBe(PORTRAIT_READY ? "photo" : "initials");
    const img = container.querySelector("[data-about-portrait] img");
    expect(img?.getAttribute("alt")).toBe(line("portraitAlt"));

    const without = renderWithAbout(<About showPortrait={false} />, "en");
    expect(without.container.querySelector("[data-about-portrait]")?.textContent).toBe(
      initialsOf(line("name")),
    );
    // The employer marks are images too, so this is about the portrait slot alone.
    expect(without.container.querySelector("[data-about-portrait] img")).toBeNull();
  });

  /** `PORTRAIT_READY` must never be true without the file it promises. */
  it("has the portrait file it says it has", () => {
    if (!PORTRAIT_READY) return;
    const file = (ABOUT.en.portrait as string) ?? "portrait.webp";
    expect(existsSync(`public/about/${file}`), `public/about/${file}`).toBe(true);
  });

  /**
   * The journey across industries is decoration that carries content: a reader who has asked for
   * less motion, or whose browser never runs the keyframes, must still read three whole
   * industries. So the words live in the markup, not in the animation.
   */
  it("draws the three industries as readable text, not as an animation", () => {
    const { container } = renderWithAbout(<About />, "en");
    const board = container.querySelector("[data-about-journey]");
    expect(board).not.toBeNull();
    for (const sector of SECTORS) {
      const station = container.querySelector(`[data-about-sector="${sector.key}"]`);
      expect(station, sector.key).not.toBeNull();
      const text = station?.textContent ?? "";
      const lines = read(ABOUT.en, `journey.sectors.${sector.key}`) as Record<string, string>;
      expect(lines, sector.key).toBeDefined();
      for (const key of ["years", "name", "tag"] as const) {
        expect(text, `${sector.key} ${key}`).toContain(lines?.[key]);
      }
      expect(station?.querySelector("svg"), `${sector.key} icon`).not.toBeNull();
    }
  });

  /**
   * Approved on 20 Oct and promoted to /about. Two things carry it: the third tab beside the
   * science and the system, and the quiet line at the foot of every other page. Both appear only
   * where the content does, because the content is not in this repository.
   */
  it("carries the third tab, and marks itself as the page in view", () => {
    const { container } = renderWithAbout(<About />, "en");
    const tabs = [...container.querySelectorAll("[data-how-tab]")].map((el) => ({
      key: el.getAttribute("data-how-tab"),
      href: el.getAttribute("href"),
      current: el.getAttribute("aria-current"),
    }));
    expect(tabs.map((t) => t.key)).toEqual(["science", "system", "about"]);
    expect(tabs.find((t) => t.key === "about")?.href).toContain("/about");
    expect(tabs.find((t) => t.key === "about")?.current).toBe("page");
    expect(tabs.filter((t) => t.current === "page")).toHaveLength(1);
  });

  it("makes the initials from the Latin name", () => {
    expect(initialsOf("Nafis Damae")).toBe("ND");
    expect(initialsOf("  one   two three ")).toBe("OT");
  });
});
