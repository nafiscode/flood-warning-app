import type { Dam } from "@/lib/dam";

/**
 * The six things the Flood Risk Map is for (the owner, 15 Oct: people should find them without
 * hunting through the legend; the sea and coast added the same day). The home screen's tiles open the map on one with `?focus=`, and the
 * row of chips above the map goes to one in place. Pure, so both can be tested without a map.
 */
export const MAP_FOCUSES = ["risk", "places", "damzone", "gauges", "dam", "sea"] as const;
export type MapFocus = (typeof MAP_FOCUSES)[number];

/**
 * The order of the chips above the map (the owner, 15 Oct): the flood-risk areas first, then what
 * changes while someone looks, then the dam's land, and the thousands of safe places last. The
 * home screen's tiles keep MAP_FOCUSES.
 */
export const CHIP_ORDER: readonly MapFocus[] = [
  "risk",
  "gauges",
  "sea",
  "dam",
  "damzone",
  "places",
];

export function readFocus(value: string | null | undefined): MapFocus | null {
  return MAP_FOCUSES.find((f) => f === value) ?? null;
}

/** The map, opened on one of its features. */
export function focusHref(focus: MapFocus): { pathname: "/map"; query: { focus: MapFocus } } {
  return { pathname: "/map", query: { focus } };
}

/**
 * The dam the chips and tiles mean: the largest one whose zone or path is mapped (Bang Lang).
 * Before the dams arrive, its code, so the first paint can already ask for its card.
 */
export const MAIN_DAM = "bang_lang";
export function mainDam(dams: Dam[]): Dam | undefined {
  const withPath = dams.filter((d) => (d.zones?.length ?? 0) > 0 || d.reaches.length > 0);
  const pool = withPath.length > 0 ? withPath : dams;
  return (
    pool.find((d) => d.code === MAIN_DAM) ??
    [...pool].sort((a, b) => (b.storageMaxMcm ?? 0) - (a.storageMaxMcm ?? 0))[0]
  );
}

/**
 * Where the land below a dam lies that its river can reach: the corners of the zone's outlines
 * once they have arrived, else the mapped river path, else the dam itself. Depth-blind, like
 * damFrame, so a Polygon and a MultiPolygon are read alike.
 */
export function zoneFrame(dam: Dam): { lon: number; lat: number }[] {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  const walk = (part: unknown): void => {
    if (!Array.isArray(part)) return;
    if (typeof part[0] === "number" && typeof part[1] === "number") {
      const [lon, lat] = part as [number, number];
      if (lon < west) west = lon;
      if (lon > east) east = lon;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
      return;
    }
    for (const deeper of part) walk(deeper);
  };
  for (const zone of dam.zones ?? []) walk(zone.geometry.coordinates);
  if (!Number.isFinite(west)) {
    for (const reach of dam.reaches) walk(reach.line.coordinates);
  }
  if (!Number.isFinite(west)) {
    return dam.point ? [{ lon: dam.point.coordinates[0], lat: dam.point.coordinates[1] }] : [];
  }
  return [
    { lon: west, lat: south },
    { lon: east, lat: north },
  ];
}
