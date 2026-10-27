import "server-only";

import type { FeedbackStatus, Moment, PublicStatus } from "@/lib/feedback";
import { createClient } from "@/lib/supabase/server";

/**
 * The admin console's reads for A15 (spec 17 item 7). Every one goes through a database function
 * that checks the caller is an admin again and decides the columns, so the console cannot ask for
 * more than the console may have: the contact a person left is not in any of these - it comes
 * only from `revealFeedbackContact`, which writes the look to the access log (safety rule 5).
 */

export type FeedbackRow = {
  id: string;
  createdAt: string;
  kind: string;
  rating: number | null;
  liked: string[];
  likedNote: string | null;
  improve: string[];
  improveNote: string | null;
  message: string | null;
  screen: string | null;
  locale: string | null;
  appVersion: string | null;
  deviceKind: string | null;
  districtCode: string | null;
  districtTh: string | null;
  districtEn: string | null;
  roleAtTime: string | null;
  moment: Moment | null;
  sosId: string | null;
  signedIn: boolean;
  hasContact: boolean;
  status: FeedbackStatus;
  adminNote: string | null;
  changeRef: string | null;
  handledAt: string | null;
  publicOk: boolean;
  displayName: string | null;
  publicStatus: PublicStatus;
  approvedAt: string | null;
  anonymisedAt: string | null;
};

export type FeedbackFilters = {
  status?: FeedbackStatus | null;
  publicStatus?: PublicStatus | null;
  rating?: number | null;
  locale?: string | null;
  screen?: string | null;
  role?: string | null;
  days?: number;
};

type Row = Record<string, unknown>;
const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" ? value : null);
const list = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : []);

export async function readFeedback(filters: FeedbackFilters = {}): Promise<FeedbackRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_feedback", {
    p_status: filters.status ?? null,
    p_public: filters.publicStatus ?? null,
    p_rating: filters.rating ?? null,
    p_locale: filters.locale ?? null,
    p_screen: filters.screen ?? null,
    p_role: filters.role ?? null,
    p_days: filters.days ?? 365,
    p_limit: 200,
  });
  if (error || !Array.isArray(data)) return [];
  return (data as Row[]).map((r) => ({
    id: String(r.id),
    createdAt: String(r.created_at),
    kind: String(r.kind),
    rating: num(r.rating),
    liked: list(r.liked),
    likedNote: text(r.liked_note),
    improve: list(r.improve),
    improveNote: text(r.improve_note),
    message: text(r.message),
    screen: text(r.screen),
    locale: text(r.locale),
    appVersion: text(r.app_version),
    deviceKind: text(r.device_kind),
    districtCode: text(r.district_code),
    districtTh: text(r.district_th),
    districtEn: text(r.district_en),
    roleAtTime: text(r.role_at_time),
    moment: text(r.moment) as Moment | null,
    sosId: text(r.sos_id),
    signedIn: r.signed_in === true,
    hasContact: r.has_contact === true,
    status: String(r.status) as FeedbackStatus,
    adminNote: text(r.admin_note),
    changeRef: text(r.change_ref),
    handledAt: text(r.handled_at),
    publicOk: r.public_ok === true,
    displayName: text(r.display_name),
    publicStatus: String(r.public_status) as PublicStatus,
    approvedAt: text(r.approved_at),
    anonymisedAt: text(r.anonymised_at),
  }));
}

export type FeedbackTrends = {
  answers: number;
  rated: number;
  average: number | null;
  byMonth: { month: string; answers: number; rated: number; average: number | null }[];
  byScreen: { screen: string; answers: number; rated: number; average: number | null }[];
  byLocale: { locale: string; answers: number; rated: number; average: number | null }[];
  byRole: { role: string; answers: number; average: number | null }[];
  liked: { code: string; count: number }[];
  improve: {
    code: string;
    count: number;
    done: Record<string, string> | null;
    changeRef: string | null;
  }[];
  byStatus: Record<string, number>;
  waitingPublic: number;
};

/** The trend view. Admins see every period with no floor under it: the count is beside it. */
export async function readFeedbackTrends(months = 12): Promise<FeedbackTrends | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_feedback_trends", { p_months: months });
  if (error || !data) return null;
  return data as FeedbackTrends;
}

/**
 * The contact a person agreed to be reached on. The database decides and logs it; this is only
 * the way the console asks. It throws where the database refused, so the screen says nothing.
 */
export async function revealFeedbackContact(id: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("feedback_contact", { p_id: id });
  if (error) throw new Error(error.message);
  return typeof data === "string" ? data : null;
}

/** What was done about a weak point, as the public page shows it beside the count. */
export async function readFeedbackOutcomes(): Promise<
  { code: string; note: Record<string, string>; changeRef: string | null }[]
> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("feedback_outcomes")
    .select("code, note, change_ref")
    .order("code");
  if (error || !Array.isArray(data)) return [];
  return data.map((r) => ({
    code: String(r.code),
    note: (r.note ?? {}) as Record<string, string>,
    changeRef: text(r.change_ref),
  }));
}
