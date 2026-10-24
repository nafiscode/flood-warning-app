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
