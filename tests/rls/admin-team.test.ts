/**
 * A10: the admin team page (owner, 16 Oct 2026).
 *
 * What these tests guard:
 *  - the roster is the super admin's and a deputy's; an ordinary admin, a user and a visitor
 *    read none of it;
 *  - a phone number is mandatory, never selectable even by the people who may see the page,
 *    and every look at one is written to the audit log (safety rule 5);
 *  - only the super admin appoints a deputy, and a deputy cannot appoint another;
 *  - a duty is required and restricts nothing;
 *  - asking from the account page grants nothing until somebody approves it;
 *  - taking access away puts the role back and leaves the row on the list;
 *  - a super admin is never removed from this page.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, createUser, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

// The shape every phone number in Jaga is stored in; the server actions normalise what
// somebody types ("089...") into it before the call reaches these functions.
const PHONE = "+66891234567";

/** Add somebody as the super admin and give back the new row's id. */
async function add(
  email: string,
  opts: { duty?: string; phone?: string; deputy?: boolean } = {},
): Promise<string> {
  const got = await rows<{ add_admin_member: string }>(
    db,
    "select add_admin_member($1, $2, $3, $4, $5)",
    [email, "Somebody", opts.phone ?? PHONE, opts.duty ?? "Alerts", opts.deputy ?? false],
  );
  return got[0]!.add_admin_member;
}

const roleOf = async (uid: string) =>
  (await rows<{ role: string }>(db, "select role from profiles where user_id = $1", [uid]))[0]
    ?.role;

/**
 * auth.users is the owner's to read, so this steps out of whatever role the test is acting as
 * and leaves it as the owner: every caller below sets its own role again straight after.
 */
const emailOf = async (uid: string) => {
  await asOwner(db);
  const got = await rows<{ email: string }>(
    db,
    "select lower(email) as email from auth.users where id = $1",
    [uid],
  );
  return got[0]!.email;
};

beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query("begin");
  w = await buildWorld(db);
  await asOwner(db);
});
afterEach(async () => {
  await db.query("rollback");
});

describe("who may work the admin team page", () => {
  it("the super admin may; an ordinary admin, a user and a visitor may not", async () => {
    for (const caller of [{ uid: w.admin }, { uid: w.requester }] as const) {
      await as(db, caller);
      expect(await rows(db, "select * from admin_members")).toEqual([]);
      expect((await rows<{ can: boolean }>(db, "select can_manage_admins() as can"))[0]!.can).toBe(
        false,
      );
    }
    // A visitor cannot even ask the question: the function is not theirs to run.
    await as(db, "anon");
    expect(await rows(db, "select * from admin_members")).toEqual([]);
    expect(await expectDenied(db, "select can_manage_admins()")).toBe("42501");

    await as(db, { uid: w.superAdmin });
    expect((await rows<{ can: boolean }>(db, "select can_manage_admins() as can"))[0]!.can).toBe(
      true,
    );
  });

  it("an ordinary admin cannot add, approve, change or remove anybody", async () => {
    const email = await emailOf(w.otherUser);
    await as(db, { uid: w.superAdmin });
    const member = await add(email);
    for (const caller of [{ uid: w.admin }, { uid: w.requester }] as const) {
      await as(db, caller);
      expect(
        await expectDenied(db, "select add_admin_member($1, $2, $3, $4)", [
          "someone@example.com",
          "x",
          PHONE,
          "Alerts",
        ]),
      ).toBe("42501");
      expect(await expectDenied(db, "select update_admin_member($1, $2)", [member, "x"])).toBe(
        "42501",
      );
      expect(await expectDenied(db, "select revoke_admin_member($1)", [member])).toBe("42501");
      expect(await expectDenied(db, "select reveal_admin_phone($1)", [member])).toBe("42501");
    }
  });
});

describe("adding somebody", () => {
  it("needs a phone number and a duty", async () => {
    const email = await emailOf(w.otherUser);
    await as(db, { uid: w.superAdmin });
    expect(
      await expectDenied(db, "select add_admin_member($1, $2, $3, $4)", [email, "x", "", "Alerts"]),
    ).toBe("23514");
    expect(
      await expectDenied(db, "select add_admin_member($1, $2, $3, $4)", [email, "x", PHONE, " "]),
    ).toBe("23514");
    expect(
      await expectDenied(db, "select add_admin_member($1, $2, $3, $4)", [
        "not-an-address",
        "x",
        PHONE,
        "Alerts",
      ]),
    ).toBe("23514");
  });

  it("makes an existing account an admin at once, and shows it on the team", async () => {
    const email = await emailOf(w.otherUser);
    await as(db, { uid: w.superAdmin });
    const member = await add(email, { duty: "War room" });
    const team = await rows<{ member_id: string; duty: string; status: string; role: string }>(
      db,
      "select * from admin_team() where member_id = $1",
      [member],
    );
    expect(team[0]!.duty).toBe("War room");
    expect(team[0]!.status).toBe("active");
    await asOwner(db);
    expect(await roleOf(w.otherUser)).toBe("admin");
  });

  it("lists the admins who have no row here, so nobody with the role is hidden", async () => {
    await as(db, { uid: w.superAdmin });
    const team = await rows<{ user_id: string; role: string; member_id: string | null }>(
      db,
      "select * from admin_team()",
    );
    const plain = team.find((r) => r.user_id === w.admin);
    expect(plain?.member_id).toBeNull();
    expect(team.some((r) => r.user_id === w.superAdmin && r.role === "super_admin")).toBe(true);
  });

  it("says whether an account exists for the address, because nothing else can", async () => {
    // Added by email from a site with no Auth admin key: the row is written, but there is
    // nothing for that person to sign in to until an account is opened for the address.
    await as(db, { uid: w.superAdmin });
    await db.query("select add_admin_member($1, $2, $3, $4)", [
      "nobody-yet@example.com",
      "Nobody",
      PHONE,
      "Alerts",
    ]);
    const invited = (
      await rows<{ has_account: boolean; status: string }>(
        db,
        "select has_account, status from admin_team() where email = $1",
        ["nobody-yet@example.com"],
      )
    )[0]!;
    expect(invited.status).toBe("invited");
    expect(invited.has_account).toBe(false);

    // One that does have an account reads the other way round.
    const email = await emailOf(w.otherUser);
    await as(db, { uid: w.superAdmin });
    const member = await add(email);
    expect(
      (
        await rows<{ has_account: boolean }>(
          db,
          "select has_account from admin_team() where member_id = $1",
          [member],
        )
      )[0]!.has_account,
    ).toBe(true);
  });

  it("refuses a second row for the same address", async () => {
    const email = await emailOf(w.otherUser);
    await as(db, { uid: w.superAdmin });
    await add(email);
    expect(
      await expectDenied(db, "select add_admin_member($1, $2, $3, $4)", [
        email,
        "x",
        PHONE,
        "Alerts",
      ]),
    ).toBe("23505");
  });
});

describe("the phone number", () => {
  it("is never selectable, not even by the super admin, and the list gives four digits", async () => {
    const email = await emailOf(w.otherUser);
    await as(db, { uid: w.superAdmin });
    const member = await add(email);
    expect(await rows(db, "select * from admin_member_contacts")).toEqual([]);
    const team = await rows<{ phone_last4: string; has_phone: boolean }>(
      db,
      "select * from admin_team() where member_id = $1",
      [member],
    );
    expect(team[0]!.phone_last4).toBe("4567");
    expect(team[0]!.has_phone).toBe(true);
  });

  it("comes out one at a time, and the look is written to the log", async () => {
    const email = await emailOf(w.otherUser);
    await as(db, { uid: w.superAdmin });
    const member = await add(email);
    const got = await rows<{ reveal_admin_phone: string }>(db, "select reveal_admin_phone($1)", [
      member,
    ]);
    expect(got[0]!.reveal_admin_phone).toBe(PHONE);
    await asOwner(db);
    const log = await rows<{ actor: string }>(
      db,
      "select actor from audit_log where action = 'reveal_admin_phone' and entity_id = $1",
      [member],
    );
    expect(log).toHaveLength(1);
    expect(log[0]!.actor).toBe(w.superAdmin);
  });
});

describe("the deputy super admin", () => {
  it("is appointed by the super admin alone, and may then work the page", async () => {
    const email = await emailOf(w.otherUser);
    await as(db, { uid: w.superAdmin });
    const member = await add(email);
    await db.query("select set_admin_member_deputy($1, true)", [member]);

    await as(db, { uid: w.otherUser });
    expect((await rows<{ can: boolean }>(db, "select can_manage_admins() as can"))[0]!.can).toBe(
      true,
    );
    expect((await rows(db, "select * from admin_team()")).length).toBeGreaterThan(0);
    // They may add an admin, but never another deputy.
    await db.query("select add_admin_member($1, $2, $3, $4)", [
      "helper@example.com",
      "Helper",
      PHONE,
      "Moderation",
    ]);
    const other = (
      await rows<{ id: string }>(db, "select id from admin_members where email = $1", [
        "helper@example.com",
      ])
    )[0]!.id;
    expect(await expectDenied(db, "select set_admin_member_deputy($1, true)", [other])).toBe(
      "42501",
    );
    expect(
      await expectDenied(db, "select add_admin_member($1, $2, $3, $4, true)", [
        "two@example.com",
        "x",
        PHONE,
        "Alerts",
      ]),
    ).toBe("42501");
  });

  it("can only be somebody already on the team", async () => {
    await as(db, { uid: w.superAdmin });
    await db.query("select add_admin_member($1, $2, $3, $4)", [
      "later@example.com",
      "Later",
      PHONE,
      "Alerts",
    ]);
    const invited = (
      await rows<{ id: string; status: string }>(
        db,
        "select id, status from admin_members where email = $1",
        ["later@example.com"],
      )
    )[0]!;
    expect(invited.status).toBe("invited");
    expect(await expectDenied(db, "select set_admin_member_deputy($1, true)", [invited.id])).toBe(
      "23514",
    );
  });
});

describe("asking from the account page", () => {
  it("grants nothing by itself, and cannot be asked twice", async () => {
    await as(db, { uid: w.requester });
    await db.query("select request_admin_access($1, $2)", [PHONE, "I can watch the gauges"]);
    await asOwner(db);
    expect(await roleOf(w.requester)).toBe("user");
    await as(db, { uid: w.requester });
    expect(await expectDenied(db, "select request_admin_access($1, $2)", [PHONE, "again"])).toBe(
      "23505",
    );
    // Their own row, and nothing else, is readable from their account page.
    const mine = await rows<{ status: string }>(db, "select * from my_admin_request()");
    expect(mine[0]!.status).toBe("requested");
    expect(await rows(db, "select * from admin_members")).toEqual([]);
  });

  it("needs a phone number and a few words", async () => {
    await as(db, { uid: w.requester });
    expect(await expectDenied(db, "select request_admin_access($1, $2)", ["", "words"])).toBe(
      "23514",
    );
    expect(await expectDenied(db, "select request_admin_access($1, $2)", [PHONE, " "])).toBe(
      "23514",
    );
  });

  it("becomes an admin with a duty once it is approved", async () => {
    await as(db, { uid: w.requester });
    const id = (
      await rows<{ request_admin_access: string }>(db, "select request_admin_access($1, $2)", [
        PHONE,
        "I can watch the gauges",
      ])
    )[0]!.request_admin_access;

    await as(db, { uid: w.superAdmin });
    expect(await expectDenied(db, "select approve_admin_member($1, $2)", [id, ""])).toBe("23514");
    await db.query("select approve_admin_member($1, $2)", [id, "Signals"]);
    await asOwner(db);
    expect(await roleOf(w.requester)).toBe("admin");
    const row = (
      await rows<{ status: string; duty: string }>(
        db,
        "select status, duty from admin_members where id = $1",
        [id],
      )
    )[0]!;
    expect(row.status).toBe("active");
    expect(row.duty).toBe("Signals");
  });
});

describe("taking access away", () => {
  it("puts the role back and keeps the row on the list", async () => {
    const email = await emailOf(w.otherUser);
    await as(db, { uid: w.superAdmin });
    const member = await add(email);
    await db.query("select revoke_admin_member($1, $2)", [member, "Left the team"]);
    const row = (
      await rows<{ status: string; deputy: boolean }>(
        db,
        "select status, deputy from admin_members where id = $1",
        [member],
      )
    )[0]!;
    expect(row.status).toBe("revoked");
    expect(row.deputy).toBe(false);
    await asOwner(db);
    expect(await roleOf(w.otherUser)).toBe("user");
  });

  it("gives a verified team's account its authority role back, not a plain user role", async () => {
    const email = await emailOf(w.yalaRescue.user);
    await as(db, { uid: w.superAdmin });
    const member = await add(email);
    await db.query("select revoke_admin_member($1)", [member]);
    await asOwner(db);
    expect(await roleOf(w.yalaRescue.user)).toBe("authority");
  });

  it("never touches a super admin, and never the caller's own access", async () => {
    await asOwner(db);
    const second = await createUser(db, { name: "second super", role: "super_admin" });
    await db.query(
      `insert into admin_members (user_id, email, full_name, duty, status, approved_at)
       values ($1, $2, 'Second', 'Everything', 'active', now())`,
      [second, await emailOf(second)],
    );
    const row = (
      await rows<{ id: string }>(db, "select id from admin_members where user_id = $1", [second])
    )[0]!;
    await as(db, { uid: w.superAdmin });
    expect(await expectDenied(db, "select revoke_admin_member($1)", [row.id])).toBe("23514");

    await asOwner(db);
    await db.query(
      `insert into admin_members (user_id, email, full_name, duty, status, approved_at)
       values ($1, $2, 'Me', 'Everything', 'active', now())`,
      [w.superAdmin, await emailOf(w.superAdmin)],
    );
    const own = (
      await rows<{ id: string }>(db, "select id from admin_members where user_id = $1", [
        w.superAdmin,
      ])
    )[0]!;
    await as(db, { uid: w.superAdmin });
    expect(await expectDenied(db, "select revoke_admin_member($1)", [own.id])).toBe("23514");
  });
});

describe("binding an invitation at sign-in", () => {
  it("makes the waiting row theirs and grants the role once", async () => {
    await as(db, { uid: w.superAdmin });
    await db.query("select add_admin_member($1, $2, $3, $4)", [
      "newcomer@example.com",
      "Newcomer",
      PHONE,
      "Alerts",
    ]);
    await asOwner(db);
    const newcomer = await createUser(db, { name: "newcomer" });
    await db.query("update auth.users set email = $2, email_confirmed_at = now() where id = $1", [
      newcomer,
      "newcomer@example.com",
    ]);

    await as(db, { uid: newcomer });
    const got = await rows<{ member_id: string; send: boolean }>(
      db,
      "select * from link_admin_member()",
    );
    expect(got).toHaveLength(1);
    // No LINE account on this fixture, so nothing is to be sent.
    expect(got[0]!.send).toBe(false);
    await asOwner(db);
    expect(await roleOf(newcomer)).toBe("admin");
    expect(
      (
        await rows<{ status: string }>(db, "select status from admin_members where id = $1", [
          got[0]!.member_id,
        ])
      )[0]!.status,
    ).toBe("active");
  });
});
