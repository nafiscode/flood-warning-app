import { describe, expect, it } from "vitest";
import { minePlaceFeature } from "@/lib/mine-label";
import {
  breath,
  drawHome,
  drawWatch,
  HOME_BREATH_MS,
  mineImageName,
  minePaint,
  WATCH_FOCUS_MS,
} from "@/lib/mine-marks";
import { GAUGE_FPS } from "@/lib/gauge-marks";
import { MINE_FPS } from "@/lib/mine-marks";

/** A canvas context that only records what was asked of it. */
function recorder() {
  const calls: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_, key) {
        if (typeof key !== "string") return undefined;
        return (...args: unknown[]) => {
          calls.push(
            `${key}(${args.map((a) => (typeof a === "number" ? a.toFixed(2) : a)).join(",")})`,
          );
        };
      },
      set(_, key, value) {
        calls.push(`${String(key)}=${value}`);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe("the marks for the person's own places", () => {
  it("breathe slowly and smoothly: still at the ends, fullest half-way", () => {
    expect(breath(0, HOME_BREATH_MS)).toBeCloseTo(0);
    expect(breath(HOME_BREATH_MS / 2, HOME_BREATH_MS)).toBeCloseTo(1);
    expect(breath(HOME_BREATH_MS, HOME_BREATH_MS)).toBeCloseTo(0);
    expect(breath(-HOME_BREATH_MS / 2, HOME_BREATH_MS)).toBeCloseTo(1);
    // Slower than a gauge's sway, and drawn less often: they say "kept in view", not "moving water".
    expect(Math.min(HOME_BREATH_MS, WATCH_FOCUS_MS)).toBeGreaterThan(2400);
    expect(MINE_FPS).toBeLessThan(GAUGE_FPS);
  });

  it("name one picture per kind, colour and theme, matching the feature the map reads", () => {
    expect(mineImageName("home", "#143044", false)).toBe("jaga-mine-home-143044-day");
    expect(mineImageName("watch", "#A98BD6", true)).toBe("jaga-mine-watch-a98bd6-night");
    const feature = minePlaceFeature({
      id: "p1",
      label: "Mother's house",
      lat: 6.8,
      lon: 101.2,
      home: false,
      color: "#A98BD6",
      lines: [],
      call: null,
    });
    expect(feature.properties.hex).toBe("a98bd6");
  });

  it("draw the home as a pin with a house, and a watched place as brackets around a dot", () => {
    const home = recorder();
    drawHome(home.ctx, 128, "#143044", false, 0);
    // The pin's head is an arc, closed at a tip; the house is a roof and two rectangles.
    expect(home.calls.filter((c) => c.startsWith("arc(")).length).toBeGreaterThanOrEqual(2);
    expect(home.calls.filter((c) => c.startsWith("rect(")).length).toBe(2);
    expect(home.calls).toContain("fillStyle=#143044");

    const watch = recorder();
    drawWatch(watch.ctx, 128, "#A98BD6", false, 0);
    // One dot, and four corners drawn twice (the outline under, the colour on top).
    expect(watch.calls.filter((c) => c.startsWith("arc(")).length).toBe(1);
    expect(watch.calls.filter((c) => c.startsWith("moveTo(")).length).toBe(8);
    expect(watch.calls).toContain("strokeStyle=#A98BD6");
  });

  it("bring the brackets in towards the dot and back out", () => {
    const corner = (t: number) => {
      const r = recorder();
      drawWatch(r.ctx, 128, "#A98BD6", false, t);
      // The first corner's elbow: lineTo after its first moveTo.
      const i = r.calls.findIndex((c) => c.startsWith("moveTo("));
      return Number(r.calls[i + 1]!.slice(7).split(",")[0]);
    };
    const open = corner(0);
    const closed = corner(WATCH_FOCUS_MS / 2);
    expect(closed).toBeGreaterThan(open); // the top-left corner moves right, towards the centre
    expect(corner(WATCH_FOCUS_MS)).toBeCloseTo(open);
  });

  it("keep an outline that stands off both basemaps", () => {
    expect(minePaint(false).outline).toBe("#ffffff");
    expect(minePaint(true).outline).not.toBe("#ffffff");
  });
});
