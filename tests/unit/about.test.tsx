import { describe, expect, it } from "vitest";
import { About } from "@/components/about/About";
import {
  ABOUT_LINKS,
  CAREER_STEPS,
  CREDENTIAL_GROUPS,
  CREDENTIAL_ITEMS,
  initialsOf,
  SCOPE_PARTS,
  SCOPE_POINTS,
  TRUST_POINTS,
} from "@/lib/about";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const ALL = { th, ms, en } as const;
type Tree = { [key: string]: string | Tree };
const read = (tree: Tree, path: string) =>
  path
    .split(".")
    .reduce<string | Tree | undefined>(
      (node, key) => (typeof node === "object" ? node[key] : undefined),
      tree,
    );
const root = (messages: unknown) => (messages as unknown as Tree).about as Tree;

describe("who built Jaga: the lines", () => {
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
      ...CAREER_STEPS.flatMap((step) => [
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
      ...ABOUT_LINKS.flatMap((link) => [
        `check.links.${link.key}.title`,
        `check.links.${link.key}.text`,
      ]),
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
describe("who built Jaga: the rules", () => {
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
  it("sends the reader to the owner's own pages and to the code, over https", () => {
    for (const link of ABOUT_LINKS) expect(link.href).toMatch(/^https:\/\//);
    expect(ABOUT_LINKS.filter((l) => l.me).length).toBe(2);
  });
});

describe("who built Jaga: the page", () => {
  it("draws every step, with the line saying what it gave Jaga", () => {
    const { container } = renderWithIntl(<About />, "en");
    for (const step of CAREER_STEPS) {
      const card = container.querySelector(`[data-about-step="${step.key}"]`);
      expect(card, step.key).not.toBeNull();
      expect(card?.textContent).toContain(en.about.road.gaveLabel);
    }
    expect(container.querySelectorAll("[data-about-scope]").length).toBe(SCOPE_PARTS.length);
    expect(container.querySelectorAll("[data-about-trust]").length).toBe(TRUST_POINTS.length);
  });

  /**
   * The portrait slot has to leave the page complete before a photo exists, because the page is
   * written and reviewed long before the owner picks one.
   */
  it("falls back to initials until a portrait is put in place", () => {
    const { container } = renderWithIntl(<About />, "en");
    const slot = container.querySelector("[data-about-portrait]");
    expect(slot?.getAttribute("data-about-portrait")).toBe("initials");
    expect(slot?.textContent).toBe(initialsOf(en.about.name));
    expect(container.querySelector("img")).toBeNull();

    const withPhoto = renderWithIntl(<About showPortrait />, "en");
    const img = withPhoto.container.querySelector("img");
    expect(img?.getAttribute("alt")).toBe(en.about.portraitAlt);
  });

  it("makes the initials from the Latin name", () => {
    expect(initialsOf("Nafis Damae")).toBe("ND");
    expect(initialsOf("  one   two three ")).toBe("OT");
  });
});
