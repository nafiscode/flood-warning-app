import type { SupabaseClient } from "@supabase/supabase-js";
import type { DamForRelease } from "@/components/admin/DamReleaseForm";
import type { DamArrival } from "@/lib/dam-arrival";

/**
 * The dam operator's screen (docs/spec.md section 15, A12 part 2).
 *
 * What an operator is allowed to see is deliberately narrow, and it is the database that decides:
 * `my_operator_dams()` answers with the dams this account holds through a verified link an admin
 * made, and everything below is filtered to those. The figures themselves (the dam, the zone, the
 * measured arrival ranges) are public data and are read the ordinary way.
 *
 * This file is the operator's twin of lib/dam-release-data.ts, which reads the same things for an
 * admin. They are kept apart rather than parameterised because the admin's version asks
 * `admin_dam_board()` for the war-room row, which an operator may not read at all.
 */

type Row = Record<string, unknown>;

export type OperatorDam = { code: string; unitId: string; unitName: string };

/** The dams this account may send for. Empty for everyone else, which is most people. */
export async function readMyOperatorDams(supabase: SupabaseClient): Promise<OperatorDam[]> {
  const { data, error } = await supabase.rpc("my_operator_dams");
  if (error || !Array.isArray(data)) return [];
  return (data as Row[]).map((r) => ({
    code: String(r.dam_code),
    unitId: String(r.unit_id),
    unitName: String(r.unit_name ?? ""),
  }));
}

/**
 * The same shape the admins' sending screen uses, so one form serves both and the operator reads
 * exactly the notice an admin would have read. Only the operator's own dams are included; a dam
 * with no zone is left out, because `publish_dam_release` refuses one and offering it would be
 * offering a button that cannot work.
 */
export async function readOperatorDams(
  supabase: SupabaseClient,
  mine: readonly OperatorDam[],
): Promise<DamForRelease[]> {
  if (mine.length === 0) return [];
  const codes = mine.map((m) => m.code);
  const [map, arrivals, state] = await Promise.all([
    supabase.rpc("dam_map"),
    supabase
      .from("dam_arrivals")
      .select("dam_code, tambon_code, via, km_from_dam, warn_from_h, earliest_h, latest_h")
      .in("dam_code", codes)
      .order("km_from_dam"),
    supabase.rpc("dam_state"),
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

  return ((map.data ?? []) as Row[])
    .filter((row) => codes.includes(String(row.code)) && Number(row.tambons ?? 0) > 0)
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
        // The war-room row is an admin's thing. The database picks it up for the operator when
        // they send; they are never shown it, because it is not theirs to judge.
        noticeId: null,
      };
    });
}

/** One notice of this operator's own dam, as `operator_dam_releases()` gives it. */
export type OperatorRelease = {
  alertId: string;
  damCode: string;
  level: "watch" | "warning" | "evacuate";
  releaseCms: number | null;
  gatesOpenAt: string | null;
  gatesClosedAt: string | null;
  expectedEndAt: string | null;
  /** 'dam_release' while the gates are open; 'dam_release_end' once the operator said they shut. */
  kind: "dam_release" | "dam_release_end";
  isDrill: boolean;
  /** Sent from the dam, not from Jaga's console: the only kind the operator may end or withdraw. */
  mine: boolean;
  tambons: number;
  issuedAt: string;
  nextUpdateAt: string;
  cancelledAt: string | null;
};

const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export async function readOperatorReleases(supabase: SupabaseClient): Promise<OperatorRelease[]> {
  const { data, error } = await supabase.rpc("operator_dam_releases");
  if (error || !Array.isArray(data)) return [];
  return (data as Row[]).map((r) => ({
    alertId: String(r.alert_id),
    damCode: String(r.dam_code ?? ""),
    level: r.level as OperatorRelease["level"],
    releaseCms: r.release_cms === null ? null : Number(r.release_cms),
    gatesOpenAt: text(r.gates_open_at),
    gatesClosedAt: text(r.gates_closed_at),
    expectedEndAt: text(r.expected_end_at),
    kind: r.kind === "dam_release_end" ? "dam_release_end" : "dam_release",
    isDrill: r.is_drill === true,
    mine: r.mine === true,
    tambons: Number(r.tambons ?? 0),
    issuedAt: String(r.issued_at),
    nextUpdateAt: String(r.next_update_at),
    cancelledAt: text(r.cancelled_at),
  }));
}

/**
 * Ending and withdrawing are not the same reach, and the database draws the line in the same
 * place as these two.
 *
 * The gates shutting is a fact only the dam knows and it changes no level, so the operator may
 * say it about any notice in force for their dam - including one a Jaga admin sent while the dam
 * had nobody on the app yet. Withdrawing takes a notice off every phone, so it is limited to one
 * the dam sent itself: Jaga's own words stay Jaga's to withdraw.
 */
export function canEnd(row: OperatorRelease): boolean {
  return row.kind === "dam_release" && row.cancelledAt === null;
}

export function canWithdraw(row: OperatorRelease): boolean {
  return row.mine && row.cancelledAt === null;
}
