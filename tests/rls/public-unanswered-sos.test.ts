/**
 * The public "no team has taken it yet" signal (owner, 27 Nov 2026). What is guarded: anyone may
 * ask, and what comes back is one row per tambon with a count and a rounded waiting time and
 * nothing else - no point, no phone, no sender, no case (safety rules 5 and 6) - and only for
 * cases that really are waiting: open, a rescue, no unit holding it, not a suspected nuisance
 * send, not past 72 hours. Each test runs in a transaction that is rolled back.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { as, asOwner, connect, rows } from "./db";
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
  // The fixture's cases are flagged as suspected nuisance sends; these tests start from a real one.
  await db.query("update sos_review set suspected_spam = false where sos_id = $1", [w.yalaSos]);
});
afterEach(async () => {
  await db.query("rollback");
});

type Row = {
  tambon: string;
  province_code: string;
  name_th: string;
  cases: number;
  waiting_minutes: number;
};

type Caller = "anon" | { uid: string };

const read = async (caller: Caller = "anon") => {
  await as(db, caller);
  return rows<Row>(db, "select * from public_unanswered_sos()");
};
const yala = async (caller: Caller = "anon") =>
  (await read(caller)).find((r) => r.tambon === w.yala1);

describe("what the public may see", () => {
  it("is open to a visitor and to a signed-in user, and says only the tambon", async () => {
    for (const caller of ["anon", { uid: w.requester }] as const) {
      const r = await yala(caller);
      expect(r, String(caller)).toBeDefined();
      expect(Object.keys(r!).sort()).toEqual(
        [
          "cases",
          "district_th",
          "name_en",
          "name_th",
          "province_code",
          "province_th",
          "tambon",
          "waiting_minutes",
        ].sort(),
      );
      expect(r!.cases).toBeGreaterThanOrEqual(1);
    }
  });

  it("counts cases per tambon and rounds the wait down to ten minutes", async () => {
    await asOwner(db);
    await db.query(
      "update sos_requests set created_at = now() - interval '47 minutes' where id = $1",
      [w.yalaSos],
    );
    const r = await yala();
    expect(r!.waiting_minutes).toBeLessThanOrEqual(40);
    expect(r!.waiting_minutes % 10).toBe(0);
  });
});

describe("which cases are waiting", () => {
  it("leaves out a suspected nuisance send, until an admin clears the flag", async () => {
    await asOwner(db);
    await db.query("update sos_review set suspected_spam = true where sos_id = $1", [w.yalaSos]);
    expect(await yala()).toBeUndefined();
    await asOwner(db);
    await db.query("update sos_review set spam_dismissed_at = now() where sos_id = $1", [
      w.yalaSos,
    ]);
    expect(await yala()).toBeDefined();
  });

  it("leaves out a case a unit holds, and brings it back when the unit lets go", async () => {
    await asOwner(db);
    await db.query("insert into sos_claims (sos_id, unit_id) values ($1, $2)", [
      w.yalaSos,
      w.yalaRescue.id,
    ]);
    await db.query("update sos_requests set status = 'assigned' where id = $1", [w.yalaSos]);
    expect(await yala()).toBeUndefined();
    await asOwner(db);
    await db.query("update sos_claims set released_at = now() where sos_id = $1", [w.yalaSos]);
    await db.query("update sos_requests set status = 'received' where id = $1", [w.yalaSos]);
    expect(await yala()).toBeDefined();
  });

  it("leaves out a closed case, a request for supplies and a case merged into another", async () => {
    for (const change of [
      "status = 'rescued', closed_at = now()",
      "kind = 'supplies'",
      `duplicate_of = '${w.songkhlaSos}'`,
    ]) {
      await db.query("savepoint s");
      await asOwner(db);
      await db.query(`update sos_requests set ${change} where id = $1`, [w.yalaSos]);
      expect(await yala(), change).toBeUndefined();
      await db.query("rollback to savepoint s");
    }
  });

  it("leaves out a case nobody has heard from in 72 hours, but not one still being re-sent", async () => {
    await asOwner(db);
    await db.query(
      "update sos_requests set created_at = now() - interval '80 hours' where id = $1",
      [w.yalaSos],
    );
    expect(await yala()).toBeUndefined();
    await asOwner(db);
    await db.query("insert into sos_events (sos_id, event) values ($1, 'merged_update')", [
      w.yalaSos,
    ]);
    expect(await yala()).toBeDefined();
  });
});
