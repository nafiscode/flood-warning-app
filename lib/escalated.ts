/**
 * A request for rescue that no team has taken for 30 minutes, as a team OUTSIDE its tambon reads
 * it (owner, 27 Nov 2026; amends safety rule 5 for this one case). The database decides who may
 * read it and which cases are open to other teams (`authority_escalated_cases()`); this file only
 * shapes what comes back.
 *
 * No phone number is in this shape. The sender's number is asked for one case at a time through
 * the logged `reveal_escalated_sos_phone()`, and every look is written to the audit log.
 */
export type EscalatedCase = {
  sosId: string;
  createdAt: string;
  /** Minutes the case has waited, as the server counted them when it was read. */
  waitingMinutes: number;
  lat: number | null;
  lon: number | null;
  accuracyM: number | null;
  locationText: string | null;
  tambon: string | null;
  tambonTh: string | null;
  tambonEn: string | null;
  districtTh: string | null;
  provinceTh: string | null;
  peopleCount: number | null;
  vulnerableFlags: Record<string, boolean>;
  depth: string | null;
  injuries: string | null;
  note: string | null;
  hasPhone: boolean;
  onBehalf: boolean;
};

type Row = Record<string, unknown>;
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);

export function toEscalated(r: Row): EscalatedCase {
  return {
    sosId: String(r.sos_id),
    createdAt: String(r.created_at),
    waitingMinutes: Math.max(0, Number(r.waiting_minutes ?? 0)),
    lat: num(r.lat),
    lon: num(r.lon),
    accuracyM: num(r.accuracy_m),
    locationText: text(r.location_text),
    tambon: text(r.tambon),
    tambonTh: text(r.tambon_th),
    tambonEn: text(r.tambon_en),
    districtTh: text(r.district_th),
    provinceTh: text(r.province_th),
    peopleCount: num(r.people_count),
    vulnerableFlags: (r.vulnerable_flags as Record<string, boolean> | null) ?? {},
    depth: text(r.depth_ref),
    injuries: text(r.injuries),
    note: text(r.note),
    hasPhone: Boolean(r.has_phone),
    onBehalf: Boolean(r.on_behalf),
  };
}

/** The longest wait first: the case that has waited longest is the one that costs most. */
export function sortEscalated(cases: readonly EscalatedCase[]): EscalatedCase[] {
  return [...cases].sort(
    (a, b) => b.waitingMinutes - a.waitingMinutes || a.createdAt.localeCompare(b.createdAt),
  );
}
