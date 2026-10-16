/**
 * The admin team: who is on it, what each of them is there to do, and how to reach them.
 *
 * The shaping is pure so a test can hold it without a database. Two rules live here and are
 * worth keeping in sight:
 *
 *  - a **duty** is a label, never a permission. Every admin keeps every admin power; the duty
 *    says what the super admin asked them to look after. Nothing in the app reads it to decide
 *    whether somebody may do something (migration ..a10_admin_team says why).
 *  - a **phone number** never arrives in a list. The rows carry the last four digits; the
 *    number itself comes one at a time from `reveal_admin_phone()`, which logs the look
 *    (safety rule 5).
 */
import { createClient } from "@/lib/supabase/server";

/** Super admin, deputy super admin, admin: what the page calls each row. */
export type TeamRank = "super" | "deputy" | "admin";
export type MemberStatus = "invited" | "requested" | "active" | "revoked";

export type TeamMember = {
  /** Null for an admin who has no roster row yet (made before this page existed). */
  memberId: string | null;
  userId: string | null;
  email: string | null;
  name: string;
  duty: string;
  rank: TeamRank;
  status: MemberStatus;
  /** The last four digits, or null when no number is on file. */
  phoneLast4: string | null;
  hasPhone: boolean;
  /** Their LINE account is known, so Jaga can send them their way in. */
  lineReady: boolean;
  lineSentAt: string | null;
  createdAt: string;
  approvedAt: string | null;
};

/** The duties offered as suggestions when adding somebody. Free text all the same. */
export const DUTY_SUGGESTIONS = [
  "alerts",
  "warRoom",
  "moderation",
  "authorities",
  "reports",
  "science",
  "donations",
  "everything",
] as const;

function rankOf(row: Record<string, unknown>): TeamRank {
  if (row.role === "super_admin") return "super";
  return row.deputy === true ? "deputy" : "admin";
}

function status(value: unknown): MemberStatus {
  return value === "invited" || value === "requested" || value === "revoked"
    ? value
    : "active";
}

/** One row of `admin_team()` as the page wants it. */
export function toTeamMember(row: Record<string, unknown>): TeamMember {
  return {
    memberId: typeof row.member_id === "string" ? row.member_id : null,
    userId: typeof row.user_id === "string" ? row.user_id : null,
    email: typeof row.email === "string" && row.email !== "" ? row.email : null,
    name: typeof row.full_name === "string" ? row.full_name : "",
    duty: typeof row.duty === "string" ? row.duty : "",
    rank: rankOf(row),
    status: status(row.status),
    phoneLast4: typeof row.phone_last4 === "string" ? row.phone_last4 : null,
    hasPhone: row.has_phone === true,
    lineReady: row.line_ready === true,
    lineSentAt: typeof row.line_sent_at === "string" ? row.line_sent_at : null,
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
    approvedAt: typeof row.approved_at === "string" ? row.approved_at : null,
  };
}

const RANK_ORDER: Record<TeamRank, number> = { super: 0, deputy: 1, admin: 2 };

/**
 * The team in the order the page shows it: those waiting first, because they are the only
 * rows that ask anything of the reader; then super admins, deputies, admins; then the people
 * whose access was taken away, oldest decision last.
 */
export function sortTeam(members: TeamMember[]): TeamMember[] {
  const bucket = (m: TeamMember) => (m.status === "revoked" ? 2 : m.status === "active" ? 1 : 0);
  return [...members].sort(
    (a, b) =>
      bucket(a) - bucket(b) ||
      RANK_ORDER[a.rank] - RANK_ORDER[b.rank] ||
      a.createdAt.localeCompare(b.createdAt),
  );
}

/** Those waiting for a decision: somebody who asked, or an invitation not taken up yet. */
export function waiting(members: TeamMember[]): TeamMember[] {
  return members.filter((m) => m.status === "requested" || m.status === "invited");
}

/** How many admins have no phone number on file. The page says so: the number is mandatory. */
export function missingPhones(members: TeamMember[]): number {
  return members.filter((m) => m.status === "active" && !m.hasPhone).length;
}

/** "••••1234", or null when there is nothing on file. */
export function maskedPhone(member: TeamMember): string | null {
  return member.phoneLast4 ? `••••${member.phoneLast4}` : null;
}

/** The team, for the page. Empty for anybody the database does not let read it. */
export async function readTeam(): Promise<TeamMember[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_team");
  const rows = (data as Record<string, unknown>[]) ?? [];
  return sortTeam(rows.map(toTeamMember));
}

/** Whether this session may work the team page: the super admin, or an active deputy. */
export async function canManageAdmins(): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("can_manage_admins");
  return data === true;
}

/** One phone number, read through the function that writes the look to the log. */
export async function revealAdminPhone(memberId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("reveal_admin_phone", { p_member_id: memberId });
  return typeof data === "string" && data !== "" ? data : null;
}

/** Where the caller's own request to join stands, for their account page. */
export type MyAdminRequest = { status: MemberStatus; duty: string; createdAt: string };

export async function readMyAdminRequest(): Promise<MyAdminRequest | null> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_admin_request");
  const row = ((data as Record<string, unknown>[]) ?? [])[0];
  if (!row) return null;
  return {
    status: status(row.status),
    duty: typeof row.duty === "string" ? row.duty : "",
    createdAt: typeof row.created_at === "string" ? row.created_at : "",
  };
}
