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
import type {
  CoverageRow,
  CoverageUnit,
  PointsRow,
  TeamHousehold,
  TeamReport,
  UnitContact,
} from "@/lib/coverage";
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
    kind: r.kind === "supplies" ? "supplies" : "rescue",
    needs: Array.isArray(r.needs) ? (r.needs as string[]) : [],
    needsNote: text(r.needs_note),
    suppliesLeft: text(r.supplies_left),
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
  await addVillages(supabase, cases);
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
 * The nearest village to each case (S3, 16 Oct), read as the responder: a verified team may see
 * every village, including the 2012 layer's. A failure leaves the board as it was.
 */
async function addVillages(
  supabase: Awaited<ReturnType<typeof createClient>>,
  cases: BoardCase[],
): Promise<void> {
  if (cases.length === 0) return;
  const { data, error } = await supabase.rpc("villages_near", {
    p_points: cases.slice(0, 200).map((c) => [c.lon, c.lat]),
  });
  if (error) return;
  for (const r of (data as Row[]) ?? []) {
    const c = cases[Number(r.i)];
    if (!c || typeof r.name_th !== "string") continue;
    c.village = {
      nameTh: r.name_th,
      nameEn: text(r.name_en),
      distanceM: Number(r.distance_m ?? 0),
    };
  }
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

/** Every tambon with the number of verified teams covering it (spec 5.6). */
export async function readCoverage(): Promise<CoverageRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("coverage_summary");
  if (error) throw new Error(error.message);
  return ((data as Row[]) ?? []).map((r) => ({
    tambon: String(r.tambon),
    nameTh: String(r.name_th ?? r.tambon),
    nameEn: String(r.name_en ?? r.tambon),
    province: String(r.province_code ?? ""),
    rescueUnits: Number(r.rescue_units ?? 0),
    coordinationUnits: Number(r.coordination_units ?? 0),
    suppliesUnits: Number(r.supplies_units ?? 0),
    mine: Boolean(r.mine),
  }));
}

/** The verified teams covering one tambon: names and capabilities, never a phone number. */
export async function readCoverageUnits(tambon: string): Promise<CoverageUnit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("coverage_units", { p_tambon: tambon });
  if (error) throw new Error(error.message);
  return ((data as Row[]) ?? []).map((r) => ({
    id: String(r.unit_id),
    name: String(r.unit_name),
    orgName: String(r.org_name ?? ""),
    capabilities: Array.isArray(r.capabilities) ? (r.capabilities as string[]) : [],
    onDuty: Boolean(r.on_duty),
    mine: Boolean(r.is_mine),
  }));
}

/** Confirmed rescues and points per team, by the province of the case (spec 5.5). */
export async function readLeaderboard(): Promise<PointsRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("hero_leaderboard", { p_province: null });
  if (error) throw new Error(error.message);
  return ((data as Row[]) ?? []).map((r) => ({
    province: String(r.province_code ?? ""),
    unitId: String(r.unit_id),
    unitName: String(r.unit_name),
    orgName: String(r.org_name ?? ""),
    points: Number(r.points ?? 0),
    cases: Number(r.cases ?? 0),
    mine: Boolean(r.is_mine),
  }));
}

/** Flood reports in the caller's coverage, newest first (spec 5.7). */
export async function readTeamReports(hours = 72): Promise<TeamReport[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("authority_reports", { p_hours: hours });
  if (error) throw new Error(error.message);
  return ((data as Row[]) ?? []).map((r) => ({
    id: String(r.report_id),
    createdAt: String(r.created_at),
    hazard: String(r.hazard ?? "flood"),
    lat: Number(r.lat),
    lon: Number(r.lon),
    tambon: text(r.tambon),
    tambonNameTh: text(r.tambon_name_th),
    tambonNameEn: text(r.tambon_name_en),
    depth: text(r.depth_ref),
    trend: text(r.trend),
    roadAccess: text(r.road_access),
    note: text(r.text_note),
    photoCount: Number(r.photo_count ?? 0),
    hasVoice: Boolean(r.has_voice),
    moderation: String(r.moderation ?? "pending"),
  }));
}

/**
 * Households in the caller's coverage. The database refuses a team without rescue or
 * coordination capability and writes each read to the access log; no phone number comes back.
 */
export async function readTeamHouseholds(): Promise<TeamHousehold[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("authority_households");
  if (error) throw new Error(error.message);
  return ((data as Row[]) ?? []).map((r) => ({
    id: String(r.household_id),
    tambon: text(r.tambon),
    tambonNameTh: text(r.tambon_name_th),
    tambonNameEn: text(r.tambon_name_en),
    lat: Number(r.lat),
    lon: Number(r.lon),
    size: num(r.size),
    vulnerable: (r.vulnerable as Record<string, number>) ?? {},
    mobilityNotes: text(r.mobility_notes),
    hasPhone: Boolean(r.has_phone),
    onBehalf: Boolean(r.on_behalf),
    updatedAt: String(r.updated_at),
  }));
}

/** One household's number, through the function that logs the look. */
export async function revealHouseholdPhone(householdId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reveal_household_phone", {
    p_household_id: householdId,
  });
  if (error) throw new Error(error.message);
  return typeof data === "string" && data !== "" ? data : null;
}

/** Ten-minute links to a report's photos and voice note; the storage policy decides who gets any. */
export async function readReportMedia(reportId: string): Promise<CaseMedia> {
  const supabase = await createClient();
  const storage = supabase.storage.from("report-media");
  const { data: listed } = await storage.list(reportId, { limit: 20 });
  const files = (listed ?? []).filter((f) => f.id).map((f) => `${reportId}/${f.name}`);
  if (files.length === 0) return { photos: [], voice: null, proof: [] };
  const { data, error } = await storage.createSignedUrls(files, LINK_SECONDS);
  if (error) throw new Error(error.message);
  const link = new Map((data ?? []).map((d) => [d.path ?? "", d.signedUrl]));
  const voicePath = files.find((p) => /\/voice\./.test(p)) ?? null;
  return {
    photos: files
      .filter((p) => p !== voicePath)
      .map((p) => link.get(p))
      .filter((u): u is string => !!u),
    voice: voicePath ? (link.get(voicePath) ?? null) : null,
    proof: [],
  };
}

/**
 * Another team's point of contact, for coordination (spec 5.3). The database allows it only
 * within shared coverage and writes the look to the access log.
 */
export async function revealUnitContact(unitId: string): Promise<UnitContact> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reveal_poc_phone", { p_unit_id: unitId });
  if (error) throw new Error(error.message);
  const row = ((data as Row[]) ?? [])[0] ?? {};
  return { name: text(row.poc_name), phone: text(row.poc_phone) };
}
