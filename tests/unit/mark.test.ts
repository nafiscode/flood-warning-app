import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canopyPath, dotMark, easeInOut, FULL_MARK, SMALL_MARK, TURNS } from "@/lib/brand/mark";

const file = (name: string) => readFileSync(`public/brand/${name}`, "utf8");

describe("the turning mark (trial)", () => {
  it("at rest it is the static mark, character for character", () => {
    expect(file("jaga-mark.svg")).toContain(`d="${canopyPath(FULL_MARK)}"`);
    expect(file("jaga-mark-small.svg")).toContain(`d="${canopyPath(SMALL_MARK)}"`);
    expect(file("jaga-mark.svg")).toContain(`d="${FULL_MARK.stem.d}"`);
    expect(file("jaga-mark-small.svg")).toContain(`d="${SMALL_MARK.stem.d}"`);
  });

  it("a whole number of scallops later the canopy looks the same again", () => {
    expect(canopyPath(FULL_MARK, 1)).toBe(canopyPath(FULL_MARK, 0));
    expect(canopyPath(SMALL_MARK, 7)).toBe(canopyPath(SMALL_MARK, 0));
    expect(canopyPath(SMALL_MARK, 0.5)).not.toBe(canopyPath(SMALL_MARK, 0));
  });

  it("the dot is plain at rest and after every full turn, and shows its mark in between", () => {
    expect(dotMark(SMALL_MARK, 0).rx).toBe(0);
    expect(dotMark(SMALL_MARK, 360 * TURNS).rx).toBe(0);
    expect(dotMark(SMALL_MARK, 180).rx).toBeGreaterThan(0);
  });

  it("starts and stops gently", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.02)).toBeLessThan(0.002);
    expect(1 - easeInOut(0.98)).toBeLessThan(0.002);
  });
});
