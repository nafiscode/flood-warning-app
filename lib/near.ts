/**
 * "Near" by distance, in one small leaf module so the cheap paths - the bell on every page, the
 * flood scene - can ask it without dragging in the whole monitoring graph (dam, weather, reports).
 * Moved out of lib/monitoring.ts on 24 Nov 2026 when the bell started needing it; monitoring
 * re-exports these, so every existing import keeps working.
 */

/** A point to measure distance from. */
export type Point = { lat: number; lon: number };

/**
 * How far from one of the person's own places a river gauge still counts as one of "their" rivers.
 *
 * A distance, not a province, on purpose: the public gauge feed carries a point but no tambon or
 * province, and the four provinces' bounding boxes overlap, so counting by box would put a station
 * in two provinces at once. A distance is the honest answer to a question about points.
 */
export const GAUGES_NEAR_KM = 50;

const EARTH_KM_PER_DEG = 111.32;

/**
 * The gauges within `km` of a point, by the same small-angle approximation lib/sea.ts and
 * lib/weather-grid.ts use: at this latitude and over these distances it is well inside the error
 * of the question being asked.
 */
export function gaugesNear<T extends Point>(
  gauges: readonly T[],
  point: Point,
  km = GAUGES_NEAR_KM,
): T[] {
  const scale = Math.cos((point.lat * Math.PI) / 180);
  const limit = (km / EARTH_KM_PER_DEG) ** 2;
  return gauges.filter((g) => {
    const dy = g.lat - point.lat;
    const dx = (g.lon - point.lon) * scale;
    return dy * dy + dx * dx <= limit;
  });
}

/** Whether a point is within `km` of any of several points (e.g. the person's area and watched places). */
export function nearAny(target: Point, points: readonly Point[], km = GAUGES_NEAR_KM): boolean {
  return points.some((p) => gaugesNear([target], p, km).length > 0);
}
