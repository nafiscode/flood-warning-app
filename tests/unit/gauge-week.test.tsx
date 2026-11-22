import { describe, expect, it } from "vitest";
import { GaugeWeek } from "@/components/map/GaugeWeek";
import { hasWeek, MIN_SPAN_M, riverWeek, WEEK_DAYS, WEEK_H, WEEK_W } from "@/lib/gauge-week";
import type { Gauge } from "@/lib/map-data";
import { renderWithIntl } from "./render";

/*
 * The week a river has had, as a line (the owner, 22 Nov 2026: "instead of just word we should
 * have a minimal graph to support the wording as well"). What is being kept honest here is mostly
 * about scale: a chart fitted to its own range alone turns two centimetres of wobble into a flood,
 * and a partial week drawn as a line reads as a week the river did not rise.
 */

/** X.119 on jaga-dev, the 8 days to 21 Nov 2026: a real riser, 3.47 m to 4.32 m. */
const RISING = [3.47, 3.35, 3.3, 3.51, 3.94, 4.32, 4.36, 4.32];
/** X.73A over the same days once its dropout is out of the way: a river that has not moved. */
const STILL = [22.24, 22.3, 22.25, 22.25, 22.24, 22.25, 22.22, 22.17];

const GAUGE: Gauge = {
  id: "g1",
  name: { th: "สถานีตัวอย่าง", en: "Example gauge" },
  lat: 6.8,
  lon: 101.2,
  value: 4.37,
  observedAt: "2026-11-22T09:00:00Z",
  status: "normal",
  roseDays: 5,
  weekChange: 0.85,
  weekFloors: RISING,
};

describe("what may be drawn at all", () => {
  it("needs the whole run of eight days", () => {
    expect(hasWeek(RISING)).toBe(true);
    expect(riverWeek(RISING)).not.toBeNull();
    // A partial week, a gap in the middle, or nothing at all: no line, so the card keeps the
    // sentence alone rather than drawing a week that is missing a day (safety rule 10).
    for (const bad of [
      RISING.slice(0, 7),
      [...RISING.slice(0, 4), null, ...RISING.slice(5)],
      [],
      null,
      undefined,
    ]) {
      expect(hasWeek(bad as (number | null)[])).toBe(false);
      expect(riverWeek(bad as (number | null)[])).toBeNull();
    }
  });

  it("renders nothing when there is no series, instead of an empty box", () => {
    const { container } = renderWithIntl(
      <GaugeWeek gauge={{ ...GAUGE, weekFloors: null }} />,
      "en",
    );
    expect(container.querySelector("[data-gauge-week-chart]")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });
});

describe("the vertical scale", () => {
  it("puts all eight points inside the box, in day order left to right", () => {
    const w = riverWeek(RISING)!;
    expect(w.points).toHaveLength(WEEK_DAYS);
    let lastX = -1;
    for (const p of w.points) {
      expect(p.x).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(WEEK_W);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(WEEK_H);
      expect(p.x).toBeGreaterThan(lastX);
      lastX = p.x;
    }
  });

  it("draws a still river still, rather than magnifying its noise into a flood", () => {
    /*
     * The whole point of the scale's floor. STILL moved 7 cm across the week; fitted to its own
     * range it would climb and fall the full height of the box and a reader would see a flood in
     * the noise of a river that has not moved.
     */
    const still = riverWeek(STILL)!;
    const used = Math.max(...still.points.map((p) => p.y)) - Math.min(...still.points.map((p) => p.y));
    const full = Math.max(...riverWeek(RISING)!.points.map((p) => p.y)) -
      Math.min(...riverWeek(RISING)!.points.map((p) => p.y));
    expect(still.high - still.low).toBeLessThan(0.2);
    expect(used).toBeLessThan(full / 2);
    // The floor is what did it: the range shown is never narrower than 30 cm.
    expect(still.top - still.bottom).toBeCloseTo(MIN_SPAN_M, 6);
    // And a still river sits in the middle of the box, not along an edge.
    const middle = (still.top + still.bottom) / 2;
    expect(middle).toBeCloseTo((still.low + still.high) / 2, 6);
  });

  it("gives a week that really moved the whole height of the box", () => {
    const w = riverWeek(RISING)!;
    expect(w.high - w.low).toBeGreaterThan(MIN_SPAN_M);
    expect(w.top).toBeCloseTo(w.high, 6);
    expect(w.bottom).toBeCloseTo(w.low, 6);
    // Higher metres are further up the page.
    const highest = w.points.reduce((a, b) => (b.metres > a.metres ? b : a));
    const lowest = w.points.reduce((a, b) => (b.metres < a.metres ? b : a));
    expect(highest.y).toBeLessThan(lowest.y);
  });
});

describe("the figures the line and the sentence share", () => {
  it("counts the rising days and the change the way the database does", () => {
    const w = riverWeek(RISING)!;
    // 3.35<3.47 no, 3.30 no, 3.51 yes, 3.94 yes, 4.32 yes, 4.36 yes, 4.32 no => 4 of 7.
    expect(w.rose).toBe(4);
    expect(w.change).toBe(0.85);
    expect(w.points.filter((p) => p.rose)).toHaveLength(4);
    // The first day has no day before it and is never counted as a rise.
    expect(w.points[0]!.rose).toBe(false);
  });

  it("rounds the change to centimetres, so the line and the words cannot disagree", () => {
    const w = riverWeek([1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.236])!;
    expect(w.change).toBe(0.24);
    // And a fall is a fall, not an absolute value: the sentence beside it picks its own wording.
    expect(riverWeek([2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 2.0, 1.75])!.change).toBe(-0.25);
  });
});

describe("the card", () => {
  it("says every one of the eight figures, so nothing is gated behind seeing it", () => {
    const { container } = renderWithIntl(<GaugeWeek gauge={GAUGE} />, "en");
    const svg = container.querySelector("svg")!;
    const label = svg.getAttribute("aria-label")!;
    for (const m of RISING) expect(label).toContain(m.toFixed(2));
    expect(label).toContain("oldest first");
    // The range the box covers, and which end is which day, are printed under it.
    expect(container.textContent).toContain("3.30");
    expect(container.textContent).toContain("4.36");
    expect(container.textContent).toMatch(/left is 8 days ago, right is yesterday/);
  });

  it("wears the river's own colour and never an alert colour, and draws no threshold", () => {
    const { container } = renderWithIntl(<GaugeWeek gauge={GAUGE} />, "en");
    const svg = container.querySelector("svg")!;
    expect(svg.innerHTML).toContain("var(--jaga-dam)");
    /*
     * A daily low below Watch says nothing about whether that day's peak was, so this chart
     * carries no level at all - a reading is not an alert (safety rules 2 and 8).
     */
    expect(svg.innerHTML).not.toContain("--alert-");
    expect(container.querySelectorAll("[data-section-line]")).toHaveLength(0);
  });

  it("marks yesterday's dot, which is the point a reader looks for first", () => {
    const { container } = renderWithIntl(<GaugeWeek gauge={GAUGE} />, "en");
    const dots = [...container.querySelectorAll("[data-week-point]")];
    expect(dots).toHaveLength(WEEK_DAYS);
    const last = dots[WEEK_DAYS - 1]!;
    expect(last.getAttribute("fill")).toBe("var(--jaga-dam)");
    expect(Number(last.getAttribute("r"))).toBeGreaterThan(
      Number(dots[0]!.getAttribute("r")),
    );
  });
});
