import { describe, expect, it } from "vitest";
import { HomeView, type HomeViewProps } from "@/components/home/HomeView";
import {
  BANA,
  EXAMPLE_NOW,
  EXAMPLE_PLACES,
  exampleAlert,
  exampleStatus,
  homeExample,
  type HomeScenario,
} from "@/lib/dev-examples";
import type { Dam } from "@/lib/dam";
import { exampleDamSignal } from "@/lib/dev-examples";
import { toPublicAlert } from "@/lib/public-status";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

function home(scenario: HomeScenario, more: Partial<HomeViewProps> = {}) {
  const example = homeExample(scenario);
  return renderWithIntl(
    <HomeView
      ready
      status={example.status}
      checkedAt={example.status ? EXAMPLE_NOW - 60_000 : null}
      failed={example.failed}
      area={example.area}
      me={example.me}
      places={EXAMPLE_PLACES}
      placesState="ok"
      now={EXAMPLE_NOW}
      onChooseArea={() => {}}
      onRetry={() => {}}
      projectLine={null}
      {...more}
    />,
  ).container;
}

const follows = (a: Element, b: Element) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

/*
 * The dam's drawing on the home screen (the owner's choice of 12 Oct). Someone on the river gets
 * the quiet notice, which carries the drawing inside it; someone else in Yala, Pattani or
 * Narathiwat gets the drawing alone, with nothing saying water is coming to them; Songkhla gets
 * neither, because the released water ends in Pattani Bay.
 */
describe("the dam's figure on the home screen", () => {
  const DAM: Dam = {
    code: "bang_lang",
    name: { th: "เขื่อนบางลาง", en: "Bang Lang Dam" },
    river: { th: "แม่น้ำปัตตานี", en: "Pattani River" },
    operator: "EGAT",
    point: null,
    spillwayPoint: null,
    outletPoint: null,
    reservoir: null,
    storageMaxMcm: 1589.8,
    storageNormalMcm: 1454.4,
    geometrySource: "osm",
    geometryNote: {},
    reaches: [],
    // BANA (940104) is on the river; the other example places are not.
    tambons: [{ code: BANA.code, via: "main", kmFromDam: 128 }],
    signal: exampleDamSignal("releasing"),
    daily: null,
    days: [],
  };
  const area = (code: string) => ({ ...BANA, code, from: "list" as const });

  it("someone on the river gets the notice, with the drawing inside it and no second card", () => {
    const c = home("normal", { dams: [DAM], area: BANA });
    const notice = c.querySelector("[data-dam-notice]")!;
    expect(notice).toBeTruthy();
    expect(notice.querySelector("[data-dam-figure='section']")).toBeTruthy();
    expect(c.querySelector("[data-dam-figure-card]")).toBeNull();
  });

  it("someone else in the three provinces gets the drawing, and nothing that says water is coming", () => {
    for (const code of ["950299", "940999", "960501"]) {
      const c = home("normal", { dams: [DAM], area: area(code) });
      const card = c.querySelector("[data-dam-figure-card]")!;
      expect(card, code).toBeTruthy();
      expect(card.querySelector("[data-dam-figure='section']")).toBeTruthy();
      expect(c.querySelector("[data-dam-notice]")).toBeNull();
      // It says what it is, and what it is not.
      expect(card.textContent).toContain(th.dam.disclaimer.notAnAlert);
      expect(card.getAttribute("data-dam-on-river")).toBe("false");
      expect(card.textContent).toContain(th.dam.figure.cardWhere.replace("{river}", DAM.river.th!));
    }
  });

  /*
   * The quiet notice says nothing at all on an ordinary day (`attention` is "none"), so without
   * this someone living on the river would see **less** of their own dam than a neighbour a
   * province away. Found in a browser on 13 Oct, where the live dam is quiet.
   */
  it("someone on the river on a quiet day gets the drawing too, as the card", () => {
    const quiet = { ...DAM, signal: exampleDamSignal("quiet") };
    const c = home("normal", { dams: [quiet], area: BANA });
    expect(c.querySelector("[data-dam-notice]")).toBeNull();
    const card = c.querySelector("[data-dam-figure-card]")!;
    expect(card).toBeTruthy();
    expect(card.querySelector("[data-dam-figure='section']")).toBeTruthy();
    // And it tells them the truth about where they live, rather than the other card's sentence.
    expect(card.getAttribute("data-dam-on-river")).toBe("true");
    expect(card.textContent).toContain(
      th.dam.figure.cardWhereOnPath.replace("{river}", DAM.river.th!),
    );
  });

  it("the card sits directly above the map button, and carries no map link of its own", () => {
    const c = home("normal", { dams: [DAM], area: area("950299") });
    const card = c.querySelector("[data-dam-figure-card]")!;
    const map = c.querySelector("[data-map-link]")!;
    expect(card.nextElementSibling).toBe(map);
    expect(card.querySelector("a")).toBeNull();
  });

  it("Songkhla gets neither: the dam's water never reaches it", () => {
    const c = home("normal", { dams: [DAM], area: area("900101") });
    expect(c.querySelector("[data-dam-figure-card]")).toBeNull();
    expect(c.querySelector("[data-dam-notice]")).toBeNull();
  });

  it("nothing is drawn before someone has told the app where they are", () => {
    // "choose" is the home screen of someone who has not picked an area yet.
    const c = home("choose", { dams: [DAM] });
    expect(c.querySelector("[data-dam-figure-card]")).toBeNull();
    expect(c.querySelector("[data-dam-notice]")).toBeNull();
  });
});

describe("home hero (safety rule 3)", () => {
  it("shows level, area, issuer, issue time, reason and next update", () => {
    const c = home("warning");
    const hero = c.querySelector('[data-hero="alert"]')!;
    expect(hero.querySelector('[data-level="warning"]')).not.toBeNull();
    expect(hero.querySelector(`[data-area="${BANA.code}"]`)?.textContent).toContain("บานา");
    for (const label of [th.home.reason, th.home.issuedBy, th.home.issued, th.home.nextUpdate]) {
      expect(hero.textContent).toContain(label);
    }
    expect(hero.textContent).toContain(th.home.issuer);
    // Expected windows are ranges with the "estimate" label (safety rule 8).
    expect(hero.querySelector("[data-estimate]")?.textContent).toContain(th.home.estimate);
  });

  it("a stale alert keeps its level badge and adds the 'not updated since' marker", () => {
    const c = home("stale");
    const badge = c.querySelector('[data-hero="alert"] [data-level="warning"]');
    const marker = c.querySelector('[data-hero="alert"] [data-stale]');
    expect(badge?.textContent).toBe(th.alert.level.warning);
    expect(marker?.textContent).toContain("14:00");
    expect(follows(badge!, marker!)).toBe(true);
    // Still the warning checklist: nothing is downgraded.
    expect(c.querySelector('[data-checklist="warning"]')).not.toBeNull();
  });

  it("at Evacuate the SOS button comes directly under the hero, above the checklist", () => {
    const c = home("evacuate");
    const sos = c.querySelector('a[href="/sos"]')!;
    const checklist = c.querySelector("[data-checklist]")!;
    expect(follows(c.querySelector("[data-hero]")!, sos)).toBe(true);
    expect(follows(sos, checklist)).toBe(true);
    const other = home("watch");
    expect(
      follows(other.querySelector("[data-checklist]")!, other.querySelector('a[href="/sos"]')!),
    ).toBe(true);
  });
});

describe("home never implies 'no risk' (safety rule 10)", () => {
  it("before launch a tambon without an alert shows no level, only the grey notice", () => {
    const c = home("notInService");
    expect(c.querySelector("[data-level]")).toBeNull();
    expect(c.querySelector('[data-hero="notInService"]')?.textContent).toContain(
      th.home.notInService.title,
    );
    expect(c.querySelector("[data-checklist]")).toBeNull();
  });

  it("with no area chosen it asks for one and shows no level", () => {
    const c = home("choose");
    expect(c.querySelector("[data-level]")).toBeNull();
    expect(c.querySelector("[data-area-chooser]")).not.toBeNull();
  });

  it("when the status can't be loaded it says so and shows no level", () => {
    const c = home("unavailable");
    expect(c.querySelector("[data-level]")).toBeNull();
    expect(c.querySelector('[data-hero="unknown"]')).not.toBeNull();
  });

  it("Normal is shown from a fresh status, and not from a copy that is hours old", () => {
    expect(
      home("normal").querySelector('[data-hero="normal"] [data-level="normal"]'),
    ).not.toBeNull();
    const old = home("normal", { checkedAt: EXAMPLE_NOW - 3 * 3_600_000, failed: true });
    expect(old.querySelector("[data-level]")).toBeNull();
    expect(old.querySelector('[data-hero="unknown"]')).not.toBeNull();
    expect(old.querySelector('[data-checked="old"]')).not.toBeNull();
  });

  it("an alert from an old copy is still shown, with the time it was received", () => {
    const c = home("evacuate", { checkedAt: EXAMPLE_NOW - 3 * 3_600_000, failed: true });
    expect(c.querySelector('[data-level="evacuate"]')).not.toBeNull();
    expect(c.querySelector('[data-checked="old"]')).not.toBeNull();
  });

  it("the SOS and Report buttons are there in every state, without signing in", () => {
    for (const scenario of ["choose", "notInService", "unavailable", "evacuate"] as const) {
      const c = home(scenario);
      expect(c.querySelector('a[href="/sos"]')?.textContent).toContain("SOS");
      expect(c.querySelector('a[href="/report"]')).not.toBeNull();
    }
    const loading = home("warning", { ready: false });
    expect(loading.querySelector('[data-hero="loading"]')).not.toBeNull();
    expect(loading.querySelector('a[href="/sos"]')).not.toBeNull();
  });
});

describe("watched places (spec 4.1, 4.9)", () => {
  it("a place worse than home comes first, with Call and SOS for that place", () => {
    const c = home("watched");
    const banner = c.querySelector('[data-worse-place="w1"]')!;
    expect(follows(banner, c.querySelector("[data-hero]")!)).toBe(true);
    expect(banner.querySelector('[data-level="evacuate"]')).not.toBeNull();
    expect(banner.querySelector('a[href="tel:0800000000"]')?.textContent).toContain("แม่");
    expect(banner.querySelector('a[href="/sos?place=w1"]')?.textContent).toContain("บ้านแม่");
    // The home hero stays directly below with its own level.
    expect(c.querySelector('[data-hero="alert"] [data-level="watch"]')).not.toBeNull();
    // The other watched place has no alert: Normal, since the service is running here.
    expect(c.querySelectorAll("[data-watched] li")).toHaveLength(2);
  });

  it("before launch a watched place without an alert shows words, not a level", () => {
    const example = homeExample("watched");
    const c = home("watched", {
      status: exampleStatus([exampleAlert("evacuate", ["940111"])], false),
      me: example.me,
    });
    const quiet = c.querySelectorAll("[data-watched] li")[1]!;
    expect(quiet.querySelector("[data-level]")).toBeNull();
    expect(quiet.querySelector('[data-no-level="notInService"]')).not.toBeNull();
  });
});

describe("safe places (spec 4.3)", () => {
  it("lists three places and car parking separately, each with Navigate", () => {
    const c = home("watch");
    const cards = [...c.querySelectorAll("[data-safe-place]")];
    expect(cards).toHaveLength(4);
    for (const card of cards) {
      expect(card.querySelector("a")?.getAttribute("href")).toMatch(
        /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=6\.\d+,101\.\d+$/,
      );
    }
    expect(c.textContent).toContain(th.places.parkingTitle);
  });

  it("is folded under its own button, which says how many places there are", () => {
    const c = home("watch");
    const fold = c.querySelector<HTMLDetailsElement>("details[data-safe-places]")!;
    // Closed until the person asks: the home screen stays short (owner, 12 Oct).
    expect(fold.open).toBe(false);
    const button = fold.querySelector("summary")!;
    expect(button.textContent).toContain(th.places.title);
    expect(button.textContent).toContain("4");
    // The places are inside the fold, not somewhere else on the page.
    expect(c.querySelectorAll("[data-safe-place]").length).toBe(
      fold.querySelectorAll("[data-safe-place]").length,
    );
  });

  it("sits below the map button, which comes straight after the places the person watches", () => {
    const c = home("watch", { me: homeExample("watched").me });
    const watched = c.querySelector("[data-watched]")!;
    const map = c.querySelector("[data-map-link]")!;
    const fold = c.querySelector("[data-safe-places]")!;
    expect(watched.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(map.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says on the button when nothing is listed, so an empty list is not hidden behind a tap", () => {
    const c = home("watch", { places: { people: [], parking: [] } });
    expect(c.querySelector("details[data-safe-places] summary")?.textContent).toContain("0");
  });

  it("an empty list says where to ask, never that none is needed", () => {
    const c = home("watch", { places: { people: [], parking: [] } });
    expect(c.querySelector("[data-safe-places]")?.textContent).toContain(th.places.none);
  });
});

describe("toPublicAlert", () => {
  const row = {
    alert_id: "a",
    hazard_type: "flood",
    level: "watch",
    reason: "why",
    messages: { th: "ข้อความ" },
    issued_at: "2026-11-20T08:00:00+00:00",
    next_update_at: "2026-11-20T12:00:00+00:00",
    onset_from: null,
    onset_to: null,
    return_from: null,
    return_to: null,
    source: null,
    tambons: ["940104"],
    issued_by: "someone",
  };
  it("keeps what the public may see and nothing else", () => {
    const alert = toPublicAlert(row)!;
    expect(alert.level).toBe("watch");
    expect(JSON.stringify(alert)).not.toContain("someone");
  });
  it("leaves out an alert that lacks a required part", () => {
    expect(toPublicAlert({ ...row, next_update_at: null })).toBeNull();
    expect(toPublicAlert({ ...row, level: "green" })).toBeNull();
    expect(toPublicAlert({ ...row, messages: { en: "only English" } })).toBeNull();
  });
});
