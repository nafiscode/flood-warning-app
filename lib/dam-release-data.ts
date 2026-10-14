import type { SupabaseClient } from "@supabase/supabase-js";
import type { DamForRelease } from "@/components/admin/DamReleaseForm";
import type { DamArrival } from "@/lib/dam-arrival";

type Row = Record<string, unknown>;

/**
 * The dams a release notice can be sent for, with their zone's measured arrival ranges and the
 * newest outflow, read as the signed-in admin. Used by the admins' sending screen and by the dam
 * operator's preview (14 Oct), so both offer exactly the same dams and figures.
 *
 * Only a dam with a zone is offered (14 Oct 2026): `admin_send_dam_release` refuses one with no
 * tambons, and offering it would be offering a button that cannot work.
 */
export async function readDamsForRelease(supabase: SupabaseClient): Promise<DamForRelease[]> {
  const [map, arrivals, state, notices] = await Promise.all([
    supabase.rpc("dam_map"),
    supabase
      .from("dam_arrivals")
      .select("dam_code, tambon_code, via, km_from_dam, warn_from_h, earliest_h, latest_h")
      .order("km_from_dam"),
    supabase.rpc("dam_state"),
    supabase.rpc("admin_dam_board"),
  ]);

  const byDam = new Map<string, DamArrival[]>();
  for (const row of (arrivals.data ?? []) as Row[]) {
    const code = String(row.dam_code);
    const list = byDam.get(code) ?? [];
    list.push({
      tambon: String(row.tambon_code),
      via: row.via as DamArrival["via"],
      kmFromDam: Number(row.km_from_dam ?? 0),
      warnFromH: Number(row.warn_from_h ?? 0),
      earliestH: Number(row.earliest_h ?? 0),
      latestH: Number(row.latest_h ?? 0),
      peakEarliestH: 0,
      peakLatestH: 0,
      source: "",
    });
    byDam.set(code, list);
  }
  const outflow = new Map<string, number | null>(
    ((state.data ?? []) as Row[]).map((row) => {
      const signal = row.signal as Row | null;
      const cms = signal && typeof signal.outflow_cms === "number" ? signal.outflow_cms : null;
      return [String(row.code), cms];
    }),
  );
  // An open war-room row, so sending from the admins' screen closes the loop the feed opened.
  const openNotice = new Map<string, string | null>(
    ((notices.data ?? []) as Row[]).map((row) => [
      String(row.code),
      row.notice_status === "open" ? String(row.notice_id) : null,
    ]),
  );

  return ((map.data ?? []) as Row[])
    .filter((row) => Number(row.tambons ?? 0) > 0)
    .map((row) => {
      const code = String(row.code);
      const list = byDam.get(code) ?? [];
      return {
        code,
        name: (row.name ?? {}) as Record<string, string>,
        river: (row.river ?? {}) as Record<string, string>,
        operator: String(row.operator ?? ""),
        tambons: list.length,
        arrivals: list,
        outflowCms: outflow.get(code) ?? null,
        noticeId: openNotice.get(code) ?? null,
      };
    });
}
