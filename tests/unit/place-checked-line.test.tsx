import { describe, expect, it } from "vitest";
import { SafePlaceCard } from "@/components/places/SafePlaceCard";
import { EXAMPLE_PLACES } from "@/lib/dev-examples";
import type { SafePlace } from "@/lib/places";
import { renderWithIntl } from "./render";

/**
 * The line on a safe place saying when somebody was last there (owner, 20 Oct). What is being
 * held here is the rule, not the wording: the card states a fact with a time and a speaker, and
 * going stale never changes the status the place was given.
 */

const base = EXAMPLE_PLACES.people[0]!;
const card = (over: Partial<SafePlace>, locale: "th" | "en" = "th") =>
  renderWithIntl(<SafePlaceCard place={{ ...base, ...over }} />, locale).container;

const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();

describe("when the place was last checked", () => {
  it("names who was there, and never says only 'verified'", () => {
    const c = card(
      { status: "open", checkedAt: past, checkedSource: "team", checkDueAt: future },
      "en",
    );
    const line = c.querySelector('[data-checked="fresh"]')!;
    expect(line).not.toBeNull();
    expect(line.getAttribute("data-checked-source")).toBe("team");
    expect(line.textContent).toContain("local team");
    expect(line.textContent).not.toContain("Verified");
  });

  it("marks a check that has run out, and leaves the status exactly as it was", () => {
    const c = card({ status: "open", checkedAt: past, checkedSource: "team", checkDueAt: past }, "en");
    expect(c.querySelector('[data-checked="stale"]')?.textContent).toContain("Not checked since");
    // The whole point: stale is a marker, not a downgrade (safety rule 3).
    expect(c.textContent).toContain("Open");
    expect(c.textContent).not.toContain("Not known whether it is open");
  });

  it("says plainly when nobody has ever been, which is not the same as being fine", () => {
    const c = card({ checkedAt: null, checkedSource: null, checkDueAt: null }, "en");
    const line = c.querySelector('[data-checked="never"]')!;
    expect(line.textContent).toContain("Nobody has checked this place yet");
    expect(line.textContent).not.toMatch(/safe|fine|ok/i);
  });

  it("tells an admin's check from a team's", () => {
    const c = card(
      { checkedAt: past, checkedSource: "admin", checkDueAt: future },
      "en",
    );
    expect(c.querySelector("[data-checked]")?.getAttribute("data-checked-source")).toBe("admin");
    expect(c.querySelector("[data-checked]")?.textContent).toContain("Jaga admin");
  });

  it("writes the time in Bangkok time, like every other time in the app", () => {
    // 14:20 Bangkok on 20 November 2026.
    const at = "2026-11-20T07:20:00.000Z";
    const c = card({ checkedAt: at, checkedSource: "team", checkDueAt: future }, "en");
    expect(c.querySelector("[data-checked]")?.textContent).toContain("14:20");
  });

  it("says it in Thai too, without the word for verified", () => {
    const c = card({ checkedAt: past, checkedSource: "team", checkDueAt: past });
    const line = c.querySelector('[data-checked="stale"]')!;
    expect(line.textContent).toContain("ไม่มีใครไปตรวจตั้งแต่");
  });
});
