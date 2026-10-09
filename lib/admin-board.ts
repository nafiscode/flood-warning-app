/**
 * What the war room reads, on the server, with the admin's own session: row-level security and
 * the admin_* functions decide what comes back (safety rule 5). The functions are in the A6
 * migration; this file only turns their rows into the shapes lib/war-room.ts describes.
 *
 * No phone number is in any of these reads. A number is fetched one at a time by `revealSosPhone`
 * and `revealPersonPhone`, which call the logged reveal functions.
 */
import type { DamSignal } from "@/lib/dam";
import { createClient } from "@/lib/supabase/server";
import type {
  DamBoardRow,
  HistoryRow,
  Overview,
  PeoplePage,
  Person,
  ReportPoint,
  SosCase,
  UnitOption,
  WarRoomBoard,
  WarRoomMapData,
  WatchedCount,
} from "@/lib/war-room";

type Row = Record<string, unknown>;

const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const int = (v: unknown): number => Math.trunc(Number(v ?? 0));

function toCase(r: Row): SosCase {
  return {
    id: String(r.sos_id),
    createdAt: String(r.created_at),
    closedAt: text(r.closed_at),
    status: String(r.status) as SosCase["status"],
    hazard: String(r.hazard_type ?? "unknown"),
    lat: num(r.lat),
    lon: num(r.lon),
    accuracyM: num(r.accuracy_m),
    locationText: text(r.location_text),
    tambon: text(r.tambon),
    tambonTh: text(r.tambon_th),
    tambonEn: text(r.tambon_en),
    districtTh: text(r.district_th),
    provinceTh: text(r.province_th),
    provinceCode: text(r.province_code),
    peopleCount: num(r.people_count),
    vulnerable: (r.vulnerable_flags as Record<string, boolean>) ?? {},
    depth: text(r.depth_ref),
    injuries: text(r.injuries),
    note: text(r.note),
    photos: int(r.photos),
    hasVoice: r.has_voice === true,
    batteryPct: num(r.battery_pct),
    onBehalf: r.on_behalf === true,
    onBehalfNote: text(r.on_behalf_note),
    hasPhone: r.has_phone === true,
    requesterName: text(r.requester_name),
    priority: Number(r.priority_score ?? 0),
    suspectedSpam: r.suspected_spam === true,
    spamDismissedAt: text(r.spam_dismissed_at),
    duplicateOf: text(r.duplicate_of),
    possibleDuplicateOf: text(r.possible_duplicate_of),
    mergedIn: int(r.merged_in),
    unitId: text(r.claim_unit_id),
    unitName: text(r.claim_unit_name),
    orgName: text(r.claim_org),
    claimedAt: text(r.claimed_at),
    lastEvent: text(r.last_event),
    lastEventAt: text(r.last_event_at),
    unitsCovering: int(r.units_covering),
  };
}

function toOverview(r: Row): Overview {
  return {
    people: int(r.people),
    peopleNew7d: int(r.people_new_7d),
    peopleWithHome: int(r.people_with_home),
    watchedPlaces: int(r.watched_places),
    watchedNotify: int(r.watched_notify),
    unitsVerified: int(r.units_verified),
    unitsPending: int(r.units_pending),
    tambonsCovered: int(r.tambons_covered),
    tambonsTotal: int(r.tambons_total),
    tambonsUncovered: int(r.tambons_uncovered),
    sosOpen: int(r.sos_open),
    sosWaiting: int(r.sos_waiting),
    sosOverdue: int(r.sos_overdue),
    sosWorking: int(r.sos_working),
    sos24h: int(r.sos_24h),
    sosClosed24h: int(r.sos_closed_24h),
    sosSpamOpen: int(r.sos_spam_open),
    oldestWaitingAt: text(r.oldest_waiting_at),
    reports72h: int(r.reports_72h),
    reportsPending: int(r.reports_pending),
    unclaimedMinutes: int(r.unclaimed_minutes) || 15,
  };
}

const EMPTY_OVERVIEW: Overview = toOverview({ unclaimed_minutes: 15 });

/**
 * One dam row. The figures arrive as the JSON the database built from dam_signal(), so the
 * names are its names; everything else is already shaped for the screen.
 */
function toDam(r: Row): DamBoardRow {
  const s = (r.signal ?? null) as Row | null;
  const n = (key: string) => (s && typeof s[key] === "number" ? (s[key] as number) : null);
  return {
    code: String(r.dam_code),
    name: (r.dam_name ?? {}) as Record<string, string>,
    river: (r.river ?? {}) as Record<string, string>,
    operator: String(r.operator ?? ""),
    signal: s
      ? {
          observedAt: String(s.observed_at),
          fetchedAt: String(s.fetched_at),
          storageMcm: n("storage_mcm"),
          percentFull: n("percent_full"),
          levelM: n("level_m"),
          inflowCms: n("inflow_cms"),
          releasedCms: n("released_cms"),
          spilledCms: n("spilled_cms"),
          outflowCms: n("outflow_cms"),
          riseMcmPerH: n("rise_mcm_per_h"),
          riseWindowH: Number(s.rise_window_h ?? 6),
          grade: s.grade as DamSignal["grade"],
          reasons: (s.reasons ?? []) as DamSignal["reasons"],
          awaiting: (s.awaiting ?? []) as DamSignal["awaiting"],
          readings: Number(s.readings ?? 0),
          stale: Boolean(s.stale),
          confirmedOver: Number(s.confirmed_over ?? 2),
        }
      : null,
    notice: r.notice_id
      ? {
          id: String(r.notice_id),
          status: String(r.notice_status) as "open" | "sent" | "dismissed" | "ended",
          raisedAt: String(r.notice_raised_at),
          reasons: ((r.notice_reasons ?? []) as string[]) ?? [],
          reviewedAt: text(r.notice_reviewed_at),
          reviewedByName: text(r.notice_reviewed_by_name),
          note: text(r.notice_note),
        }
      : null,
    tambonsMain: int(r.tambons_main),
    tambonsTributary: int(r.tambons_tributary),
    feed: {
      ok: r.feed_ok === null || r.feed_ok === undefined ? null : Boolean(r.feed_ok),
      ranAt: text(r.feed_ran_at),
      error: text(r.feed_error),
    },
  };
}

/** The board and the counters: the one read that is polled while the war room is open. */
export async function readBoard(hours = 72): Promise<WarRoomBoard> {
  const supabase = await createClient();
  const [overview, board, dams] = await Promise.all([
    supabase.rpc("admin_overview"),
    supabase.rpc("admin_sos_board", { p_hours: hours }),
    // Polled with the rest: a release waiting for a person to judge it is the one thing on this
    // screen that gets worse by being seen late.
    supabase.rpc("admin_dam_board"),
  ]);
  return {
    now: Date.now(),
    overview:
      ((overview.data as Row[] | null)?.[0] ?? null)
        ? toOverview((overview.data as Row[])[0]!)
        : EMPTY_OVERVIEW,
    cases: ((board.data as Row[] | null) ?? []).map(toCase),
    dams: ((dams.data as Row[] | null) ?? []).map(toDam),
  };
}

/** The map's own data: counts per tambon, home pins and the recent reports. */
export async function readMapData(): Promise<WarRoomMapData> {
  const supabase = await createClient();
  const [watched, people, reports] = await Promise.all([
    supabase.rpc("admin_watched_by_tambon"),
    supabase.rpc("admin_people_points", { p_limit: 4000 }),
    supabase.rpc("admin_reports_recent", { p_hours: 72 }),
  ]);
  return {
    watched: ((watched.data as Row[] | null) ?? []).map((r): WatchedCount => ({
      tambon: String(r.tambon),
      tambonTh: String(r.tambon_th ?? ""),
      tambonEn: String(r.tambon_en ?? ""),
      districtTh: String(r.district_th ?? ""),
      provinceCode: String(r.province_code ?? ""),
      places: int(r.places),
      notify: int(r.notify),
      owners: int(r.owners),
      homes: int(r.homes),
    })),
    people: ((people.data as Row[] | null) ?? [])
      .filter((r) => r.lat !== null && r.lon !== null)
      .map((r) => ({
        lat: Number(r.lat),
        lon: Number(r.lon),
        tambon: text(r.tambon),
        role: String(r.role ?? "user"),
      })),
    reports: ((reports.data as Row[] | null) ?? []).map((r): ReportPoint => ({
      id: String(r.report_id),
      createdAt: String(r.created_at),
      lat: num(r.lat),
      lon: num(r.lon),
      tambon: text(r.tambon),
      tambonTh: text(r.tambon_th),
      depth: text(r.depth_ref),
      trend: text(r.trend),
      roadAccess: text(r.road_access),
      moderation: String(r.moderation_status ?? "pending"),
      photos: int(r.photos),
      anonymous: r.anonymous === true,
    })),
  };
}

const PAGE = 50;

/** Who has registered, with the search and the page the address asks for. */
export async function readPeople(search: string, offset: number): Promise<PeoplePage> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_people", {
    p_search: search === "" ? null : search,
    p_limit: PAGE,
    p_offset: offset,
  });
  const rows = (data as Row[] | null) ?? [];
  return {
    rows: rows.map((r): Person => ({
      userId: String(r.user_id),
      displayName: String(r.display_name ?? ""),
      role: String(r.role ?? "user"),
      locale: String(r.preferred_locale ?? "th"),
      createdAt: String(r.created_at),
      tambon: text(r.home_tambon),
      tambonTh: text(r.tambon_th),
      tambonEn: text(r.tambon_en),
      districtTh: text(r.district_th),
      provinceTh: text(r.province_th),
      lat: num(r.lat),
      lon: num(r.lon),
      hasPhone: r.has_phone === true,
      phoneVerified: r.phone_verified === true,
      hasLine: r.has_line === true,
      watchedPlaces: int(r.watched_places),
      sosSent: int(r.sos_sent),
      reportsSent: int(r.reports_sent),
    })),
    total: rows.length > 0 ? int(rows[0]!.total_rows) : 0,
    search,
    offset,
  };
}

/** The verified units that could take a case in this tambon. */
export async function readUnits(tambon: string | null): Promise<UnitOption[]> {
  if (!tambon) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_units_for_tambon", { p_tambon: tambon });
  return ((data as Row[] | null) ?? []).map((r) => ({
    id: String(r.unit_id),
    unitName: String(r.unit_name ?? ""),
    orgName: String(r.org_name ?? ""),
    orgType: String(r.org_type ?? ""),
    capabilities: (r.capabilities as string[] | null) ?? [],
    openCases: int(r.open_cases),
  }));
}

export async function readHistory(sosId: string): Promise<HistoryRow[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_sos_history", { p_sos_id: sosId });
  return ((data as Row[] | null) ?? []).map((r) => ({
    at: String(r.at),
    event: String(r.event ?? ""),
    note: text(r.note),
    unitName: text(r.unit_name),
    actorName: text(r.actor_name),
    photos: int(r.photos),
  }));
}

/** The requester's phone, through the logged function (safety rule 5). */
export async function revealSosPhone(sosId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("reveal_sos_phone", { p_sos_id: sosId });
  return typeof data === "string" && data !== "" ? data : null;
}

/** A registered person's own phone, through the logged function (safety rule 5). */
export async function revealPersonPhone(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("reveal_profile_phone", { p_user_id: userId });
  return typeof data === "string" && data !== "" ? data : null;
}
