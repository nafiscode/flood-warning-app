import { createClient } from "@/lib/supabase/server";

/**
 * A team's people (24 Oct 2026): who is on it, who is waiting for the owner to say yes, and which
 * invitation codes are still open. Every read and write is a database function that checks the
 * caller again; this file only carries the answers to the page.
 */

export type MemberRole = "owner" | "dispatcher" | "field";
export type MemberStatus = "pending" | "active";

export type TeamMember = {
  id: string;
  name: string;
  role: MemberRole;
  status: MemberStatus;
  joinedAt: string;
  isMe: boolean;
};

export type OpenInvite = { id: string; role: MemberRole; createdAt: string; expiresAt: string };

export type OwnedTeam = {
  unitId: string;
  unitName: string;
  orgName: string;
  members: TeamMember[];
  invites: OpenInvite[];
};

export type Membership = {
  unitId: string;
  unitName: string;
  orgName: string;
  role: MemberRole;
  status: MemberStatus;
};

type Row = Record<string, unknown>;

const ROLES: MemberRole[] = ["owner", "dispatcher", "field"];
const role = (v: unknown): MemberRole =>
  ROLES.includes(v as MemberRole) ? (v as MemberRole) : "field";

/** The teams this account owns (verified ones; an unverified team cannot invite) with their people. */
export async function readOwnedTeams(userId: string): Promise<OwnedTeam[]> {
  const supabase = await createClient();
  const { data: units, error } = await supabase
    .from("authority_units")
    .select("id, unit_name, organizations(name)")
    .eq("user_id", userId)
    .eq("status", "verified")
    .order("created_at");
  if (error) throw new Error(error.message);
  return Promise.all(
    ((units as Row[]) ?? []).map(async (u) => {
      const unitId = String(u.id);
      const [{ data: people }, { data: open }] = await Promise.all([
        supabase.rpc("unit_team", { p_unit: unitId }),
        supabase.rpc("unit_open_invites", { p_unit: unitId }),
      ]);
      return {
        unitId,
        unitName: String(u.unit_name),
        orgName: String((u.organizations as { name?: string } | null)?.name ?? ""),
        members: ((people as Row[]) ?? []).map((m) => ({
          id: String(m.member_id),
          name: typeof m.display_name === "string" ? m.display_name : "",
          role: role(m.role),
          status: m.status === "pending" ? ("pending" as const) : ("active" as const),
          joinedAt: String(m.joined_at),
          isMe: Boolean(m.is_me),
        })),
        invites: ((open as Row[]) ?? []).map((i) => ({
          id: String(i.invite_id),
          role: role(i.role),
          createdAt: String(i.created_at),
          expiresAt: String(i.expires_at),
        })),
      };
    }),
  );
}

/** Teams this account has joined, or asked to join, as someone other than the registrant. */
export async function readMemberships(): Promise<Membership[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_memberships");
  return ((data as Row[]) ?? [])
    .filter((m) => role(m.role) !== "owner")
    .map((m) => ({
      unitId: String(m.unit_id),
      unitName: String(m.unit_name),
      orgName: String(m.org_name ?? ""),
      role: role(m.role),
      status: m.member_status === "pending" ? ("pending" as const) : ("active" as const),
    }));
}

/** How many people are waiting for this account, as an owner, to let them in. */
export async function countWaiting(userId: string): Promise<number> {
  const teams = await readOwnedTeams(userId);
  return teams.reduce((n, t) => n + t.members.filter((m) => m.status === "pending").length, 0);
}
