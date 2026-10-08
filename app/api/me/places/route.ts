import type { Area } from "@/lib/area";
import type { MyPlaces, WatchedPlace } from "@/lib/me";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

type Point = { coordinates: [number, number] } | null;
type TambonRow = {
  code: string;
  name_th: string;
  name_en: string;
  province_code: string;
  districts: { name_th: string; name_en: string } | null;
};

/**
 * The signed-in person's home and watched places, for the home screen. Read with their own
 * session, so row-level security returns only their own rows; never cached. The home screen
 * asks only when the browser holds a session, so visitors never reach this.
 */
export async function GET() {
  const answer = (body: MyPlaces) =>
    Response.json(body, { headers: { "Cache-Control": NO_STORE } });
  if (!supabaseConfigured()) return answer({ signedIn: false });
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims.sub;
  if (!userId) return answer({ signedIn: false });

  const [profile, saved] = await Promise.all([
    supabase.from("profiles").select("home_point, home_tambon").eq("user_id", userId).maybeSingle(),
    supabase
      .from("saved_places")
      .select("id, label, point, tambon, contact_name, contact_phone")
      .eq("user_id", userId)
      .order("created_at"),
  ]);
  if (profile.error || saved.error) {
    return Response.json(
      { error: "unavailable" },
      { status: 503, headers: { "Cache-Control": NO_STORE } },
    );
  }

  const codes = [
    profile.data?.home_tambon as string | null,
    ...(saved.data ?? []).map((p) => p.tambon as string | null),
  ].filter((c): c is string => !!c);
  const names = new Map<string, TambonRow>();
  const provinces = new Map<string, { name_th: string; name_en: string }>();
  if (codes.length > 0) {
    const [tambons, provinceRows] = await Promise.all([
      supabase
        .from("tambons")
        .select("code, name_th, name_en, province_code, districts(name_th, name_en)")
        .in("code", codes),
      supabase.from("provinces").select("code, name_th, name_en").eq("status", "active"),
    ]);
    for (const t of (tambons.data ?? []) as unknown as TambonRow[]) names.set(t.code, t);
    for (const p of provinceRows.data ?? []) {
      provinces.set(p.code as string, {
        name_th: p.name_th as string,
        name_en: p.name_en as string,
      });
    }
  }
  const area = (code: string | null, point: Point): Area | null => {
    const t = code ? names.get(code) : undefined;
    if (!t || !point) return null;
    const province = provinces.get(t.province_code);
    return {
      code: t.code,
      nameTh: t.name_th,
      nameEn: t.name_en,
      districtTh: t.districts?.name_th ?? "",
      districtEn: t.districts?.name_en ?? "",
      provinceTh: province?.name_th ?? "",
      provinceEn: province?.name_en ?? "",
      lat: point.coordinates[1],
      lon: point.coordinates[0],
      from: "account",
    };
  };

  const places: WatchedPlace[] = (saved.data ?? []).map((p) => ({
    id: p.id as string,
    label: p.label as string,
    area: area(p.tambon as string | null, p.point as Point),
    contactName: (p.contact_name as string | null) ?? null,
    contactPhone: (p.contact_phone as string | null) ?? null,
  }));
  return answer({
    signedIn: true,
    home: area(
      (profile.data?.home_tambon as string | null) ?? null,
      (profile.data?.home_point as Point) ?? null,
    ),
    places,
  });
}
