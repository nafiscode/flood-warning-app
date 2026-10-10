/**
 * What the authority console reads and writes, on the server, with the responder's own session.
 * The database decides everything (safety rule 5): authority_board() returns only the cases in
 * the caller's own coverage, and every write checks the caller's unit again.
 *
 * No phone number comes back from the board. A requester's number is fetched one at a time
 * through the logged reveal_sos_phone(), exactly as the war room does it.
 */
import type { BoardCase, DeclineReason, EtaBand } from "@/lib/dispatch";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toCase(r: Row): BoardCase {
  return {
    sosId: String(r.sos_id),
    createdAt: String(r.created_at),
    status: String(r.status) as BoardCase["status"],
    hazard: String(r.hazard ?? "unknown"),
    lat: Number(r.lat),
    lon: Number(r.lon),
    accuracyM: num(r.accuracy_m),
    locationText: text(r.location_text),
    tambon: text(r.tambon),
    tambonNameTh: text(r.tambon_name_th),
    tambonNameEn: text(r.tambon_name_en),
    peopleCount: num(r.people_count),
    vulnerableFlags: (r.vulnerable_flags as Record<string, boolean>) ?? {},
    depthRef: text(r.depth_ref),
    injuries: text(r.injuries),
    note: text(r.text_note),
    photos: Array.isArray(r.photos) ? (r.photos as string[]) : [],
    voiceUrl: text(r.voice_url),
    priorityScore: Number(r.priority_score ?? 0),
    hasPhone: Boolean(r.has_phone),
    suspectedSpam: Boolean(r.suspected_spam),
    waitingMinutes: Number(r.waiting_minutes ?? 0),
    claimedBy: text(r.claimed_by),
    claimedByName: text(r.claimed_by_name),
    claimedIsMine: Boolean(r.claimed_is_mine),
    etaBand: (text(r.eta_band) as EtaBand | null) ?? null,
    etaGivenAt: text(r.eta_given_at),
    offeredTo: text(r.offered_to),
    offeredIsMine: Boolean(r.offered_is_mine),
    offerExpiresAt: text(r.offer_expires_at),
    offerExhausted: Boolean(r.offer_exhausted),
    myResponse: (text(r.my_response) as BoardCase["myResponse"]) ?? null,
  };
}

export type Board = { cases: BoardCase[]; readAt: string };

export async function readAuthorityBoard(hours = 72): Promise<Board> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("authority_board", { p_hours: hours });
  if (error) throw new Error(error.message);
  return {
    cases: ((data as Row[]) ?? []).map(toCase),
    readAt: new Date().toISOString(),
  };
}

/** The units this person runs, so the console can show the on-duty switch for each. */
export type MyUnit = {
  id: string;
  name: string;
  orgName: string;
  onDuty: boolean;
  sharesPocPhone: boolean;
};

export async function readMyUnits(): Promise<MyUnit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("authority_units")
    .select("id, unit_name, on_duty, poc_phone_to_requester, status, organizations(name)")
    .eq("status", "verified");
  if (error) throw new Error(error.message);
  return ((data as Row[]) ?? []).map((r) => ({
    id: String(r.id),
    name: String(r.unit_name),
    orgName: String((r.organizations as { name?: string } | null)?.name ?? ""),
    onDuty: Boolean(r.on_duty),
    sharesPocPhone: Boolean(r.poc_phone_to_requester),
  }));
}

export type AcceptResult = {
  claim: string | null;
  byUnit: string | null;
  byUnitName: string | null;
  taken: boolean;
};

export async function acceptCase(sosId: string): Promise<AcceptResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("authority_accept_sos", { p_sos_id: sosId });
  if (error) throw new Error(error.message);
  const row = ((data as Row[]) ?? [])[0] ?? {};
  return {
    claim: text(row.claim),
    byUnit: text(row.by_unit),
    byUnitName: text(row.by_unit_name),
    taken: Boolean(row.taken),
  };
}

export async function declineCase(sosId: string, reason: DeclineReason): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("authority_decline_sos", {
    p_sos_id: sosId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export async function setEta(sosId: string, band: EtaBand): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("authority_set_eta", { p_sos_id: sosId, p_band: band });
  if (error) throw new Error(error.message);
}

export async function advanceCase(sosId: string, status: "en_route" | "on_site"): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("authority_advance_sos", {
    p_sos_id: sosId,
    p_status: status,
  });
  if (error) throw new Error(error.message);
}

export async function releaseCase(sosId: string, reason: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("authority_release_sos", {
    p_sos_id: sosId,
    p_reason: reason,
  });
  if (error) throw new Error(error.message);
}

export async function setDuty(unitId: string, onDuty: boolean): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("authority_set_duty", {
    p_unit_id: unitId,
    p_on_duty: onDuty,
  });
  if (error) throw new Error(error.message);
}

export async function setPhoneSharing(unitId: string, share: boolean): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("authority_set_phone_sharing", {
    p_unit_id: unitId,
    p_share: share,
  });
  if (error) throw new Error(error.message);
}

/** The requester's number, through the function that writes the reveal to audit_log. */
export async function revealRequesterPhone(sosId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reveal_sos_phone", { p_sos_id: sosId });
  if (error) throw new Error(error.message);
  return typeof data === "string" && data !== "" ? data : null;
}
