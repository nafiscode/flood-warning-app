import { describe, expect, it } from "vitest";

import { alert, brand, darkBrand } from "@/lib/brand/tokens";
import type { PublicAlert, PublicStatus } from "@/lib/public-status";
import {
  toMapZones,
  zoneCollection,
  zoneLevel,
  zoneName,
  zonePaint,
  zoneTambonsAt,
  type MapZone,
} from "@/lib/zone-layer";

/** A live alert naming some tambons, as `public_alert_status()` hands it over. */
const live = (level: PublicAlert["level"], tambons: string[], hazard = "flood"): PublicAlert =>
  ({
    id: `a-${level}-${tambons.join("")}`,
    hazard,
    level,
    reason: "r",
    messages: {},
    issuedAt: "2026-11-23T01:00:00Z",
    nextUpdateAt: "2026-11-23T07:00:00Z",
    tambons,
  }) as unknown as PublicAlert;

const status = (alerts: PublicAlert[]): PublicStatus =>
  ({ inService: true, alerts }) as unknown as PublicStatus;

const zone = (tambons: string[]): MapZone => ({
  id: "z1",
  name: { th: "แม่น้ำปัตตานี", en: "Pattani River", ms: "Sungai Pattani" },
  basin: "pattani_river",
  hazardType: "flood",
  tambons,
  geom: { type: "Polygon", coordinates: [[[101, 6.5], [101.1, 6.5], [101.1, 6.6], [101, 6.5]]] },
});

describe("the warning zone on the map", () => {
  it("has no level when nothing is in force, and that is not an all-clear", () => {
    expect(zoneLevel(zone(["940101", "940102"]), status([]))).toBeNull();
    // No status at all reads the same way: no level. It never invents a calm one.
    expect(zoneLevel(zone(["940101"]), null)).toBeNull();
  });

  it("takes the most severe level in force anywhere inside it", () => {
    const s = status([live("evacuate", ["940103"]), live("watch", ["940101", "940102"])]);
    expect(zoneLevel(zone(["940101", "940102", "940103"]), s)).toBe("evacuate");
    // One tambon of the three is enough: a zone is not graded by how much of it is covered.
    expect(zoneLevel(zone(["940103"]), s)).toBe("evacuate");
  });

  it("ignores a tambon outside it, so a neighbouring basin never thickens this line", () => {
    const s = status([live("evacuate", ["960101"])]);
    expect(zoneLevel(zone(["940101", "940102"]), s)).toBeNull();
  });

  it("treats an all-clear as no level: 'normal' must not thicken the line", () => {
    const s = status([live("normal", ["940101"])]);
    expect(zoneLevel(zone(["940101"]), s)).toBeNull();
    expect(zoneTambonsAt(zone(["940101"]), s)).toBe(0);
  });

  it("answers for its own hazard only (every alert carries a hazard_type)", () => {
    const s = status([live("warning", ["940101"], "landslide")]);
    expect(zoneLevel(zone(["940101"]), s)).toBeNull();
    expect(zoneLevel(zone(["940101"]), s, "landslide")).toBe("warning");
  });

  it("counts the tambons an alert actually names, for the words beside the line", () => {
    const s = status([live("warning", ["940101", "940102"])]);
    expect(zoneTambonsAt(zone(["940101", "940102", "940103"]), s)).toBe(2);
  });

  it("is dashed and brand-coloured at rest, and solid in the alert palette in force", () => {
    const rest = zonePaint(null, false);
    expect(rest.color).toBe(brand["jaga-edge"]);
    expect(rest.dash.length).toBeGreaterThan(0);
    expect(zonePaint(null, true).color).toBe(darkBrand["jaga-edge"]);

    const inForce = zonePaint("warning", false);
    expect(inForce.color).toBe(alert.warning.bg);
    // Solid, and thicker: the form changes as well as the colour.
    expect(inForce.dash).toEqual([]);
    expect(inForce.width).toBeGreaterThan(rest.width);
    // The level's colour is the same by night: the alert palette does not move (docs/brand.md).
    expect(zonePaint("warning", true).color).toBe(alert.warning.bg);
    expect(zonePaint("evacuate", false).color).toBe(alert.evacuate.bg);
  });

  it("names itself in the reader's language, falling back through Thai to the basin", () => {
    expect(zoneName(zone([]), "ms")).toBe("Sungai Pattani");
    expect(zoneName({ name: { th: "ก" }, basin: "b" }, "en")).toBe("ก");
    expect(zoneName({ name: {}, basin: "u_taphao" }, "en")).toBe("u_taphao");
  });

  it("puts the level in words on the label, so colour is never the only sign", () => {
    const s = status([live("warning", ["940101"])]);
    const c = zoneCollection([zone(["940101"])], s, "en", (l) => `LEVEL-${l}`);
    const props = (c.features[0] as { properties: Record<string, unknown> }).properties;
    expect(props.label).toBe("Pattani River · LEVEL-warning");
    expect(props.level).toBe("warning");
    // The boolean the two line layers filter on, because MapLibre cannot drive a dash from data.
    expect(props.inForce).toBe(1);
    expect(props.tambonsAt).toBe(1);
  });

  it("labels a resting zone with its name alone, and says no level", () => {
    const c = zoneCollection([zone(["940101"])], status([]), "th", (l) => l);
    const props = (c.features[0] as { properties: Record<string, unknown> }).properties;
    expect(props.label).toBe("แม่น้ำปัตตานี");
    expect(props.level).toBe("");
    expect(props.inForce).toBe(0);
  });

  it("carries the geometry through untouched, so the outline is the stored one", () => {
    const z = zone(["940101"]);
    const c = zoneCollection([z], null, "th");
    expect((c.features[0] as { geometry: unknown }).geometry).toBe(z.geom);
    expect(c.type).toBe("FeatureCollection");
  });

  it("reads the rows the database sends, and drops a row it cannot draw", () => {
    const rows = [
      {
        id: "z1",
        name: { th: "ก", en: "A" },
        basin: "kolok",
        hazard_type: "flood",
        tambons: ["960101", 7, null],
        geom: { type: "Polygon", coordinates: [] },
      },
      // No geometry: nothing to draw, so it is left out rather than carried as an empty shape.
      { id: "z2", name: { th: "ข" }, basin: "u_taphao", geom: null },
      // No id, and not an object at all.
      { name: { th: "ค" }, basin: "x", geom: { type: "Polygon" } },
      "nonsense",
      null,
    ];
    const zones = toMapZones(rows);
    expect(zones).toHaveLength(1);
    const [kept] = zones;
    expect(kept?.id).toBe("z1");
    expect(kept?.basin).toBe("kolok");
    // A tambon code that is not a string is dropped, never coerced into one.
    expect(kept?.tambons).toEqual(["960101"]);
    expect(kept?.hazardType).toBe("flood");
  });

  it("degrades to nothing drawn when the read failed or the migration is not applied", () => {
    expect(toMapZones(null)).toEqual([]);
    expect(toMapZones({ message: "function does not exist" })).toEqual([]);
    expect(zoneCollection([], null, "th").features).toEqual([]);
  });

  it("defaults a row with no hazard_type to flood rather than leaving it unset", () => {
    const zones = toMapZones([
      { id: "z9", name: {}, basin: "b", geom: { type: "Polygon", coordinates: [] } },
    ]);
    expect(zones[0]?.hazardType).toBe("flood");
  });
});
