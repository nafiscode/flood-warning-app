import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import {
  BRONZE,
  landPoints,
  LINK_DEG,
  linkAngle,
  linkOn,
  LOOK,
  project,
  SERVICE_POINT,
  spinAt,
  STILL_SPIN,
  TURN_MS,
} from "@/lib/globe";

/** Land points within `deg` degrees of a place, measured on the ground. */
function near(lat: number, lon: number, deg: number) {
  return landPoints().filter(
    ([a, b]) => Math.hypot(a - lat, (b - lon) * Math.cos((lat * Math.PI) / 180)) < deg,
  );
}

describe("the small turning Earth at the head of the map", () => {
  it("has the world's land as about a thousand dots, and the land where it is", () => {
    const all = landPoints();
    expect(all.length).toBeGreaterThan(1000);
    expect(all.length).toBeLessThan(1700);
    // The Malay peninsula, where Jaga works, is land; the Gulf of Thailand beside it is not.
    expect(near(SERVICE_POINT.lat, SERVICE_POINT.lon, 3.5).length).toBeGreaterThan(0);
    expect(near(10.5, 101.5, 1.6)).toHaveLength(0);
    // The Sahara is land and the middle of the Pacific is not.
    expect(near(23, 13, 3).length).toBeGreaterThan(0);
    expect(near(0, -150, 6)).toHaveLength(0);
  });

  it("projects onto the unit disc, the near side facing the reader", () => {
    const c = project(12, STILL_SPIN, STILL_SPIN);
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(0);
    expect(c.z).toBeCloseTo(1);
    // The far side of the world is behind the disc and is never drawn.
    expect(project(-12, STILL_SPIN + 180, STILL_SPIN).z).toBeLessThan(0);
    for (const [lat, lon] of landPoints().slice(0, 200)) {
      const p = project(lat, lon, 40);
      expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1);
    }
  });

  it("turns west to east, once a minute", () => {
    const a = spinAt(0);
    const b = spinAt(1000);
    // The centre longitude falls as the face moves to the right.
    expect((a - b + 360) % 360).toBeCloseTo(6);
    expect(spinAt(TURN_MS)).toBeCloseTo(a);
  });

  it("lights the link for a short part of each turn, and is lit in the still picture", () => {
    let on = 0;
    for (let s = -180; s < 180; s += 0.5) if (linkOn(s)) on++;
    const share = on / 720;
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.3);
    expect(linkOn(STILL_SPIN)).toBe(true);
    // The still picture is the service area as close under the satellite as the turn brings it.
    let best = Infinity;
    for (let s = -180; s < 180; s += 0.5) best = Math.min(best, linkAngle(s));
    expect(linkAngle(STILL_SPIN)).toBeLessThan(best + 2);
    expect(linkAngle(STILL_SPIN)).toBeLessThan(LINK_DEG);
    // And the opening seconds reach it, so a reader sees the link without waiting a minute.
    const firstOn = [...Array(60)].findIndex((_, i) => linkOn(spinAt(i * 250)));
    expect(firstOn).toBeGreaterThanOrEqual(0);
    expect(Math.hypot(LOOK.x, LOOK.y, LOOK.z)).toBeCloseTo(1);
  });

  it("keeps its bronze foil well away from the Watch and Warning colours", () => {
    const tokens = readFileSync("app/globals.css", "utf8");
    const level = (name: string) =>
      tokens.match(new RegExp(`--alert-${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1] ?? "";
    for (const foil of BRONZE) {
      for (const alert of [level("watch"), level("warning")]) {
        expect(deltaE(foil, alert), `${foil} vs ${alert}`).toBeGreaterThan(20);
      }
    }
  });

  it("says nothing: no figure or word in the drawing", () => {
    const source = readFileSync("components/map/OrbitGlobe.tsx", "utf8");
    expect(source).toContain('aria-hidden="true"');
    expect(source).not.toMatch(/fillText|<text/);
  });
});

function lab(hex: string): [number, number, number] {
  const lin = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92;
  };
  const [r, g, b] = [lin(1), lin(3), lin(5)];
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function deltaE(a: string, b: string) {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
