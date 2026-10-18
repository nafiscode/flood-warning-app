import type { TambonEntry } from "@/lib/area";

/**
 * The names of the places themselves on the map (the owner, 18 Oct 2026): with all four provinces
 * in view only the provinces are named, and as the reader zooms in the districts appear, then the
 * tambons - so by the time the map is at the extent of their own place, they can read where they
 * are without tapping anything.
 *
 * The basemap cannot do this: OpenFreeMap names towns and villages, not Thai amphoe and tambon.
 * The names come from Jaga's own area list (`/api/geo/areas`), which the map page already has for
 * the province picker, so a named map costs no extra request. Each tambon's point is the one the
 * database works out inside its outline (public.tambon_directory, st_pointonsurface), and a
 * district is named at the middle of its tambons' points.
 */
export type AreaLabel = {
  kind: "district" | "tambon";
  /** The DOPA code: 4 digits for a district, 6 for a tambon. */
  code: string;
  label: string;
  lon: number;
  lat: number;
};

/** Thai writes the rank with the name, as the rest of the app does ("อ.เมืองปัตตานี", "ต.บานา"). */
function districtLabel(locale: string, entry: TambonEntry): string {
  return locale === "th" ? `อ.${entry.districtTh}` : entry.districtEn || entry.districtTh;
}
function tambonLabel(locale: string, entry: TambonEntry): string {
  return locale === "th" ? `ต.${entry.nameTh}` : entry.nameEn || entry.nameTh;
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;

/**
 * One label per tambon and one per district, in the reader's language. Entries without a point
 * (a boundary the pipeline could not place) are left out rather than drawn at 0, 0.
 */
export function areaLabels(tambons: readonly TambonEntry[], locale: string): AreaLabel[] {
  const placed = tambons.filter(
    (t) => Number.isFinite(t.lat) && Number.isFinite(t.lon) && (t.lat !== 0 || t.lon !== 0),
  );
  const districts = new Map<string, { label: string; lon: number; lat: number; n: number }>();
  const labels: AreaLabel[] = [];
  for (const entry of placed) {
    labels.push({
      kind: "tambon",
      code: entry.code,
      label: tambonLabel(locale, entry),
      lon: round(entry.lon),
      lat: round(entry.lat),
    });
    const held = districts.get(entry.districtCode);
    if (held) {
      held.lon += entry.lon;
      held.lat += entry.lat;
      held.n += 1;
    } else {
      districts.set(entry.districtCode, {
        label: districtLabel(locale, entry),
        lon: entry.lon,
        lat: entry.lat,
        n: 1,
      });
    }
  }
  for (const [code, d] of districts) {
    labels.push({
      kind: "district",
      code,
      label: d.label,
      lon: round(d.lon / d.n),
      lat: round(d.lat / d.n),
    });
  }
  return labels;
}

/** The labels as GeoJSON, for the map's two name layers to filter by `kind`. */
export function areaLabelFeatures(labels: readonly AreaLabel[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: labels.map((l) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [l.lon, l.lat] },
      properties: { kind: l.kind, code: l.code, label: l.label },
    })),
  };
}
