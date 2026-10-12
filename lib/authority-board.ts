/**
 * What the authority console reads and writes, on the server, with the responder's own session.
 * The database decides everything (safety rule 5): authority_board() returns only the cases in
 * the caller's own coverage, and every write checks the caller's unit again.
 *
 * No phone number comes back from the board. A requester's number is fetched one at a time
 * through the logged reveal_sos_phone(), exactly as the war room does it.
 */
import type {
  AuthorityBoard,
  BoardCase,
  CaseMedia,
  DeclineReason,
  EtaBand,
  MyUnit,
} from "@/lib/dispatch";
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
    offeredToName: null,
    offeredIsMine: Boolean(r.offered_is_mine),
    offerExpiresAt: text(r.offer_expires_at),
    offerExhausted: Boolean(r.offer_exhausted),
    myResponse: (text(r.my_response) as BoardCase["myResponse"]) ?? null,
    closedAt: text(r.closed_at),
    completedAt: text(r.completed_at),
    proofCount: Number(r.proof_count ?? 0),
    canConfirm: Boolean(r.can_confirm),
  };
}

/**
 * The board and the caller's own units in one read. The name of the unit the relay is asking is
 * looked up beside it: a verified authority may read unit names (the responsibility map), and the
 * board function itself returns only the id.
 */
export async function readAuthorityBoard(userId: string, hours = 72): Promise<AuthorityBoard> {
  const supabase = await createClient();
  const [{ data, error }, units] = await Promise.all([
    supabase.rpc("authority_board", { p_hours: hours }),
    readMyUnits(userId),
  ]);
  if (error) throw new Error(error.message);
  const cases = ((data as Row[]) ?? []).map(toCase);
  const asked = [...new Set(cases.map((c) => c.offeredTo).filter((id): id is string => !!id))];
  if (asked.length > 0) {
    const { data: names } = await supabase
      .from("authority_units")
      .select("id, unit_name")
      .in("id", asked);
    const byId = new Map(((names as Row[]) ?? []).map((r) => [String(r.id), String(r.unit_name)]));
    for (const c of cases) c.offeredToName = c.offeredTo ? (byId.get(c.offeredTo) ?? null) : null;
  }
  return { cases, units, readAt: new Date().toISOString() };
}

/**
 * The verified units this person runs. The filter on user_id matters: row-level security lets a
 * verified authority read every unit, so without it the console would offer other teams' switches.
 */
export async function readMyUnits(userId: string): Promise<MyUnit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("authority_units")
    .select("id, unit_name, on_duty, poc_phone_to_requester, status, organizations(name)")
    .eq("user_id", userId)
    .eq("status", "verified")
    .order("created_at");
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

/** The team reports the rescue. The database insists on a photo that was really uploaded. */
export async function completeCase(sosId: string, photos: string[], note: string | null) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("authority_complete_sos", {
    p_sos_id: sosId,
    p_photos: photos,
    p_note: note,
  });
  if (error) throw new Error(error.message);
}

/** The fallback: a second team confirms a rescue nobody confirmed in time (spec 5.4). */
export async function confirmRescue(sosId: string, photos: string[], note: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("authority_confirm_rescue", {
    p_sos_id: sosId,
    p_photos: photos,
    p_note: note,
  });
  if (error) throw new Error(error.message);
}

const MEDIA_BUCKET = "sos-media";
const LINK_SECONDS = 600;

/**
 * Ten-minute links to a case's photos, voice note and evidence photos. The bucket is private and
 * read with the responder's own session, so the storage policy decides: a team that does not
 * cover the case gets an empty list, not somebody's photos (safety rule 5).
 */
export async function readCaseMedia(sosId: string): Promise<CaseMedia> {
  const supabase = await createClient();
  const storage = supabase.storage.from(MEDIA_BUCKET);
  const [top, proof] = await Promise.all([
    storage.list(sosId, { limit: 20 }),
    storage.list(`${sosId}/proof`, { limit: 20 }),
  ]);
  // A folder comes back as an entry without an id: only files are linked.
  const files = (top.data ?? []).filter((f) => f.id).map((f) => `${sosId}/${f.name}`);
  const proofs = (proof.data ?? []).filter((f) => f.id).map((f) => `${sosId}/proof/${f.name}`);
  const all = [...files, ...proofs];
  if (all.length === 0) return { photos: [], voice: null, proof: [] };
  const { data, error } = await storage.createSignedUrls(all, LINK_SECONDS);
  if (error) throw new Error(error.message);
  const link = new Map((data ?? []).map((d) => [d.path ?? "", d.signedUrl]));
  const links = (paths: string[]) => paths.map((p) => link.get(p)).filter((u): u is string => !!u);
  const voicePath = files.find((p) => /\/voice\./.test(p)) ?? null;
  return {
    photos: links(files.filter((p) => p !== voicePath)),
    voice: voicePath ? (link.get(voicePath) ?? null) : null,
    proof: links(proofs),
  };
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
