import { NextResponse } from "next/server";

import { PROVINCE_CAPITALS } from "@/lib/map";

import outlines from "./outlines.generated.json";

type Outline = {
  type: "Feature";
  geometry: unknown;
  properties: { code: string; name_th: string; name_en: string; kind: string };
};

/**
 * The four covered provinces as GeoJSON: each outline, and a point at its capital town carrying
 * the province's names, for the Flood Risk Map's four-province view (lib/map.ts, quietOverview).
 * Public reference data, the same for everyone.
 *
 * The outlines are the dissolve of the tambon polygons (ST_Union by province), not the provinces
 * table's own coarser geometry, so the province border sits exactly on the tambon borders the map
 * draws (the owner, 25 Oct 2026: the two were not aligned; the tambon one has the better detail).
 * Regenerate with `node scripts/gen-province-outlines.mjs` after the tambon boundaries change.
 */
export function GET() {
  const features = (outlines as { features: Outline[] }).features.flatMap((province) => {
    const capital = PROVINCE_CAPITALS[province.properties.code];
    const { code, name_th, name_en } = province.properties;
    return [
      province,
      ...(capital
        ? [
            {
              type: "Feature" as const,
              geometry: { type: "Point", coordinates: capital },
              properties: { code, name_th, name_en, kind: "capital" },
            },
          ]
        : []),
    ];
  });
  return NextResponse.json(
    { type: "FeatureCollection", features },
    { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } },
  );
}
