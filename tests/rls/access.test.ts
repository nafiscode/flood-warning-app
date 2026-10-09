/**
 * RLS policy tests for every role (spec section 9, safety rules 5 and 6; A1 acceptance checks).
 * Each test runs in its own transaction on the dev database and is rolled back.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
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

const count = async (sql: string, params: unknown[] = []) =>
  Number((await rows<{ n: string }>(db, `select count(*) as n from (${sql}) q`, params))[0]!.n);

const auditCount = async (action: string, entityId: string) => {
  await asOwner(db);
  return count("select 1 from audit_log where action = $1 and entity_id = $2", [action, entityId]);
};

describe("every table", () => {
  it("has row-level security enabled", async () => {
    const off = await rows(
      db,
      "select tablename from pg_tables where schemaname = 'public' and not rowsecurity",
    );
    expect(off).toEqual([]);
  });
});

describe("visitor (anon)", () => {
  beforeEach(async () => as(db, "anon"));

  it("reads public data: hazards, all 77 provinces, tambons, alerts, safe places", async () => {
    expect(await count("select 1 from hazards")).toBe(5);
    expect(await count("select 1 from provinces")).toBe(77);
    expect(await count("select 1 from provinces where status = 'active'")).toBe(4);
    expect(await count("select 1 from tambons")).toBeGreaterThan(300);
    await rows(db, "select * from alerts");
    await rows(db, "select * from safe_places");
  });

  it("A1 acceptance: cannot read phones or exact SOS points", async () => {
    expect(await count("select 1 from sos_requests")).toBe(0);
    expect(await count("select 1 from sos_contacts")).toBe(0);
    expect(await count("select 1 from profile_contacts")).toBe(0);
    expect(await count("select 1 from authority_unit_contacts")).toBe(0);
    expect(await count("select 1 from households")).toBe(0);
    expect(await count("select 1 from reports")).toBe(0);
    expect(await count("select 1 from profiles")).toBe(0);
    expect(await expectDenied(db, "select reveal_sos_phone($1)", [w.yalaSos])).toBe("42501");
  });

  it("sees an organization only if it opted in to a public contact", async () => {
    const orgs = await rows<{ id: string }>(db, "select id from organizations");
    expect(orgs.map((o) => o.id)).toEqual([w.publicOrg]);
  });

  it("cannot write anything directly", async () => {
    await expectDenied(
      db,
      "insert into reports (point) values (extensions.st_makepoint(101.28, 6.54))",
    );
    await expectDenied(
      db,
      "insert into sos_requests (point) values (extensions.st_makepoint(101.28, 6.54))",
    );
    await expectDenied(db, "update alerts set level = 'normal'");
  });
});

describe("user", () => {
  it("A1 acceptance: cannot change their own role", async () => {
    await as(db, { uid: w.otherUser });
    expect(
      await expectDenied(db, "update profiles set role = 'admin' where user_id = $1", [
        w.otherUser,
      ]),
    ).toBe("42501");
    await db.query("update profiles set display_name = 'Aminah' where user_id = $1", [w.otherUser]);
    await asOwner(db);
    const [p] = await rows<{ role: string; display_name: string }>(
      db,
      "select role, display_name from profiles where user_id = $1",
      [w.otherUser],
    );
    expect(p).toEqual({ role: "user", display_name: "Aminah" });
  });

  it("cannot empty their display name, and spaces around it are dropped", async () => {
    await as(db, { uid: w.otherUser });
    await db.query("update profiles set display_name = '  Aminah  ' where user_id = $1", [
      w.otherUser,
    ]);
    expect(
      await rows(db, "select display_name from profiles where user_id = $1", [w.otherUser]),
    ).toEqual([{ display_name: "Aminah" }]);
    // A name is required of every account (spec section 3), so it may not be taken back.
    for (const attempt of ["''", "'   '"]) {
      expect(
        await expectDenied(db, `update profiles set display_name = ${attempt} where user_id = $1`, [
          w.otherUser,
        ]),
      ).toBe("23514");
    }
    expect(
      await rows(db, "select display_name from profiles where user_id = $1", [w.otherUser]),
    ).toEqual([{ display_name: "Aminah" }]);
  });

  it("reads only their own profile, phone and household", async () => {
    await as(db, { uid: w.requester });
    expect(await count("select 1 from profiles")).toBe(1);
    expect(await rows(db, "select phone from profile_contacts")).toEqual([
      { phone: "66811111111" },
    ]);
    expect(await count("select 1 from households")).toBe(1);
    await as(db, { uid: w.otherUser });
    expect(await count("select 1 from households")).toBe(0);
    expect(await expectDenied(db, "select reveal_profile_phone($1)", [w.requester])).toBe("42501");
  });

  it("sees their own SOS and its phone, but not the spam flag or other cases", async () => {
    await as(db, { uid: w.requester });
    const mine = await rows<{ id: string }>(db, "select id from sos_requests");
    expect(mine.map((r) => r.id)).toEqual([w.yalaSos]);
    expect(await count("select 1 from sos_contacts")).toBe(1);
    expect(await count("select 1 from sos_review")).toBe(0);
    await as(db, { uid: w.otherUser });
    expect(await count("select 1 from sos_requests")).toBe(0);
  });

  it("submits reports only as themselves and only as pending", async () => {
    await as(db, { uid: w.otherUser });
    await db.query(
      "insert into reports (reporter_id, point, tambon) values ($1, extensions.st_makepoint(101.28, 6.54), $2)",
      [w.otherUser, w.yala1],
    );
    await expectDenied(
      db,
      "insert into reports (reporter_id, point) values ($1, extensions.st_makepoint(101.28, 6.54))",
      [w.requester],
    );
    await expectDenied(
      db,
      "insert into reports (reporter_id, point, moderation_status) values ($1, extensions.st_makepoint(101.28, 6.54), 'approved')",
      [w.otherUser],
    );
  });

  it("cannot publish alerts", async () => {
    await as(db, { uid: w.otherUser });
    await expectDenied(
      db,
      `insert into alerts (level, reason, messages, issued_by, next_update_at)
       values ('evacuate', 'test', '{"th": "x"}', $1, now() + interval '3 hours')`,
      [w.otherUser],
    );
  });
});

describe("pending authority", () => {
  beforeEach(async () => as(db, { uid: w.yalaPending.user }));

  it("A1 acceptance: sees no personal data", async () => {
    expect(await count("select 1 from sos_requests")).toBe(0);
    expect(await count("select 1 from reports")).toBe(0);
    expect(await count("select 1 from sos_review")).toBe(0);
    expect(await expectDenied(db, "select reveal_sos_phone($1)", [w.yalaSos])).toBe("42501");
    expect(await expectDenied(db, "select * from households_in_tambon($1)", [w.yala1])).toBe(
      "42501",
    );
    expect(await expectDenied(db, "select * from reveal_poc_phone($1)", [w.yalaRescue.id])).toBe(
      "42501",
    );
  });

  it("cannot verify itself, but can edit its unit and coverage while pending", async () => {
    await expectDenied(db, "update authority_units set status = 'verified' where id = $1", [
      w.yalaPending.id,
    ]);
    await db.query("update authority_units set unit_name = 'Yala pending team' where id = $1", [
      w.yalaPending.id,
    ]);
    await db.query(
      "insert into authority_coverage (unit_id, tambon, selected_level, selected_code) values ($1, $2, 'tambon', $2)",
      [w.yalaPending.id, w.yala2],
    );
  });
});

describe("verified authority", () => {
  it("A1 acceptance: a Yala authority cannot read a Songkhla SOS", async () => {
    await as(db, { uid: w.yalaRescue.user });
    const seen = await rows<{ id: string }>(db, "select id from sos_requests");
    expect(seen.map((r) => r.id)).toEqual([w.yalaSos]);
    expect(await expectDenied(db, "select reveal_sos_phone($1)", [w.songkhlaSos])).toBe("42501");
  });

  it("reads the exact location, reports and spam flag in its coverage; each phone reveal is logged", async () => {
    await as(db, { uid: w.yalaRescue.user });
    expect(await count("select 1 from reports")).toBe(1);
    expect(await count("select 1 from sos_review where suspected_spam")).toBe(1);
    expect(await count("select 1 from sos_contacts")).toBe(0); // no direct read
    const [r] = await rows<{ phone: string }>(db, "select reveal_sos_phone($1) as phone", [
      w.yalaSos,
    ]);
    expect(r!.phone).toBe("66811111111");
    expect(await auditCount("reveal_phone", w.yalaSos)).toBe(1);
  });

  it("A1 acceptance: reads POC phones only within shared coverage, and each reveal is logged", async () => {
    await as(db, { uid: w.yalaRescue.user });
    const [poc] = await rows<{ poc_phone: string }>(db, "select * from reveal_poc_phone($1)", [
      w.yalaPlanning.id,
    ]);
    expect(poc!.poc_phone).toBe("66830000002");
    expect(await auditCount("reveal_phone", w.yalaPlanning.id)).toBe(1);
    await as(db, { uid: w.yalaRescue.user });
    expect(
      await expectDenied(db, "select * from reveal_poc_phone($1)", [w.songkhlaRescue.id]),
    ).toBe("42501");
    expect(await count("select 1 from authority_unit_contacts")).toBe(1); // only its own
  });

  it("A1 acceptance: without rescue or coordination capability it cannot read households", async () => {
    await as(db, { uid: w.yalaPlanning.user });
    expect(await expectDenied(db, "select * from households_in_tambon($1)", [w.yala1])).toBe(
      "42501",
    );
    await as(db, { uid: w.yalaRescue.user });
    expect(await count("select * from households_in_tambon($1)", [w.yala1])).toBe(1);
    expect(await count("select 1 from households")).toBe(0); // no direct read
    expect(await auditCount("read_households", w.yala1)).toBe(1);
  });

  it("claims only cases in its coverage, one active claim per SOS", async () => {
    await as(db, { uid: w.yalaRescue.user });
    await db.query("insert into sos_claims (sos_id, unit_id) values ($1, $2)", [
      w.yalaSos,
      w.yalaRescue.id,
    ]);
    await expectDenied(db, "insert into sos_claims (sos_id, unit_id) values ($1, $2)", [
      w.songkhlaSos,
      w.yalaRescue.id,
    ]);
    await as(db, { uid: w.yalaPlanning.user });
    expect(
      await expectDenied(db, "insert into sos_claims (sos_id, unit_id) values ($1, $2)", [
        w.yalaSos,
        w.yalaPlanning.id,
      ]),
    ).toBe("23505");
  });

  it("cannot change its own status or widen its coverage once verified", async () => {
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(db, "update authority_units set status = 'pending' where id = $1", [
      w.yalaRescue.id,
    ]);
    await expectDenied(
      db,
      "insert into authority_coverage (unit_id, tambon, selected_level, selected_code) values ($1, $2, 'tambon', $2)",
      [w.yalaRescue.id, w.songkhla],
    );
  });
});

describe("admin", () => {
  beforeEach(async () => as(db, { uid: w.admin }));

  it("reads all SOS and the audit log; phone reveals are logged", async () => {
    expect(await count("select 1 from sos_requests")).toBe(2);
    await rows(db, "select reveal_sos_phone($1)", [w.songkhlaSos]);
    await rows(db, "select reveal_profile_phone($1)", [w.requester]);
    expect(await auditCount("reveal_phone", w.songkhlaSos)).toBe(1);
    await as(db, { uid: w.admin });
    expect(await count("select 1 from audit_log")).toBeGreaterThanOrEqual(2);
  });

  it("publishes alerts only as themselves, with a next-update time", async () => {
    await db.query(
      `insert into alerts (level, reason, messages, issued_by, next_update_at)
       values ('warning', 'Gauge above warning level', '{"th": "เตือนภัย"}', $1, now() + interval '6 hours')`,
      [w.admin],
    );
    await expectDenied(
      db,
      `insert into alerts (level, reason, messages, issued_by, next_update_at)
       values ('warning', 'test', '{"th": "x"}', $1, now() + interval '6 hours')`,
      [w.superAdmin],
    );
    await expectDenied(
      db,
      `insert into alerts (level, reason, messages, issued_by, next_update_at)
       values ('warning', 'test', '{"th": "x"}', $1, now() - interval '1 hour')`,
      [w.admin],
    );
  });

  it("cannot invite admins; the super admin can", async () => {
    await expectDenied(
      db,
      "insert into admin_invitations (email_or_phone, role, invited_by) values ('a@test.invalid', 'admin', $1)",
      [w.admin],
    );
    await as(db, { uid: w.superAdmin });
    await db.query(
      "insert into admin_invitations (email_or_phone, role, invited_by) values ('a@test.invalid', 'admin', $1)",
      [w.superAdmin],
    );
  });
});
