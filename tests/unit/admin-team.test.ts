/**
 * The admin team's shaping (A10, owner 16 Oct 2026): the order the page draws people in, what
 * a row says about them, and the two things that must never slip — a phone number only ever
 * reaching the page as four digits, and a duty never being read as a permission.
 */
import { describe, expect, it } from "vitest";
import {
  DUTY_SUGGESTIONS,
  maskedPhone,
  missingAccounts,
  missingPhones,
  sortTeam,
  toTeamMember,
  waiting,
  type TeamMember,
} from "@/lib/admin-team";

const row = (over: Record<string, unknown> = {}) => ({
  member_id: "11111111-1111-4111-8111-111111111111",
  user_id: "22222222-2222-4222-8222-222222222222",
  email: "someone@example.com",
  full_name: "Somebody",
  duty: "Alerts",
  deputy: false,
  status: "active",
  role: "admin",
  phone_last4: "4567",
  has_phone: true,
  has_account: true,
  line_ready: false,
  line_sent_at: null,
  created_at: "2026-10-16T09:00:00Z",
  approved_at: "2026-10-16T09:00:00Z",
  ...over,
});

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  ...toTeamMember(row()),
  ...over,
});

describe("one row of the team", () => {
  it("reads a plain admin, a deputy and the super admin as their own rank", () => {
    expect(toTeamMember(row()).rank).toBe("admin");
    expect(toTeamMember(row({ deputy: true })).rank).toBe("deputy");
    // The super admin's role wins: a deputy flag on that row changes nothing.
    expect(toTeamMember(row({ role: "super_admin", deputy: true })).rank).toBe("super");
  });

  it("keeps an unknown status out: anything it does not know is 'active'", () => {
    expect(toTeamMember(row({ status: "requested" })).status).toBe("requested");
    expect(toTeamMember(row({ status: "nonsense" })).status).toBe("active");
  });

  it("carries no phone number, only its last four digits", () => {
    const m = toTeamMember(row());
    expect(Object.values(m).join(" ")).not.toContain("66891234567");
    expect(maskedPhone(m)).toBe("••••4567");
    expect(maskedPhone(member({ phoneLast4: null, hasPhone: false }))).toBeNull();
  });

  it("treats an admin with no row of their own as one of the team all the same", () => {
    const m = toTeamMember(row({ member_id: null, duty: "", has_phone: false }));
    expect(m.memberId).toBeNull();
    expect(m.hasPhone).toBe(false);
    expect(m.status).toBe("active");
  });
});

describe("the order of the list", () => {
  it("puts those waiting first, then the super admin, deputies, admins, then the removed", () => {
    const team = [
      member({ memberId: "d", rank: "deputy" }),
      member({ memberId: "r", status: "revoked" }),
      member({ memberId: "a", rank: "admin" }),
      member({ memberId: "w", status: "requested" }),
      member({ memberId: "s", rank: "super" }),
    ];
    expect(sortTeam(team).map((m) => m.memberId)).toEqual(["w", "s", "d", "a", "r"]);
  });

  it("holds the same rank in the order people joined", () => {
    const team = [
      member({ memberId: "late", createdAt: "2026-10-16T10:00:00Z" }),
      member({ memberId: "early", createdAt: "2026-10-01T10:00:00Z" }),
    ];
    expect(sortTeam(team).map((m) => m.memberId)).toEqual(["early", "late"]);
  });
});

describe("what the page has to say out loud", () => {
  it("counts only those waiting for a decision", () => {
    const team = [
      member({ status: "requested" }),
      member({ status: "invited" }),
      member({ status: "active" }),
      member({ status: "revoked" }),
    ];
    expect(waiting(team).map((m) => m.status)).toEqual(["requested", "invited"]);
  });

  it("names those who cannot sign in because no account exists for their address", () => {
    const team = [
      member({ memberId: "waiting", status: "invited", hasAccount: false }),
      member({ memberId: "fine", status: "active", hasAccount: true }),
      // Somebody whose access was taken away is not waiting for an account.
      member({ memberId: "gone", status: "revoked", hasAccount: false }),
    ];
    expect(missingAccounts(team).map((m) => m.memberId)).toEqual(["waiting"]);
  });

  it("counts the admins with no phone number, because every admin needs one", () => {
    const team = [
      member({ status: "active", hasPhone: false }),
      member({ status: "active", hasPhone: true }),
      // Somebody who has left is not a gap to fill.
      member({ status: "revoked", hasPhone: false }),
    ];
    expect(missingPhones(team)).toBe(1);
  });
});

describe("duties", () => {
  it("are suggestions, with no 'everything' standing in for a power", () => {
    expect(DUTY_SUGGESTIONS).toContain("alerts");
    expect(new Set(DUTY_SUGGESTIONS).size).toBe(DUTY_SUGGESTIONS.length);
  });
});
