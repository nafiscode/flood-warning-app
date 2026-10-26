import { describe, expect, it } from "vitest";
import { Siren } from "@/components/authority/Siren";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

/*
 * The war room's siren (the owner, 24 Oct 2026): grey and still when nothing is asked of the
 * team, red and blue and turning while a request rings. It only repeats a fact the page already
 * says in words, so what it says to a screen reader is that same sentence.
 */
describe("the war room's siren", () => {
  it("is grey and idle when nothing is ringing, and says so", () => {
    const c = renderWithIntl(<Siren ringing={0} />).container;
    const siren = c.querySelector("[data-siren]")!;
    expect(siren.getAttribute("data-siren")).toBe("idle");
    expect(siren.getAttribute("aria-label")).toBe(th.authority.war.siren.idle);
  });

  it("goes live while requests ring, with the count in words", () => {
    const c = renderWithIntl(<Siren ringing={2} />).container;
    const siren = c.querySelector("[data-siren]")!;
    expect(siren.getAttribute("data-siren")).toBe("on");
    expect(siren.getAttribute("aria-label")).toContain("2");
  });

  it("lights up yellow for a request for food and water, with its own words, and red wins over it", () => {
    const supplies = renderWithIntl(<Siren ringing={0} supplies={1} />, "en").container;
    const s = supplies.querySelector("[data-siren]")!;
    expect(s.getAttribute("data-siren")).toBe("supplies");
    expect(s.getAttribute("aria-label")).toContain("food and water");
    // Both waiting: the rescue request is what the light says.
    const both = renderWithIntl(<Siren ringing={1} supplies={2} />, "en").container;
    expect(both.querySelector("[data-siren]")!.getAttribute("data-siren")).toBe("on");
  });

  it("turns around an upright axis: the lamps swing sideways, not round like a wheel", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("components/authority/Siren.module.css", "utf8");
    const keyframes = css.slice(css.indexOf("@keyframes turn"), css.indexOf("@media"));
    expect(keyframes).toMatch(/translateX\(var\(--reach\)\)/);
    expect(keyframes).toMatch(/translateX\(calc\(var\(--reach\) \* -1\)\)/);
    // Nothing rotates in the plane of the screen (that was the wheel).
    expect(css).not.toMatch(/rotate\(/);
    // Yellow for food and water, red and blue for a rescue.
    expect(css).toMatch(/\.supplies\s*\{[^}]*#ffc400/);
    expect(css).toMatch(/--lamp-a: #ff3b30/);
    expect(css).toMatch(/--lamp-b: #3d8bff/);
  });

  it("turns slowly enough to be safe, and not at all for someone who asked for less", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("components/authority/Siren.module.css", "utf8");
    // Two lamps opposite each other: one flash about every half turn. Keep a turn at 1.5 s or more.
    const seconds = [...css.matchAll(/animation: turn ([\d.]+)s/g)].map((m) => Number(m[1]));
    expect(seconds.length).toBeGreaterThan(0);
    for (const s of seconds) expect(s).toBeGreaterThanOrEqual(1.5);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{[\s\S]*animation: none/);
  });
});

/*
 * The war room's header writes the weather in words, from the `weather` words. The page only
 * hands the room the messages named in `authorityMessages`, so a missing group shows as the raw
 * key ("weather.codes.drizzle") - which is how the team found it on 24 Oct.
 */
describe("the war room's messages carry what its header says", () => {
  it("includes every weather word the header writes", async () => {
    const { authorityMessages } = await import("@/lib/messages");
    const weather = (authorityMessages(th) as unknown as { weather: Record<string, unknown> })
      .weather;
    expect(Object.keys(weather).sort()).toEqual(["chip", "codes", "modelTime"]);
    for (const key of ["reading", "readingAt", "readingNoTemp"]) {
      expect((weather.chip as Record<string, string>)[key]).toBeTruthy();
    }
    expect((weather.codes as Record<string, string>).drizzle).toBeTruthy();
  });
});
