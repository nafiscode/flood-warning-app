import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  UNIT_WAY_SESSION,
  UNIT_WAY_VISITS,
  UnitCard,
  UnitWayLine,
  unitWayFull,
} from "@/components/authority/UnitWay";
import { JoinJaga } from "@/components/home/JoinJaga";
import { homeMessages, mapMessages } from "@/lib/messages";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const ALL = { th, ms, en };
const KEYS = ["title", "who", "body", "register", "quiet", "mine", "signInFirst"] as const;

/*
 * The way in for a rescue unit (the owner, 18 Oct): ten people had signed in over two days and no
 * unit had registered, because no public page said a unit could. These tests hold the two things
 * that would quietly undo that - the card disappearing when it should not, and the words it
 * borrows from elsewhere drifting apart from their source.
 */
describe("whether the invitation is a card or one line", () => {
  it("is the card on a first visit, with nothing stored yet", () => {
    expect(unitWayFull(null, null)).toBe(true);
    expect(unitWayFull({ visits: 1 }, null)).toBe(true);
  });

  it("is still the card on the last of the few visits, and one line after", () => {
    expect(unitWayFull({ visits: UNIT_WAY_VISITS }, null)).toBe(true);
    expect(unitWayFull({ visits: UNIT_WAY_VISITS + 1 }, null)).toBe(false);
  });

  it("is one line for somebody who has a unit already, however new they are", () => {
    expect(unitWayFull(null, true)).toBe(false);
    expect(unitWayFull({ visits: 1 }, true)).toBe(false);
  });

  // The answer has not arrived yet, so the invitation shows: a team that has not registered must
  // never be the one it is hidden from.
  it("shows the card while it is not yet known whether they have a unit", () => {
    expect(unitWayFull(null, null)).toBe(true);
  });
});

describe("the unit card and its one-line form", () => {
  it("offers the registration form, and nothing else", () => {
    const c = renderWithIntl(<UnitCard />).container;
    const card = c.querySelector('[data-unit-way="card"]');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain(th.unitWay.title);
    expect(card!.textContent).toContain(th.unitWay.body);
    const links = [...card!.querySelectorAll("a")];
    expect(links).toHaveLength(1);
    // Thai is the default locale, so its own paths carry no prefix.
    expect(links[0]!.getAttribute("href")).toBe("/authority/register");
    expect(links[0]!.textContent).toBe(th.unitWay.register);
  });

  it("says the same thing in one line on the map", () => {
    const c = renderWithIntl(<UnitWayLine where="map" />).container;
    const line = c.querySelector('[data-unit-way="line-map"]');
    expect(line).not.toBeNull();
    expect(line!.textContent).toContain(th.unitWay.quiet);
    expect(line!.querySelector("a")!.getAttribute("href")).toBe("/authority/register");
  });
});

describe("the two ways in, side by side under the hero", () => {
  const stored = () => JSON.parse(window.localStorage.getItem("jaga.unitWay") ?? "null");

  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("draws both cards for a visitor who has not seen them", () => {
    const c = renderWithIntl(<JoinJaga />).container;
    expect(c.querySelector("[data-join-jaga]")!.getAttribute("data-join-jaga")).toBe("cards");
    expect(c.querySelector('[data-unit-way="card"]')).not.toBeNull();
    // The resident's own way in, with the LINE button that carries them back to this page.
    expect(c.querySelector('[data-sign-in-offer="compact"] [data-line-link]')).not.toBeNull();
  });

  it("is one line once the few visits are past", () => {
    window.localStorage.setItem("jaga.unitWay", JSON.stringify({ visits: UNIT_WAY_VISITS + 1 }));
    window.sessionStorage.setItem(UNIT_WAY_SESSION, "1");
    const c = renderWithIntl(<JoinJaga />).container;
    expect(c.querySelector("[data-join-jaga]")!.getAttribute("data-join-jaga")).toBe("line");
    expect(c.querySelector('[data-unit-way="card"]')).toBeNull();
    expect(c.querySelector('[data-unit-way="line-home"]')).not.toBeNull();
  });

  it("counts one visit a browser session, not one a render", () => {
    renderWithIntl(<JoinJaga />);
    expect(stored()).toEqual({ visits: 1 });
    renderWithIntl(<JoinJaga />);
    expect(stored()).toEqual({ visits: 1 });
  });
});

describe("the words the invitation uses", () => {
  it("has every line in Thai, Malay and English", () => {
    for (const [locale, messages] of Object.entries(ALL)) {
      const root = messages.unitWay as Record<string, string>;
      for (const key of KEYS) {
        expect(typeof root[key], `${locale} ${key}`).toBe("string");
        expect(root[key]!.trim().length, `${locale} ${key}`).toBeGreaterThan(0);
      }
    }
  });

  /*
   * Four of the seven lines are an existing line of Jaga's, said here as well. They are pinned to
   * their source so that rewording one pulls the other along: a unit must not be told two
   * different things about what registering does, on two screens, in the same week.
   */
  it("borrows the lines it borrows, word for word", () => {
    for (const [locale, m] of Object.entries(ALL)) {
      expect(m.unitWay.title, locale).toBe(m.capabilities.items.register.title);
      expect(m.unitWay.who, locale).toBe(m.capabilities.roles.team.who);
      expect(m.unitWay.body, locale).toBe(m.capabilities.roles.team.intro);
      expect(m.unitWay.register, locale).toBe(m.account.authority.register);
    }
  });

  // Without this the home and map screens throw at runtime while the types stay green.
  it("travels to the home screen and to the map", () => {
    expect(homeMessages(th)).toHaveProperty("unitWay");
    expect(mapMessages(th)).toHaveProperty("unitWay");
  });
});
