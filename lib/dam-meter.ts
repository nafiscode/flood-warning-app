/**
 * The geometry of the reservoir meters on the full-screen map (the owner, 23 Oct 2026: "show all
 * gauge chart but make it look like a real meter, to show on the map the real live water level
 * percentage"). Pure, so a test can hold it: where the needle points, where the arc ends and
 * where the "normal level" tick stands are all worked out here and drawn by components/map/
 * DamMeters.tsx, which decides nothing.
 *
 * It is a 270-degree dial like a pressure gauge: empty at the bottom left, full at the bottom
 * right, the gap at the foot where the reading sits. Angles are degrees clockwise from twelve
 * o'clock, which is how a person says where a needle points.
 */
export const METER_START = -135;
export const METER_END = 135;
const SWEEP = METER_END - METER_START;

/** The dial's drawing is a 200 x 200 square with its hub at the middle. */
export const METER_CENTRE = 100;

/** A reading as a share of the scale, kept on it: a reservoir at 103% still ends the arc at full. */
export function meterShare(percent: number | null): number {
  if (percent === null || !Number.isFinite(percent)) return 0;
  return Math.min(1, Math.max(0, percent / 100));
}

/** Where the needle points for a reading. A missing reading rests at empty, never mid-scale. */
export function meterAngle(percent: number | null): number {
  return METER_START + SWEEP * meterShare(percent);
}

/** A point on the dial at `radius` and `angle`. */
export function meterPoint(radius: number, angle: number): { x: number; y: number } {
  const rad = (angle * Math.PI) / 180;
  return {
    x: METER_CENTRE + radius * Math.sin(rad),
    y: METER_CENTRE - radius * Math.cos(rad),
  };
}

const fixed = (n: number) => Number(n.toFixed(2));

/** An SVG arc along the dial at `radius`, clockwise from `from` to `to`. */
export function meterArc(radius: number, from = METER_START, to = METER_END): string {
  const a = meterPoint(radius, from);
  const b = meterPoint(radius, to);
  const large = to - from > 180 ? 1 : 0;
  return `M${fixed(a.x)} ${fixed(a.y)} A${radius} ${radius} 0 ${large} 1 ${fixed(b.x)} ${fixed(b.y)}`;
}

export type MeterTick = {
  percent: number;
  major: boolean;
  /** The two ends of the tick's stroke. */
  from: { x: number; y: number };
  to: { x: number; y: number };
};

/** The scale: a tick every 5%, longer every 10%. */
export function meterTicks(inner = 79, outer = 86): MeterTick[] {
  return Array.from({ length: 21 }, (_, i) => {
    const percent = i * 5;
    const major = percent % 10 === 0;
    const angle = meterAngle(percent);
    return {
      percent,
      major,
      from: meterPoint(major ? inner - 3 : inner, angle),
      to: meterPoint(outer, angle),
    };
  });
}

/** The figures written on the scale. */
export const METER_LABELS = [0, 25, 50, 75, 100] as const;

/**
 * The reading as written inside the dial: whole when it is whole, one decimal otherwise, and
 * never rounded up past what it is - 99.96 must not read as 100 while the arc is not quite full.
 */
export function meterReading(percent: number | null): string | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  const down = Math.floor(percent * 10) / 10;
  return Number.isInteger(down) ? String(down) : down.toFixed(1);
}
