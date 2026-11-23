/**
 * The warning zone's own outline on the public map (the owner, 22 Nov 2026: "in the map should
 * highlight the warning zone, for all users to see, not just the affected users").
 *
 * A warning zone is the river basin Jaga issues for: the unit an admin ticks a gauge into, and
 * the unit `auto_alarm_check()` publishes for. Until now it was invisible to residents, who saw
 * only the result - their own tambon's colour. Someone one tambon outside an alert, upstream on
 * the same river, could not see that the warning beside them follows the water they live on.
 *
 * ## Why an outline and not another coloured area
 *
 * The map's colours are already spent: the alert palette on the tambons, ink on report hexagons,
 * safe places and gauges, the water colour on the river, the dam and the sea, and ten cool shades
 * on the places a person watches. A filled zone would be a second amber over the top of the first
 * and would hide the tambon colours underneath, which are the thing that actually tells a reader
 * about their own home. So the zone is a **line**, drawn over everything, with its name on it.
 *
 * ## What the line says, and how
 *
 * At rest it is the brand's edge colour and dashed: context, "this is the basin", no status - the
 * same rule the river body follows (lib/river-layer.ts). Brand colours never show a level.
 *
 * When an alert is in force anywhere inside it, the line goes solid, thicker, and takes that
 * level's colour from the alert palette - and its label gains the level in words. That is the
 * accessibility rule kept, not bent: never colour alone, always icon + text + colour (the dash
 * pattern is the form, the label is the text). A reader who separates no hues at all still sees a
 * thin broken line become a thick unbroken one with a word beside it.
 *
 * ## One definition of "in force"
 *
 * `zoneLevel()` takes the live alerts the page already holds and asks `alertForTambon()` - the
 * very function that colours each tambon - for every tambon in the zone, then keeps the most
 * severe answer. Nothing here decides what is in force, and no second rule exists that could
 * drift from the first. A zone whose tambons are all normal has no level, and that is drawn as
 * the resting line, never as an all-clear (safety rule 10): the line says which basin this is,
 * and it says nothing about whether the basin is safe.
 */

import { alert, brand, darkBrand, type AlertLevel } from "@/lib/brand/tokens";
import { alertForTambon, type PublicStatus } from "@/lib/public-status";

export const ZONE_SOURCE = "jaga-warning-zones";
/** The resting line: dashed, so it is its own layer - MapLibre cannot dash from a property. */
export const ZONE_LINE_LAYER = "jaga-warning-zone-line";
/** The line where an alert is in force: solid, thicker, in that level's colour. */
export const ZONE_IN_FORCE_LAYER = "jaga-warning-zone-in-force";
export const ZONE_LABEL_LAYER = "jaga-warning-zone-label";

/** What the map needs of a zone. `tambons` is the zone's membership, by six-digit DOPA code. */
export type MapZone = {
  id: string;
  /** Per-locale names, as `warning_zones.name` stores them. */
  name: Record<string, string>;
  basin: string;
  hazardType: string;
  tambons: string[];
  /** GeoJSON geometry, straight from `warning_zone_map()`. */
  geom: unknown;
};

/**
 * Only for ordering "most severe wins" inside a zone. It is deliberately a separate, local table
 * from `severity()` in lib/public-status.ts, which ranks an `AreaStatus`: this ranks a level.
 * `return` sits just above normal, as it does there.
 */
const RANK: Record<AlertLevel, number> = {
  normal: 0,
  return: 1,
  watch: 2,
  warning: 3,
  evacuate: 4,
};

/**
 * The most severe level in force anywhere in the zone, or null when none is.
 *
 * `normal` counts as no level: an alert that says "normal" is an all-clear and must not thicken
 * the line as though something were happening.
 */
export function zoneLevel(
  zone: Pick<MapZone, "tambons">,
  status: PublicStatus | null,
  hazard = "flood",
): AlertLevel | null {
  if (!status) return null;
  let best: AlertLevel | null = null;
  for (const tambon of zone.tambons) {
    const found = alertForTambon(status, tambon, hazard);
    if (!found || found.level === "normal") continue;
    if (!best || RANK[found.level] > RANK[best]) best = found.level;
  }
  return best;
}

/** How many of the zone's tambons an alert above normal actually names, for the words beside it. */
export function zoneTambonsAt(
  zone: Pick<MapZone, "tambons">,
  status: PublicStatus | null,
  hazard = "flood",
): number {
  if (!status) return 0;
  return zone.tambons.filter((t) => {
    const found = alertForTambon(status, t, hazard);
    return !!found && found.level !== "normal";
  }).length;
}

export type ZonePaint = {
  color: string;
  width: number;
  /** Empty means a solid line. MapLibre wants the dash in line-widths, so it scales with it. */
  dash: number[];
  opacity: number;
  label: string;
  halo: string;
};

/** The resting line: the brand's edge, dashed, thin. Context, and no status. */
const AT_REST = { width: 1.6, dash: [3, 2], opacity: 0.8 };
/** In force: solid, and wide enough to read over a coloured tambon. */
const IN_FORCE = { width: 3.4, dash: [] as number[], opacity: 1 };

export function zonePaint(level: AlertLevel | null, dark: boolean): ZonePaint {
  const shape = level ? IN_FORCE : AT_REST;
  return {
    // A level takes the alert palette; no level takes the brand edge, which by rule shows none.
    color: level ? alert[level].bg : dark ? darkBrand["jaga-edge"] : brand["jaga-edge"],
    ...shape,
    label: dark ? darkBrand["jaga-ink"] : brand["jaga-slate"],
    halo: dark ? darkBrand["jaga-ground"] : "#ffffff",
  };
}

/** The zone's name in the reader's language, falling back through Thai to the basin's key. */
export function zoneName(zone: Pick<MapZone, "name" | "basin">, locale: string): string {
  return zone.name?.[locale] ?? zone.name?.th ?? zone.basin;
}

/** `warning_zone_map()`'s rows, checked one field at a time; a bad row is dropped, not guessed. */
export function toMapZones(rows: unknown): MapZone[] {
  if (!Array.isArray(rows)) return [];
  const zones: MapZone[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : null;
    const basin = typeof r.basin === "string" ? r.basin : null;
    // No geometry, nothing to draw: the zone is left out rather than carried as an empty shape.
    if (!id || !basin || !r.geom || typeof r.geom !== "object") continue;
    const name: Record<string, string> = {};
    if (r.name && typeof r.name === "object") {
      for (const [k, v] of Object.entries(r.name as Record<string, unknown>)) {
        if (typeof v === "string") name[k] = v;
      }
    }
    zones.push({
      id,
      name,
      basin,
      hazardType: typeof r.hazard_type === "string" ? r.hazard_type : "flood",
      tambons: Array.isArray(r.tambons)
        ? r.tambons.filter((t): t is string => typeof t === "string")
        : [],
      geom: r.geom,
    });
  }
  return zones;
}

/**
 * The zones as one GeoJSON FeatureCollection, each feature carrying what the layers draw by.
 *
 * `levelWord` is the caller's translator for a level, so the label carries the level in the
 * reader's own language. It is passed in rather than looked up here because this module is pure
 * and testable without a React tree, and because the words must be the reviewed ones the badges
 * already use (`alert.level.*`), never a second set written for the map.
 *
 * MapLibre cannot drive `line-dasharray` from a feature's properties, so `inForce` is on every
 * feature: the two line layers filter on it, one solid and one dashed. That is why the level is
 * carried both as a word and as a boolean.
 */
export function zoneCollection(
  zones: readonly MapZone[],
  status: PublicStatus | null,
  locale: string,
  levelWord?: (level: AlertLevel) => string,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: zones.map((z): GeoJSON.Feature => {
      const level = zoneLevel(z, status);
      const name = zoneName(z, locale);
      const word = level && levelWord ? levelWord(level) : null;
      return {
        type: "Feature",
        id: z.id,
        // Checked by `toMapZones`, which drops any row whose geometry is not an object.
        geometry: z.geom as GeoJSON.Geometry,
        properties: {
          id: z.id,
          basin: z.basin,
          name,
          // The level in words beside the name, so the thicker line is never the only sign of it.
          label: word ? `${name} · ${word}` : name,
          level: level ?? "",
          inForce: level ? 1 : 0,
          tambonsAt: zoneTambonsAt(z, status),
        },
      };
    }),
  };
}
