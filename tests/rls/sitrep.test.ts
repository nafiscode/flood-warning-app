/**
 * SITREP for a verified unit (18 Nov 2026): `unit_sitrep(unit, from, to)`.
 *
 * What these tests are really guarding:
 *  - it reaches only the owner or an active dispatcher of a verified field unit - not a field
 *    member, a pending unit, an office-only unit, another unit's people or an ordinary account;
 *  - it carries counts and never a phone number, an exact point or a requester's free text, so it
 *    can be forwarded (safety rules 5 and 6);
 *  - it counts only the unit's own coverage, and every generation is in audit_log.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, createUser, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

type Sitrep = {
  sos: Record<string, number>;
  reports: Record<string, number>;
  by_tambon: { code: string; new_cases: number; new_people: number }[];
  alerts_now: { level: string; tambons: unknown[] }[];
};

let db: Client;
let w: World;
const CALL = "select unit_sitrep($1, now() - interval '1 day', now()) as r";

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
  // A requester's words, to prove they never travel.
  await db.query("update sos_requests set text = 'my house behind the mosque' where tambon = $1", [
    w.yala1,
  ]);
});
afterEach(async () => {
  await db.query("rollback");
});

async function sitrepAs(uid: string, unit: string): Promise<Sitrep> {
  await as(db, { uid });
  const r = (await rows<{ r: Sitrep }>(db, CALL, [unit]))[0]!.r;
  await asOwner(db);
  return r;
}

async function member(unit: string, role: string, status: string): Promise<string> {
  const uid = await createUser(db, { name: `${role} ${status}` });
  await db.query(
    "insert into authority_unit_members (unit_id, user_id, role, status) values ($1, $2, $3, $4)",
    [unit, uid, role, status],
  );
  return uid;
}

describe("unit_sitrep", () => {
  it("counts the unit's own cases, and nothing personal", async () => {
    const r = await sitrepAs(w.yalaRescue.user, w.yalaRescue.id);
    expect(Number(r.sos.new_cases)).toBe(1);
    expect(Number(r.sos.new_people)).toBe(3);
    expect(Number(r.sos.new_vulnerable)).toBe(1);
    expect(Number(r.sos.new_spam)).toBe(1);
    expect(Number(r.sos.open_now)).toBe(1);
    expect(r.by_tambon.map((t) => t.code)).toEqual([w.yala1]);
    const text = JSON.stringify(r);
    for (const secret of ["66811111111", "66830000001", "mosque", "POINT", "coordinates"]) {
      expect(text).not.toContain(secret);
    }
    // The Songkhla case is not in the Yala unit's report.
    expect(text).not.toContain(w.songkhla);
  });

  it("leaves out merged cases, and drills", async () => {
    await db.query(
      `insert into sos_requests (point, tambon, people_count, duplicate_of)
       select point, tambon, 2, id from sos_requests where tambon = $1`,
      [w.yala1],
    );
    const r = await sitrepAs(w.yalaRescue.user, w.yalaRescue.id);
    expect(Number(r.sos.new_cases)).toBe(1);
    expect(Number(r.sos.merged)).toBe(1);
    expect(r.alerts_now).toEqual([]);
  });

  it("reaches an active dispatcher, but not a field member or a pending one", async () => {
    const dispatcher = await member(w.yalaRescue.id, "dispatcher", "active");
    expect(Number((await sitrepAs(dispatcher, w.yalaRescue.id)).sos.new_cases)).toBe(1);

    for (const uid of [
      await member(w.yalaRescue.id, "field", "active"),
      await member(w.yalaRescue.id, "dispatcher", "pending"),
    ]) {
      await as(db, { uid });
      await expectDenied(db, CALL, [w.yalaRescue.id]);
      await asOwner(db);
    }
  });

  it("is closed to an office, a pending unit, another unit and an ordinary account", async () => {
    const cases: [string, string][] = [
      [w.yalaPlanning.user, w.yalaPlanning.id],
      [w.yalaPending.user, w.yalaPending.id],
      [w.songkhlaRescue.user, w.yalaRescue.id],
      [w.requester, w.yalaRescue.id],
    ];
    for (const [uid, unit] of cases) {
      await as(db, { uid });
      await expectDenied(db, CALL, [unit]);
      await asOwner(db);
    }
    await as(db, "anon");
    await expectDenied(db, CALL, [w.yalaRescue.id]);
  });

  it("refuses a period longer than seven days or in the future", async () => {
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(db, "select unit_sitrep($1, now() - interval '8 days', now())", [
      w.yalaRescue.id,
    ]);
    await expectDenied(db, "select unit_sitrep($1, now(), now() + interval '1 day')", [
      w.yalaRescue.id,
    ]);
  });

  it("writes every generation to the access log with its period", async () => {
    await sitrepAs(w.yalaRescue.user, w.yalaRescue.id);
    const log = await rows<{ details: { from: string; to: string } }>(
      db,
      "select details from audit_log where actor = $1 and action = 'read_sitrep' and entity_id = $2",
      [w.yalaRescue.user, w.yalaRescue.id],
    );
    expect(log).toHaveLength(1);
    expect(log[0]!.details.from).toBeTruthy();
  });

  it("shows a live alert on the unit's tambon, but never a drill", async () => {
    for (const drill of [true, false]) {
      const id = (
        await rows<{ id: string }>(
          db,
          `insert into alerts (hazard_type, level, reason, messages, issued_by, issued_at,
                               next_update_at, is_drill)
           values ('flood', 'warning', 'river at warning', '{}', $1, now() - interval '1 hour',
                   now() + interval '5 hours', $2) returning id`,
          [w.admin, drill],
        )
      )[0]!.id;
      await db.query("insert into alert_tambons (alert_id, tambon) values ($1, $2)", [id, w.yala1]);
    }
    const r = await sitrepAs(w.yalaRescue.user, w.yalaRescue.id);
    expect(r.alerts_now).toHaveLength(1);
    expect(r.alerts_now[0]!.level).toBe("warning");
    expect(r.alerts_now[0]!.tambons).toHaveLength(1);
  });
});
