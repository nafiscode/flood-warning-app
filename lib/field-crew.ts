import { createClient } from "@/lib/supabase/server";

/**
 * The cases handed to the caller on a team (24 Oct 2026), for the crew's own phone. Every read is
 * a database function that returns only what an assigned person may see - the exact point and
 * what the crew needs on site, never a phone number (that is a logged tap) and never anything of
 * another case (safety rule 5).
 */
export type FieldCase = {
  sosId: string;
  assignmentId: string;
  status: "assigned" | "en_route" | "on_site";
  kind: "rescue" | "supplies";
  lat: number;
  lon: number;
  accuracyM: number | null;
  locationText: string | null;
  tambonTh: string;
  tambonEn: string;
  peopleCount: number | null;
  vulnerableFlags: Record<string, boolean>;
  depthRef: string | null;
  injuries: string | null;
  textNote: string | null;
  needs: string[];
  needsNote: string | null;
  unitName: string;
  assignedAt: string;
  hasPhone: boolean;
  crewCount: number;
};

/** A case the caller's team holds that they have not picked up, at tambon level only. */
export type TeamOpenCase = {
  sosId: string;
  unitName: string;
  kind: "rescue" | "supplies";
  status: string;
  tambonTh: string;
  tambonEn: string;
  peopleCount: number | null;
  crewCount: number;
};

export type MyWork = { cases: FieldCase[]; open: TeamOpenCase[]; readAt: string };

type Row = Record<string, unknown>;
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

function toCase(r: Row): FieldCase {
  const flags =
    r.vulnerable_flags && typeof r.vulnerable_flags === "object" ? r.vulnerable_flags : {};
  return {
    sosId: String(r.sos_id),
    assignmentId: String(r.assignment_id),
    status: r.status === "on_site" ? "on_site" : r.status === "en_route" ? "en_route" : "assigned",
    kind: r.kind === "supplies" ? "supplies" : "rescue",
    lat: Number(r.lat),
    lon: Number(r.lon),
    accuracyM: r.accuracy_m == null ? null : Number(r.accuracy_m),
    locationText: text(r.location_text),
    tambonTh: String(r.tambon_name_th ?? ""),
    tambonEn: String(r.tambon_name_en ?? r.tambon_name_th ?? ""),
    peopleCount: r.people_count == null ? null : Number(r.people_count),
    vulnerableFlags: flags as Record<string, boolean>,
    depthRef: text(r.depth_ref),
    injuries: text(r.injuries),
    textNote: text(r.text_note),
    needs: Array.isArray(r.needs) ? (r.needs as string[]) : [],
    needsNote: text(r.needs_note),
    unitName: String(r.unit_name ?? ""),
    assignedAt: String(r.assigned_at),
    hasPhone: Boolean(r.has_phone),
    crewCount: Number(r.crew_count ?? 0),
  };
}

export async function readMyWork(): Promise<MyWork> {
  const supabase = await createClient();
  const [mine, open] = await Promise.all([
    supabase.rpc("my_assigned_cases"),
    supabase.rpc("my_team_open_cases"),
  ]);
  if (mine.error) throw new Error(mine.error.message);
  return {
    cases: ((mine.data as Row[]) ?? []).map(toCase),
    open: ((open.data as Row[]) ?? []).map((r) => ({
      sosId: String(r.sos_id),
      unitName: String(r.unit_name ?? ""),
      kind: r.kind === "supplies" ? ("supplies" as const) : ("rescue" as const),
      status: String(r.status),
      tambonTh: String(r.tambon_name_th ?? ""),
      tambonEn: String(r.tambon_name_en ?? r.tambon_name_th ?? ""),
      peopleCount: r.people_count == null ? null : Number(r.people_count),
      crewCount: Number(r.crew_count ?? 0),
    })),
    readAt: new Date().toISOString(),
  };
}

/** Take an open case the caller's team holds. */
export async function takeCase(sosId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("take_case", { p_sos: sosId });
  if (error) throw new Error(error.message);
}
