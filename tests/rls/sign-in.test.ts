/**
 * A2: sign-in and registration. Acceptance: no client path can set a role or a status.
 * Each test runs in its own transaction on the dev database and is rolled back.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, createUser, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query("begin");
  w = await buildWorld(db);
});
afterEach(async () => {
  await db.query("rollback");
});

const one = async <T>(sql: string, params: unknown[] = []) => (await rows<T>(db, sql, params))[0]!;
const roleOf = async (uid: string) => {
  await asOwner(db);
  return (await one<{ role: string }>("select role from profiles where user_id = $1", [uid])).role;
};
const invite = async (contact: string, role = "admin", age = "0 days") => {
  await asOwner(db);
  await db.query(
    `insert into admin_invitations (email_or_phone, role, invited_by, created_at)
     values ($1, $2::user_role, $3, now() - $4::interval)`,
    [contact, role, w.superAdmin, age],
  );
};
const confirmEmail = async (uid: string) => {
  await asOwner(db);
  await db.query("update auth.users set email_confirmed_at = now() where id = $1", [uid]);
  return (await one<{ email: string }>("select email from auth.users where id = $1", [uid])).email;
};

const REGISTER = `select register_authority_unit($1, $2::org_type, $3, $4, $5, $6, $7,
                    $8::authority_capability[], $9::jsonb) as id`;
const registration = (coverage: unknown, over: Record<number, unknown> = {}) => {
  const args: unknown[] = [
    "Pattani Volunteer Rescue",
    "volunteer",
    "Boat team 1",
    "073111111",
    true,
    "Somchai",
    "+66812345678",
    ["rescue", "support"],
    JSON.stringify(coverage),
  ];
  for (const [i, v] of Object.entries(over)) args[Number(i)] = v;
  return args;
};

describe("roles", () => {
  it("a user cannot set their own LINE user ID", async () => {
    await as(db, { uid: w.otherUser });
    expect(
      await expectDenied(
        db,
        "update profiles set line_user_id = 'U123' where user_id = (select auth.uid())",
      ),
    ).toBe("42501");
  });

  it("an invited, confirmed email becomes an admin; the invitation is used up and logged", async () => {
    const email = await confirmEmail(w.otherUser);
    await invite(email);
    await as(db, { uid: w.otherUser });
    expect((await one<{ r: string }>("select accept_admin_invitation() as r")).r).toBe("admin");
    expect(await roleOf(w.otherUser)).toBe("admin");
    const inv = await one<{ status: string }>(
      "select status from admin_invitations where email_or_phone = $1",
      [email],
    );
    expect(inv.status).toBe("accepted");
    const log = await rows(
      db,
      "select 1 from audit_log where action = 'accept_admin_invitation' and entity_id = $1",
      [w.otherUser],
    );
    expect(log).toHaveLength(1);
  });

  it("no invitation, an unconfirmed email or a lapsed invitation grants nothing", async () => {
    await as(db, { uid: w.otherUser });
    expect((await one<{ r: string | null }>("select accept_admin_invitation() as r")).r).toBeNull();

    await asOwner(db);
    const { email } = await one<{ email: string }>("select email from auth.users where id = $1", [
      w.otherUser,
    ]);
    await invite(email);
    await as(db, { uid: w.otherUser });
    expect((await one<{ r: string | null }>("select accept_admin_invitation() as r")).r).toBeNull();

    await asOwner(db);
    const other = await createUser(db, { name: "late" });
    await invite(await confirmEmail(other), "admin", "15 days");
    await as(db, { uid: other });
    expect((await one<{ r: string | null }>("select accept_admin_invitation() as r")).r).toBeNull();
    expect(await roleOf(w.otherUser)).toBe("user");
    expect(await roleOf(other)).toBe("user");
  });

  it("only the super admin changes admin roles, and never their own", async () => {
    await as(db, { uid: w.admin });
    expect(await expectDenied(db, "select set_admin_role($1, 'admin')", [w.otherUser])).toBe(
      "42501",
    );
    await as(db, { uid: w.otherUser });
    expect(await expectDenied(db, "select set_admin_role($1, 'super_admin')", [w.otherUser])).toBe(
      "42501",
    );

    await as(db, { uid: w.superAdmin });
    expect(await expectDenied(db, "select set_admin_role($1, 'user')", [w.superAdmin])).toBe(
      "23514",
    );
    await db.query("select set_admin_role($1, 'user')", [w.admin]);
    expect(await roleOf(w.admin)).toBe("user");
  });
});

describe("authority registration", () => {
  it("creates a pending unit with its coverage expanded to tambons", async () => {
    await asOwner(db);
    const { district_code: district } = await one<{ district_code: string }>(
      "select district_code from tambons where province_code = '94' order by code limit 1",
    );
    const { n: expected } = await one<{ n: string }>(
      "select count(*) as n from tambons where district_code = $1",
      [district],
    );
    await as(db, { uid: w.otherUser });
    const { id } = await one<{ id: string }>(
      REGISTER,
      registration([
        { level: "district", code: district },
        { level: "tambon", code: w.yala1 },
      ]),
    );
    const unit = await one<{ status: string; capabilities: string }>(
      "select status, capabilities::text from authority_units where id = $1",
      [id],
    );
    expect(unit.status).toBe("pending");
    expect(unit.capabilities).toBe("{rescue,support}");
    const coverage = await rows<{ selected_level: string }>(
      db,
      "select selected_level from authority_coverage where unit_id = $1",
      [id],
    );
    expect(coverage).toHaveLength(Number(expected) + 1);
    expect(await roleOf(w.otherUser)).toBe("user");
    await as(db, { uid: w.otherUser });
    expect(await rows(db, "select 1 from sos_requests")).toHaveLength(0);
  });

  it("rejects an area outside the covered provinces, no capability, and visitors", async () => {
    await as(db, { uid: w.otherUser });
    expect(
      await expectDenied(db, REGISTER, registration([{ level: "province", code: "10" }])),
    ).toBe("23514");
    expect(
      await expectDenied(
        db,
        REGISTER,
        registration([{ level: "tambon", code: w.yala1 }], { 7: [] }),
      ),
    ).toBe("23514");
    await as(db, "anon");
    expect(
      await expectDenied(db, REGISTER, registration([{ level: "tambon", code: w.yala1 }])),
    ).toBe("42501");
  });

  it("a new organization's phone is not public until one of its units is verified", async () => {
    await as(db, { uid: w.otherUser });
    const { id } = await one<{ id: string }>(
      REGISTER,
      registration([{ level: "tambon", code: w.yala1 }]),
    );
    const visible = async () => {
      await as(db, "anon");
      return rows(db, "select 1 from organizations where name = 'Pattani Volunteer Rescue'");
    };
    expect(await visible()).toHaveLength(0);
    await as(db, { uid: w.admin });
    await db.query("select verify_authority_unit($1, true)", [id]);
    expect(await visible()).toHaveLength(1);
  });

  it("the registrant cannot verify the unit; an admin must confirm the phone by a call", async () => {
    await as(db, { uid: w.otherUser });
    const { id } = await one<{ id: string }>(
      REGISTER,
      registration([{ level: "tambon", code: w.yala1 }]),
    );
    expect(await expectDenied(db, "select verify_authority_unit($1, true)", [id])).toBe("42501");
    expect(
      await expectDenied(db, "update authority_units set status = 'verified' where id = $1", [id]),
    ).toBe("42501");

    await as(db, { uid: w.admin });
    expect(await expectDenied(db, "select verify_authority_unit($1, false)", [id])).toBe("23514");
    await db.query("select verify_authority_unit($1, true)", [id]);
    await asOwner(db);
    const unit = await one<{ status: string; verified_by: string; called: boolean }>(
      `select u.status, u.verified_by, c.poc_phone_verified_by_call as called
       from authority_units u join authority_unit_contacts c on c.unit_id = u.id where u.id = $1`,
      [id],
    );
    expect(unit).toEqual({ status: "verified", verified_by: w.admin, called: true });
    expect(await roleOf(w.otherUser)).toBe("authority");
    expect(
      await rows(
        db,
        "select 1 from audit_log where action = 'verify_authority' and entity_id = $1",
        [id],
      ),
    ).toHaveLength(1);

    await as(db, { uid: w.admin });
    await db.query("select suspend_authority_unit($1, 'test')", [id]);
    expect(await roleOf(w.otherUser)).toBe("user");
    await as(db, { uid: w.otherUser });
    expect(await rows(db, "select 1 from sos_requests")).toHaveLength(0);
  });
});

describe("verified flags on phone numbers", () => {
  it("a personal phone is verified only when it is the OTP sign-in number", async () => {
    await as(db, { uid: w.requester });
    expect(await rows(db, "select phone_verified from profile_contacts")).toEqual([
      { phone_verified: true },
    ]);
    expect(await expectDenied(db, "update profile_contacts set phone_verified = true")).toBe(
      "42501",
    );
    await db.query("update profile_contacts set phone = '+66855555555'");
    expect(await rows(db, "select phone_verified from profile_contacts")).toEqual([
      { phone_verified: false },
    ]);

    // Signed in without a phone (LINE): the typed number is stored as unverified.
    const lineUser = await (async () => {
      await asOwner(db);
      return createUser(db, { name: "line user" });
    })();
    await as(db, { uid: lineUser });
    await db.query(
      "insert into profile_contacts (user_id, phone) values ((select auth.uid()), '+66866666666')",
    );
    expect(await rows(db, "select phone_verified from profile_contacts")).toEqual([
      { phone_verified: false },
    ]);

    // Confirming that number by OTP later marks it verified.
    await asOwner(db);
    await db.query(
      "update auth.users set phone = '66866666666', phone_confirmed_at = now() where id = $1",
      [lineUser],
    );
    expect(
      await rows(db, "select phone_verified from profile_contacts where user_id = $1", [lineUser]),
    ).toEqual([{ phone_verified: true }]);
  });

  it("a registrant cannot mark the contact phone as confirmed; changing it clears a confirmation", async () => {
    await as(db, { uid: w.yalaPending.user });
    expect(
      await expectDenied(
        db,
        "update authority_unit_contacts set poc_phone_verified_by_call = true",
      ),
    ).toBe("42501");
    expect(
      await expectDenied(db, "update authority_unit_contacts set poc_phone_verified = true"),
    ).toBe("42501");

    await asOwner(db);
    await db.query(
      "update authority_unit_contacts set poc_phone_verified_by_call = true where unit_id = $1",
      [w.yalaPending.id],
    );
    await as(db, { uid: w.yalaPending.user });
    await db.query("update authority_unit_contacts set poc_phone = '+66877777777'");
    await as(db, { uid: w.admin });
    expect(
      await expectDenied(db, "select verify_authority_unit($1, false)", [w.yalaPending.id]),
    ).toBe("23514");
  });
});

describe("sign-in codes by SMS", () => {
  it("limits sends per phone and is closed to clients", async () => {
    await asOwner(db);
    const allowed = async () =>
      (await one<{ ok: boolean }>("select otp_send_allowed('+66800000001', '203.0.113.7') as ok"))
        .ok;
    for (let i = 0; i < 5; i++) expect(await allowed()).toBe(true);
    expect(await allowed()).toBe(false);
    expect(
      await rows(db, "select 1 from otp_send_log where phone_hash !~ '^[0-9a-f]{64}$'"),
    ).toHaveLength(0);
    await as(db, { uid: w.otherUser });
    expect(await expectDenied(db, "select otp_send_allowed('+66800000002', '203.0.113.7')")).toBe(
      "42501",
    );
    expect(await expectDenied(db, "select 1 from otp_send_log")).toBe("42501");
  });
});
