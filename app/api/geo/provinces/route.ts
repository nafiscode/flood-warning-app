import { NextResponse } from "next/server";
import { PROVINCE_CAPITALS } from "@/lib/map";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

type Row = { code: string; name_th: string; name_en: string; geom_web: unknown };

/**
 * The four covered provinces as GeoJSON: each outline, and a point at its capital town carrying
 * the province's names, for the Flood Risk Map's four-province view (lib/map.ts, quietOverview).
 * Public reference data, the same for everyone.
 */
export async function GET() {
  if (!supabaseConfigured()) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("provinces")
    .select("code, name_th, name_en, geom_web")
    .eq("status", "active")
    .order("code");
  if (error || !data) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const features = (data as Row[]).flatMap(({ geom_web, ...names }) => {
    const capital = PROVINCE_CAPITALS[names.code];
    return [
      { type: "Feature", geometry: geom_web, properties: { ...names, kind: "province" } },
      ...(capital
        ? [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: capital },
              properties: { ...names, kind: "capital" },
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
