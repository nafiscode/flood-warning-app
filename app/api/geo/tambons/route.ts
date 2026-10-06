import { NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

type Row = {
  code: string;
  district_code: string;
  province_code: string;
  name_th: string;
  name_en: string;
  geom_web: unknown;
};

/**
 * Tambon outlines of the covered provinces as GeoJSON (the ~100 m web geometry, about 0.5 MB),
 * for the map pickers. Public reference data; fetched only when someone opens a map.
 */
export async function GET() {
  if (!supabaseConfigured()) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tambons")
    .select("code, district_code, province_code, name_th, name_en, geom_web")
    .order("code")
    .limit(2000);
  if (error || !data) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  const features = (data as Row[]).map(({ geom_web, ...properties }) => ({
    type: "Feature",
    geometry: geom_web,
    properties,
  }));
  return NextResponse.json(
    { type: "FeatureCollection", features },
    { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800" } },
  );
}
