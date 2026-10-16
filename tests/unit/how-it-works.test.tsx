import { describe, expect, it } from "vitest";
import { HowScience } from "@/components/how/HowScience";
import { HowSystem } from "@/components/how/HowSystem";
import {
  CREDIT_GROUPS,
  CREDITS,
  FORBIDDEN_VENDOR_WORDS,
  initialsOf,
  SCIENCE_PARTS,
  SYSTEM_PARTS,
} from "@/lib/how-it-works";
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
const root = (messages: unknown) => (messages as unknown as Tree).howItWorks as Tree;

describe("how Jaga works: the lines", () => {
  it("has every part of the science page in Thai, Malay and English", () => {
    const keys = [
      "science.title",
      "science.lead",
      "science.audience",
      "science.contents",
      "science.contact.title",
      "science.contact.text",
      "science.checks.title",
      "science.checks.lead",
      "science.checks.note",
      "science.open.title",
      "science.leftOut.title",
      ...["seasons", "passes", "land", "buildings", "gauges", "places"].map(
        (k) => `science.stats.${k}`,
      ),
      ...["concept", "can", "cannot", "checked", "sources"].map((k) => `science.labels.${k}`),
      ...SCIENCE_PARTS.flatMap((part) => [
        ...["title", "concept", "can", "cannot"].map((k) => `science.parts.${part.key}.${k}`),
        ...(part.checked ? [`science.parts.${part.key}.checked`] : []),
      ]),
      ...["stage", "highways", "forecast"].flatMap((k) => [
        `science.leftOut.${k}.title`,
        `science.leftOut.${k}.text`,
      ]),
    ];
    for (const [locale, messages] of Object.entries(ALL)) {
      for (const key of keys) {
        expect(typeof read(root(messages), key), `${locale} ${key}`).toBe("string");
      }
    }
  });

  it("has every part of the system page, with all its points, in three languages", () => {
    for (const [locale, messages] of Object.entries(ALL)) {
      for (const part of SYSTEM_PARTS) {
        for (const key of ["title", "text"]) {
          expect(typeof read(root(messages), `system.parts.${part.key}.${key}`), locale).toBe(
            "string",
          );
        }
        for (let i = 1; i <= part.points; i++) {
          expect(
            typeof read(root(messages), `system.parts.${part.key}.points.${i}`),
            `${locale} ${part.key}.${i}`,
          ).toBe("string");
        }
      }
    }
  });

  it("has every drawing's words, and keeps the hour placeholders", () => {
    for (const [locale, messages] of Object.entries(ALL)) {
      const figures = read(root(messages), "figures") as Tree;
      for (const name of ["radar", "height", "gauge", "river", "system", "sos"]) {
        const figure = figures[name] as Tree;
        expect(typeof figure.title, `${locale} ${name}`).toBe("string");
        expect(typeof figure.alt, `${locale} ${name}`).toBe("string");
        expect(typeof figure.caption, `${locale} ${name}`).toBe("string");
      }
      const range = (figures.river as Tree).range as string;
      expect(range, locale).toContain("{from}");
      expect(range, locale).toContain("{to}");
    }
  });
});

/**
 * A vendor's name as a whole word only. Several of the forbidden words live inside innocent
 * ones - "hotline" holds the chat app's name, "draws" holds a cloud's - so a plain substring
 * search would fail on honest copy and teach everyone to ignore this test.
 */
const names = (text: string, word: string) =>
  new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text);

describe("how Jaga works: the system page names no vendor", () => {
  /**
   * The A18 acceptance line: "no vendor name appears on the system page (a test checks the
   * words)". Everything the system page renders is checked, in all three languages: its own
   * namespace and the two drawings it uses.
   */
  it("carries none of the forbidden words, in any language", () => {
    for (const [locale, messages] of Object.entries(ALL)) {
      const figures = read(root(messages), "figures") as Tree;
      const page = JSON.stringify([
        read(root(messages), "system"),
        figures.system,
        figures.sos,
        read(root(messages), "nav"),
        read(root(messages), "link"),
      ]);
      for (const word of FORBIDDEN_VENDOR_WORDS) {
        expect(names(page, word), `${locale} says "${word}"`).toBe(false);
      }
    }
  });

  it("does not name one in the page's own markup either", () => {
    const { container } = renderWithIntl(<HowSystem />, "en");
    const text = container.textContent ?? "";
    const html = container.innerHTML;
    for (const word of FORBIDDEN_VENDOR_WORDS) {
      expect(names(text, word), `the page says "${word}"`).toBe(false);
      // The brand token "jaga-line" is a colour, not the chat app: markup is read without it.
      if (word !== "line") expect(names(html, word), `the markup says "${word}"`).toBe(false);
    }
  });
});

describe("how Jaga works: the credits", () => {
  it("credits every organisation with a licence, a link and a line in three languages", () => {
    expect(CREDITS.length).toBeGreaterThan(15);
    for (const credit of CREDITS) {
      expect(credit.href, credit.id).toMatch(/^https:\/\//);
      expect(credit.licence.length, credit.id).toBeGreaterThan(3);
      expect(CREDIT_GROUPS, credit.id).toContain(credit.group);
      for (const [locale, messages] of Object.entries(ALL)) {
        expect(typeof read(root(messages), `credits.use.${credit.id}`), `${locale} ${credit.id}`).toBe(
          "string",
        );
      }
    }
  });

  it("has one entry per id and names every group", () => {
    const ids = CREDITS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const group of CREDIT_GROUPS) {
      expect(CREDITS.some((c) => c.group === group), group).toBe(true);
      for (const messages of Object.values(ALL)) {
        expect(typeof read(root(messages), `credits.groups.${group}`)).toBe("string");
      }
    }
  });

  it("thanks them and says they do not endorse Jaga", () => {
    for (const [locale, messages] of Object.entries(ALL)) {
      for (const key of ["credits.title", "credits.thanks", "credits.endorse"]) {
        expect((read(root(messages), key) as string).length, `${locale} ${key}`).toBeGreaterThan(20);
      }
    }
  });

  it("draws initials when an organisation has no logo file", () => {
    expect(initialsOf("OpenStreetMap contributors")).toBe("OC");
    expect(initialsOf("The open-source world")).toBe("OW");
    expect(initialsOf("GISTDA")).toBe("G");
  });

  it("asks for no donation anywhere on either page (safety rule 9)", () => {
    for (const messages of Object.values(ALL)) {
      expect(JSON.stringify(root(messages))).not.toMatch(/donat|บริจาค|derma|PromptPay/i);
    }
  });
});

describe("how Jaga works: the pages", () => {
  it("names every source it uses, and every source is credited", () => {
    const ids = new Set(CREDITS.map((c) => c.id));
    for (const part of SCIENCE_PARTS) {
      for (const source of part.sources) expect(ids.has(source), `${part.key}: ${source}`).toBe(true);
    }
  });

  it("sets out every science part with what it cannot tell", () => {
    const { container } = renderWithIntl(<HowScience />, "en");
    const parts = container.querySelectorAll("[data-how-part]");
    expect(parts).toHaveLength(SCIENCE_PARTS.length);
    for (const part of SCIENCE_PARTS) {
      const card = container.querySelector(`[data-how-part="${part.key}"]`)!;
      expect(card.textContent, part.key).toContain("What it cannot tell you");
    }
  });

  it("shows the credits with a card for every organisation", () => {
    const { container } = renderWithIntl(<HowScience />, "en");
    expect(container.querySelectorAll("[data-credit]")).toHaveLength(CREDITS.length);
    expect(container.querySelector("#credits")).toBeTruthy();
  });

  it("links the two pages to each other", () => {
    const science = renderWithIntl(<HowScience />, "en");
    expect(
      science.container.querySelector('[data-how-tab="system"]')?.getAttribute("href"),
    ).toBe("/en/how-it-works/system");
    const system = renderWithIntl(<HowSystem />, "en");
    expect(
      system.container.querySelector('[data-how-tab="science"]')?.getAttribute("href"),
    ).toBe("/en/how-it-works");
  });

  it("wears no alert colour except in the drawing of the alert levels", () => {
    const { container } = renderWithIntl(<HowScience />, "en");
    for (const card of container.querySelectorAll("[data-how-part]")) {
      if (card.getAttribute("data-how-part") === "gauges") continue;
      expect(card.outerHTML, card.getAttribute("data-how-part") ?? "").not.toMatch(/alert-/);
    }
  });
});
