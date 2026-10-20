/**
 * What the alert console reads and writes, on the server, with the admin's own session. Row-level
 * security and the admin_* functions in the A6 alert-console migration decide what is allowed
 * (safety rules 2 and 5); this file only shapes rows.
 */
import {
  toAdminAlert,
  toPreview,
  toTemplate,
  type AdminAlert,
  type AlertPreview,
  type AlertTemplate,
} from "@/lib/alert-console";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

export type Area = { code: string; name_th: string; name_en: string };
export type AlertAreas = {
  provinces: Area[];
  districts: (Area & { province_code: string })[];
  tambons: (Area & { district_code: string })[];
  zones: { id: string; name: Record<string, string>; tambons: string[] }[];
};

export async function readAlerts(limit = 100): Promise<AdminAlert[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_alerts", { p_limit: limit });
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(toAdminAlert).filter((a): a is AdminAlert => a !== null);
}

export async function readTemplates(): Promise<AlertTemplate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("alert_templates")
    .select("id, code, level, label, reason")
    .eq("active", true)
    .eq("hazard_type", "flood")
    .order("code");
  if (error) throw new Error(error.message);
  return ((data ?? []) as Row[]).map(toTemplate).filter((t): t is AlertTemplate => t !== null);
}

/** Every area an alert can name. 377 tambons, so one page of the API is enough. */
export async function readAreas(): Promise<AlertAreas> {
  const supabase = await createClient();
  const [provinces, districts, tambons, zones, links] = await Promise.all([
    supabase
      .from("provinces")
      .select("code, name_th, name_en")
      .eq("status", "active")
      .order("code"),
    supabase.from("districts").select("code, name_th, name_en, province_code").order("code"),
    supabase.from("tambons").select("code, name_th, name_en, district_code").order("code"),
    supabase.from("warning_zones").select("id, name").eq("hazard_type", "flood"),
    supabase.from("warning_zone_tambons").select("zone_id, tambon_code"),
  ]);
  const failed = [provinces, districts, tambons, zones, links].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);
  const active = new Set((provinces.data ?? []).map((p) => p.code as string));
  const byZone = new Map<string, string[]>();
  for (const l of links.data ?? []) {
    const list = byZone.get(l.zone_id as string) ?? [];
    list.push(l.tambon_code as string);
    byZone.set(l.zone_id as string, list);
  }
  return {
    provinces: (provinces.data ?? []) as AlertAreas["provinces"],
    districts: ((districts.data ?? []) as AlertAreas["districts"]).filter((d) =>
      active.has(d.province_code),
    ),
    tambons: ((tambons.data ?? []) as AlertAreas["tambons"]).filter((t) =>
      active.has(t.code.slice(0, 2)),
    ),
    zones: (zones.data ?? [])
      .map((z) => ({
        id: z.id as string,
        name: (z.name ?? {}) as Record<string, string>,
        tambons: byZone.get(z.id as string) ?? [],
      }))
      .filter((z) => z.tambons.length > 0),
  };
}

export function zoneMap(areas: AlertAreas): Record<string, string[]> {
  return Object.fromEntries(areas.zones.map((z) => [z.id, z.tambons]));
}

export async function previewAlert(
  template: string,
  tambons: string[],
  note: string,
  /** Ticked audiences: with any of them the preview returns the drill's words, not the template's. */
  drillAudience: readonly string[] = [],
): Promise<AlertPreview | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_alert_preview", {
    p_template: template,
    p_tambons: tambons,
    p_note: note || null,
    p_drill_audience: drillAudience,
  });
  if (error) throw new Error(error.message);
  return toPreview(data);
}

/**
 * The tambons that are somebody's home or watched place, for the "everywhere people use Jaga"
 * tick in the area chooser. Admin only, and worked out in the database: the browser is never
 * handed a map of where Jaga's users live.
 */
export async function peopleTambons(): Promise<string[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tambons_with_people");
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : []).map(String).filter((c) => /^[0-9]{6}$/.test(c));
}
