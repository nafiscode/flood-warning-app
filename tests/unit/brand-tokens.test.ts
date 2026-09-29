import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/brand/contrast";
import { alert, brand, contrastPairs } from "@/lib/brand/tokens";

describe("contrast (WCAG AA, normal text 4.5:1)", () => {
  it.each(contrastPairs)("$name", ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("computes known reference values", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2);
  });
});

describe("app/globals.css mirrors lib/brand/tokens.ts", () => {
  const css = readFileSync("app/globals.css", "utf8").toLowerCase();
  const cssVar = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`).exec(css)?.[1];

  it.each(Object.entries(brand))("--%s", (name, hex) => {
    expect(cssVar(name)).toBe(hex.toLowerCase());
  });

  it.each(Object.entries(alert))("alert %s", (level, c) => {
    const base = level === "sos" ? "sos" : `alert-${level}`;
    expect(cssVar(base)).toBe(c.bg.toLowerCase());
    expect(cssVar(`${base}-fg`)).toBe(c.fg.toLowerCase());
  });
});
