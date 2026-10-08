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
