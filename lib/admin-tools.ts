/**
 * What the rest of the admin console reads (spec 6.4, 6.5), on the server, with the admin's own
 * session: the admin_* functions in the A6 admin-tools migration decide what comes back, and no
 * phone number or sender is in any of it. This file only shapes rows.
 */
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const int = (v: unknown): number | null =>
  v === null || v === undefined ? null : Math.trunc(Number(v));

async function call(fn: string, args: Record<string, unknown> = {}): Promise<Row[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return (data ?? []) as Row[];
}

export const MODERATION = ["pending", "approved", "hidden"] as const;
export type Moderation = (typeof MODERATION)[number];

export type QueuedReport = {
  id: string;
  createdAt: string;
  tambonTh: string | null;
  tambonEn: string | null;
  depth: string | null;
  trend: string | null;
  road: string | null;
  note: string | null;
  photos: number;
  hasVoice: boolean;
  status: Moderation;
  anonymous: boolean;
};

export async function readReportQueue(status: Moderation): Promise<QueuedReport[]> {
  return (await call("admin_reports_queue", { p_status: status, p_limit: 40 })).map((r) => ({
    id: String(r.report_id),
    createdAt: String(r.created_at),
    tambonTh: text(r.tambon_th),
    tambonEn: text(r.tambon_en),
    depth: text(r.depth_ref),
    trend: text(r.trend),
    road: text(r.road_access),
    note: text(r.note),
    photos: int(r.photos) ?? 0,
    hasVoice: r.has_voice === true,
    status: r.moderation_status as Moderation,
    anonymous: r.anonymous === true,
  }));
}

export const PLACE_STATUS = ["unknown", "open", "full", "closed"] as const;
export const PLACE_VERIFICATION = ["unverified", "verified", "rejected"] as const;
export const PLACE_TYPES = [
  "shelter",
  "school",
  "mosque",
  "temple",
  "government",
  "high_ground_parking",
  "other",
] as const;

export type AdminPlace = {
  id: string;
  nameTh: string;
  nameEn: string;
  type: (typeof PLACE_TYPES)[number];
  lat: number;
  lon: number;
  tambonTh: string | null;
  tambonEn: string | null;
  capacity: number | null;
  score: number | null;
  flags: string[];
  source: string | null;
  verification: (typeof PLACE_VERIFICATION)[number];
  status: (typeof PLACE_STATUS)[number];
  needs: string | null;
  updatedAt: string;
};

export async function readSafePlaces(district: string, only: string | null): Promise<AdminPlace[]> {
  return (await call("admin_safe_places", { p_district: district, p_only: only })).map((r) => {
    const name = (r.name ?? {}) as Record<string, unknown>;
    return {
      id: String(r.place_id),
      nameTh: text(name.th) ?? "",
      nameEn: text(name.en) ?? "",
      type: r.type as AdminPlace["type"],
      lat: Number(r.lat),
      lon: Number(r.lon),
      tambonTh: text(r.tambon_th),
      tambonEn: text(r.tambon_en),
      capacity: int(r.capacity),
      score: r.score === null || r.score === undefined ? null : Number(r.score),
      flags: Array.isArray(r.flags) ? r.flags.map(String) : [],
      source: text(r.source),
      verification: r.verification_status as AdminPlace["verification"],
      status: r.status as AdminPlace["status"],
      needs: text(r.needs),
      updatedAt: String(r.updated_at),
    };
  });
}

export type LogRow = {
  id: number;
  at: string;
  by: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  details: Record<string, unknown>;
};

export async function readLog(action: string | null, before: number | null): Promise<LogRow[]> {
  return (await call("admin_audit_log", { p_action: action, p_before: before, p_limit: 100 })).map(
    (r) => ({
      id: Number(r.log_id),
      at: String(r.ts),
      by: text(r.actor_name),
      action: String(r.action),
      entity: String(r.entity),
      entityId: text(r.entity_id),
      details: (r.details ?? {}) as Record<string, unknown>,
    }),
  );
}

export async function readLogActions(): Promise<{ action: string; times: number }[]> {
  return (await call("admin_audit_actions")).map((r) => ({
    action: String(r.action),
    times: int(r.times) ?? 0,
  }));
}

export type HandoverNote = { id: number; at: string; by: string | null; note: string };

export async function readHandover(): Promise<HandoverNote[]> {
  return (await call("admin_handover", { p_limit: 100 })).map((r) => ({
    id: Number(r.note_id),
    at: String(r.created_at),
    by: text(r.author_name),
    note: String(r.note),
  }));
}

export type Announcement = {
  id: string;
  messages: Record<string, string>;
  tambons: number | null;
  startsAt: string;
  endsAt: string | null;
  cancelledAt: string | null;
  /** Worked out when the list was read. */
  state: "live" | "ended" | "cancelled";
};

export async function readAnnouncements(): Promise<Announcement[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("announcements")
    .select("id, messages, tambons, starts_at, ends_at, cancelled_at")
    .order("starts_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  const now = Date.now();
  return ((data ?? []) as Row[]).map((r) => ({
    state: announcementState({ endsAt: text(r.ends_at), cancelledAt: text(r.cancelled_at) }, now),
    id: String(r.id),
    messages: Object.fromEntries(
      Object.entries((r.messages ?? {}) as Row).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    ),
    tambons: Array.isArray(r.tambons) ? r.tambons.length : null,
    startsAt: String(r.starts_at),
    endsAt: text(r.ends_at),
    cancelledAt: text(r.cancelled_at),
  }));
}

/** Live, over or withdrawn: what the list says beside an announcement. */
export function announcementState(
  a: { endsAt: string | null; cancelledAt: string | null },
  now: number,
): "live" | "ended" | "cancelled" {
  if (a.cancelledAt) return "cancelled";
  return a.endsAt && Date.parse(a.endsAt) <= now ? "ended" : "live";
}

export type DuplicatePair = {
  id: string;
  createdAt: string;
  status: string;
  kind: string;
  tambonTh: string | null;
  tambonEn: string | null;
  people: number | null;
  claimed: boolean;
  otherId: string;
  otherCreatedAt: string;
  otherStatus: string;
  otherPeople: number | null;
  otherClaimed: boolean;
  distanceM: number | null;
  merged: boolean;
};

export async function readDuplicates(): Promise<DuplicatePair[]> {
  return (await call("admin_sos_duplicates")).map((r) => ({
    id: String(r.sos_id),
    createdAt: String(r.created_at),
    status: String(r.status),
    kind: String(r.kind),
    tambonTh: text(r.tambon_th),
    tambonEn: text(r.tambon_en),
    people: int(r.people_count),
    claimed: r.claimed === true,
    otherId: String(r.other_id),
    otherCreatedAt: String(r.other_created_at),
    otherStatus: String(r.other_status),
    otherPeople: int(r.other_people_count),
    otherClaimed: r.other_claimed === true,
    distanceM: int(r.distance_m),
    merged: r.merged === true,
  }));
}

/** Hours an announcement may stay up, offered in the form; 0 is "until withdrawn". */
export const ANNOUNCE_HOURS = [0, 6, 24, 72, 168] as const;
