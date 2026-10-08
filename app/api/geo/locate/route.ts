import type { NextRequest } from "next/server";
import { parseLatLon, type Located } from "@/lib/area";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createPublicClient, NO_STORE, unavailable } from "@/lib/supabase/public";

/**
 * Which tambon a position is in. Used once when someone taps "use my location" on the home
 * screen; the position is not stored or logged, and the answer is never cached.
 * Outside the covered provinces the answer names the province only, so the app can say that
 * Jaga doesn't cover it yet instead of showing any status (safety rule 10).
 */
export async function GET(request: NextRequest) {
  const point = parseLatLon(
    request.nextUrl.searchParams.get("lat"),
    request.nextUrl.searchParams.get("lon"),
  );
  if (!point) return unavailable(400);
  if (!supabaseConfigured()) return unavailable();
  const { data, error } = await createPublicClient().rpc("locate_area", {
    p_lat: point.lat,
    p_lon: point.lon,
  });
  if (error || !Array.isArray(data)) return unavailable();
  const row = data[0] as Record<string, string | null> | undefined;
  let body: Located;
  if (!row) {
    body = { kind: "outside" };
  } else if (!row.tambon_code || row.province_status !== "active") {
    body = {
      kind: "notCovered",
      province: {
        code: row.province_code!,
        nameTh: row.province_th!,
        nameEn: row.province_en!,
        status: "coming_soon",
      },
    };
  } else {
    body = {
      kind: "tambon",
      area: {
        code: row.tambon_code,
        nameTh: row.tambon_th!,
        nameEn: row.tambon_en!,
        districtTh: row.district_th!,
        districtEn: row.district_en!,
        provinceTh: row.province_th!,
        provinceEn: row.province_en!,
        lat: point.lat,
        lon: point.lon,
        from: "gps",
      },
    };
  }
  return Response.json(body, { headers: { "Cache-Control": NO_STORE } });
}
