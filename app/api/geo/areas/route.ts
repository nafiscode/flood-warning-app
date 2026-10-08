import type { AreaDirectory } from "@/lib/area";
import { supabaseConfigured } from "@/lib/supabase/env";
import { CACHE_1H, createPublicClient, unavailable } from "@/lib/supabase/public";

/**
 * Names only, no outlines: all 77 provinces with their status, and the tambons of the covered
 * ones (about 30 KB). For choosing an area from a list and for the map's province selector.
 */
export async function GET() {
  if (!supabaseConfigured()) return unavailable();
  const supabase = createPublicClient();
  const [provinces, tambons] = await Promise.all([
    supabase.from("provinces").select("code, name_th, name_en, status").order("code"),
    supabase.rpc("tambon_directory").limit(2000),
  ]);
  if (provinces.error || tambons.error || !provinces.data || !tambons.data) return unavailable();
  const body: AreaDirectory = {
    provinces: provinces.data.map((p) => ({
      code: p.code as string,
      nameTh: p.name_th as string,
      nameEn: p.name_en as string,
      status: p.status as "active" | "coming_soon",
    })),
    tambons: (tambons.data as Record<string, unknown>[]).map((t) => ({
      code: t.code as string,
      nameTh: t.name_th as string,
      nameEn: t.name_en as string,
      districtCode: t.district_code as string,
      districtTh: t.district_th as string,
      districtEn: t.district_en as string,
      provinceCode: t.province_code as string,
      lat: t.lat as number,
      lon: t.lon as number,
    })),
  };
  return Response.json(body, { headers: { "Cache-Control": CACHE_1H } });
}
