import { describe, expect, it } from "vitest";
import {
  METER_END,
  METER_START,
  meterAngle,
  meterArc,
  meterPoint,
  meterReading,
  meterShare,
  meterTicks,
} from "@/lib/dam-meter";

/*
 * The meters on the full-screen map (the owner, 23 Oct 2026). The component only draws what this
 * works out, so these are the numbers the needle and the arc will say.
 */
describe("the reservoir meter's geometry", () => {
  it("points the needle from empty at the lower left to full at the lower right", () => {
    expect(meterAngle(0)).toBe(METER_START);
    expect(meterAngle(50)).toBe(0);
    expect(meterAngle(100)).toBe(METER_END);
    expect(meterAngle(25)).toBeCloseTo(-67.5);
  });

  it("keeps an overfull reading on the scale and rests a missing one at empty", () => {
    expect(meterShare(103.5)).toBe(1);
    expect(meterAngle(103.5)).toBe(METER_END);
    expect(meterAngle(-4)).toBe(METER_START);
    // Never mid-scale: a reservoir nobody has heard from is not half full.
    expect(meterAngle(null)).toBe(METER_START);
    expect(meterShare(Number.NaN)).toBe(0);
  });

  it("puts twelve o'clock straight above the hub and the ends at the foot", () => {
    const top = meterPoint(80, 0);
    expect(top.x).toBeCloseTo(100);
    expect(top.y).toBeCloseTo(20);
    const start = meterPoint(80, METER_START);
    const end = meterPoint(80, METER_END);
    // Mirror images, both below the hub.
    expect(start.x + end.x).toBeCloseTo(200);
    expect(start.y).toBeCloseTo(end.y);
    expect(start.y).toBeGreaterThan(100);
  });

  it("draws the long way round for the whole scale and the short way for a part of it", () => {
    expect(meterArc(70)).toMatch(/^M[\d. ]+ A70 70 0 1 1 [\d. ]+$/);
    expect(meterArc(70, METER_START, meterAngle(30))).toContain("A70 70 0 0 1");
  });

  it("marks a tick every 5 percent and a long one every 10", () => {
    const ticks = meterTicks();
    expect(ticks).toHaveLength(21);
    expect(ticks.filter((t) => t.major).map((t) => t.percent)).toEqual([
      0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
    ]);
    // A long tick reaches further in than a short one.
    const [short, long] = [ticks[1]!, ticks[2]!];
    const reach = (t: (typeof ticks)[number]) => Math.hypot(t.to.x - t.from.x, t.to.y - t.from.y);
    expect(reach(long)).toBeGreaterThan(reach(short));
  });

  it("writes the reading as it is and never rounds a nearly full reservoir up to full", () => {
    expect(meterReading(48)).toBe("48");
    expect(meterReading(94.6)).toBe("94.6");
    expect(meterReading(99.96)).toBe("99.9");
    expect(meterReading(103.5)).toBe("103.5");
    expect(meterReading(null)).toBeNull();
  });
});
