import { afterEach, describe, expect, it, vi } from "vitest";
import { ResidentsSaidLine } from "@/components/places/PlaceCheck";
import { SafePlaceCard } from "@/components/places/SafePlaceCard";
import { EXAMPLE_PLACES } from "@/lib/dev-examples";
import { loudest, toResidentsSaid } from "@/lib/place-checks";
import type { SafePlace } from "@/lib/places";
import { renderWithIntl } from "./render";

/**
 * A resident saying what a safe place is like, from its pin or its card (owner, 20 Oct). What is
 * held here is the rule, not the wording: what residents say is drawn as its own attributed line
 * and never as the status, and a visitor is offered the way in rather than a form.
 */

/** A cookie shaped like Supabase's, which is how useSignedIn() knows (see admin-link.test). */
const SESSION = "sb-test-auth-token";
const signIn = () => {
  document.cookie = `${SESSION}=present; path=/`;
};
afterEach(() => {
  document.cookie = `${SESSION}=; path=/; max-age=0`;
  vi.doUnmock("@/i18n/navigation");
  vi.resetModules();
});

const base = EXAMPLE_PLACES.people[0]!;
const card = (over: Partial<SafePlace>, locale: "th" | "en" = "th") =>
  renderWithIntl(<SafePlaceCard place={{ ...base, ...over }} />, locale).container;
/** The card as the map draws it behind a pin, which is the one place that asks. */
const asking = (over: Partial<SafePlace> = {}, locale: "th" | "en" = "en") =>
  renderWithIntl(<SafePlaceCard place={{ ...base, ...over }} canCheck />, locale).container;

describe("counting what residents said", () => {
  it("counts people, drops anything that is not a count, and is nothing when nobody spoke", () => {
    expect(toResidentsSaid(null)).toBeNull();
    expect(toResidentsSaid({ counts: {} })).toBeNull();
    expect(toResidentsSaid({ counts: { closed: 2, open: 1 } })?.people).toBe(3);
    expect(toResidentsSaid({ counts: { closed: "many" } })).toBeNull();
    expect(toResidentsSaid({ counts: { closed: 0 } })).toBeNull();
  });

  it("picks the same loudest answer however the database ordered the counts", () => {
    const a = toResidentsSaid({ counts: { closed: 2, full: 2 } })!;
    const b = toResidentsSaid({ counts: { full: 2, closed: 2 } })!;
    // A tie must not depend on row order, or the line would change on a refresh.
    expect(loudest(a)).toEqual(loudest(b));
    expect(loudest(toResidentsSaid({ counts: { open: 1, closed: 4 } })!)).toEqual({
      state: "closed",
      people: 4,
    });
  });
});

describe("the line about what residents said", () => {
  const said = toResidentsSaid({ counts: { closed: 3 }, disputed: true, latest: null })!;

  it("says how many people and what they said, and marks a dispute for the machines", () => {
    const c = renderWithIntl(<ResidentsSaidLine said={said} />, "en").container;
    const line = c.querySelector("[data-residents-said]")!;
    expect(line.getAttribute("data-residents-said")).toBe("closed");
    expect(line.getAttribute("data-residents-people")).toBe("3");
    expect(line.getAttribute("data-disputed")).toBe("true");
    expect(line.textContent).toContain("3 people here said");
    expect(line.textContent).toContain("Closed");
  });

  it("carries no alert colour: it is a thing people said, not a level", () => {
    const c = renderWithIntl(<ResidentsSaidLine said={said} />).container;
    const html = c.innerHTML;
    for (const level of ["watch", "warning", "evacuate", "jaga-alert"]) {
      expect(html).not.toContain(level);
    }
  });

  it("draws nothing at all when nobody has said anything", () => {
    const c = renderWithIntl(<ResidentsSaidLine said={null} />).container;
    expect(c.querySelector("[data-residents-said]")).toBeNull();
  });
});

describe("the card the resident reads", () => {
  it("shows what residents said UNDER the status, and leaves the status alone", () => {
    // Three people say closed while the record says full. Both are on the card, and the record
    // is still the record: only an admin or a covering team moves it.
    const c = card(
      {
        status: "full",
        residentsSaid: toResidentsSaid({ counts: { closed: 3 }, disputed: true, latest: null }),
      },
      "en",
    );
    expect(c.textContent).toContain("Full");
    expect(c.querySelector("[data-residents-said]")?.getAttribute("data-residents-said")).toBe(
      "closed",
    );
    const text = c.textContent!;
    expect(text.indexOf("Full")).toBeLessThan(text.indexOf("people here said"));
  });

  it("does not ask on the home screen list, only behind a pin", () => {
    // The owner, 20 Oct: "pin only". Three folded buttons on a screen already reported as too
    // long on a phone. What residents said is still shown here: a reading, not an ask.
    expect(card({}, "en").querySelector("[data-place-check]")).toBeNull();
    expect(asking().querySelector("[data-place-check]")).not.toBeNull();
  });

  it("offers a visitor the way in instead of a form", () => {
    // Signed in only, the owner's choice of 20 Oct: a check is not a cry for help, so the reason
    // an SOS has no door does not apply. useSignedIn() is false in a test browser.
    const c = asking();
    const offer = c.querySelector('[data-place-check="sign-in"]')!;
    expect(offer).not.toBeNull();
    expect(offer.textContent).toContain("Sign in");
    expect(c.querySelector("[data-place-check-send]")).toBeNull();
  });
});

describe("the three words about the road", () => {
  it("say exactly what the flood report says, in all three languages", async () => {
    // They are copied into placeChecks so the home screen does not carry all 47 report keys on
    // a slow connection. This test is what keeps the two copies the same.
    for (const locale of ["th", "en", "ms"] as const) {
      const m = (await import(`../../messages/${locale}.json`)).default as {
        report: { roadAccess: string; roads: Record<string, string> };
        placeChecks: { roadLabel: string; roads: Record<string, string> };
      };
      expect(m.placeChecks.roadLabel).toBe(m.report.roadAccess);
      expect(m.placeChecks.roads).toEqual(m.report.roads);
    }
  });
});

describe("asking from the pin", () => {
  async function ask(brief: boolean) {
    signIn();
    vi.doMock("@/i18n/navigation", () => ({ usePathname: () => "/map" }));
    const { CheckThisPlace: Fresh } = await import("@/components/places/PlaceCheck");
    return renderWithIntl(<Fresh placeId="p1" status="open" brief={brief} />, "en").container;
  }

  it("offers the three answers, with the one the app already says among them", async () => {
    const c = await ask(false);
    const sends = [...c.querySelectorAll("[data-place-check-send]")].map((b) =>
      b.getAttribute("data-place-check-send"),
    );
    expect(sends).toEqual(["open", "full", "closed"]);
    // "unknown" is not offered: a check that says nothing is not a check.
    expect(sends).not.toContain("unknown");
    expect(c.textContent).toContain("The app says");
  });

  it("leaves the water and the road out of the pop-up, keeping the three answers", async () => {
    // The pop-up is small, and the three answers are the part that matters there.
    const full = await ask(false);
    expect(full.querySelectorAll("fieldset").length).toBe(3);
    const brief = await ask(true);
    expect(brief.querySelectorAll("fieldset").length).toBe(1);
    expect(brief.querySelectorAll("[data-place-check-send]").length).toBe(3);
  });

  it("states the rule without naming who covers the area", async () => {
    // Since the owner's answer of 20 Oct a check writes the status itself where no team covers
    // the tambon. The screen may not say which case this place is in: coverage is readable only
    // by teams and admins (spec 9), so the words give the rule and the card shows the result.
    const c = await ask(true);
    expect(c.textContent).toContain("reaches the team covering this area");
    expect(c.textContent).toContain("Where no team covers it yet");
    expect(c.textContent).toContain("never issues an alert");
  });
});
