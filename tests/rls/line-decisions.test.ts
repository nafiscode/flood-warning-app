/**
 * A7: an admin's decision reaches the person waiting for it in LINE (owner, 15 Oct 2026), and a
 * flood report's decision reaches the bell.
 *
 * What these tests guard:
 *  - only Jaga's server (the push gate token) can ask what is owed;
 *  - each decision is handed out once, to the account it concerns and nobody else;
 *  - someone without LINE, or who blocked the account, is skipped and not asked about again;
 *  - a person reads the decisions on their own flood reports only.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

const TOKEN = "test-gate-token-0123456789abcdef0123456789";
const TEAM = `U${"c".repeat(32)}`;
const REPORTER = `U${"d".repeat(32)}`;

type Due = { kind: string; line_user_id: string; ref: string; data: Record<string, string> };

const due = async (): Promise<Due[]> => {
  await as(db, "anon");
  const got = await rows<Due>(db, "select * from line_decisions_due($1)", [TOKEN]);
  await asOwner(db);
  return got;
};

const reportOf = async (user: string) =>
  (await rows<{ id: string }>(db, "select id from reports where reporter_id = $1", [user]))[0]!.id;

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
  await db.query(
    `insert into push_gate (id, token) values (true, $1)
     on conflict (id) do update set token = excluded.token`,
    [TOKEN],
  );
  await db.query("update profiles set line_user_id = null");
  await db.query("delete from line_follows");
  await db.query("update profiles set line_user_id = $2 where user_id = $1", [
    w.yalaPending.user,
    TEAM,
  ]);
  await db.query("update profiles set line_user_id = $2 where user_id = $1", [
    w.otherUser,
    REPORTER,
  ]);
  // Whatever the dev database still owes from real use is handed out before each test.
  await due();
});
afterEach(async () => {
  await db.query("rollback");
});

describe("an admin's decision reaches LINE", () => {
  it("only Jaga's server can ask what is owed", async () => {
    for (const caller of ["anon", { uid: w.requester }, { uid: w.admin }] as const) {
      await as(db, caller);
      await expectDenied(db, "select * from line_decisions_due($1)", ["wrong-token"]);
    }
  });

  it("a verified team hears it once, by its name, and nobody else does", async () => {
    await as(db, { uid: w.admin });
    await db.query("select verify_authority_unit($1, true)", [w.yalaPending.id]);
    const first = await due();
    expect(first.map((r) => [r.kind, r.line_user_id, r.ref])).toEqual([
      ["unit_verified", TEAM, w.yalaPending.id],
    ]);
    expect(first[0]!.data).toEqual({ unit: "Yala pending" });
    expect(await due()).toEqual([]);

    await as(db, { uid: w.admin });
    await db.query("select suspend_authority_unit($1, 'test')", [w.yalaPending.id]);
    expect((await due()).map((r) => r.kind)).toEqual(["unit_suspended"]);
  });

  it("a reporter hears that their report was hidden, with the tambon and no more", async () => {
    const report = await reportOf(w.otherUser);
    await as(db, { uid: w.admin });
    await db.query("select admin_moderate_report($1, 'hidden')", [report]);
    const told = await due();
    expect(told.map((r) => [r.kind, r.line_user_id, r.ref])).toEqual([
      ["report_hidden", REPORTER, report],
    ]);
    expect(Object.keys(told[0]!.data).sort()).toEqual(["tambon_en", "tambon_th"]);
  });

  it("someone without LINE, or who blocked it, is skipped and not asked about again", async () => {
    await db.query("insert into line_follows (line_user_id, following) values ($1, false)", [TEAM]);
    await as(db, { uid: w.admin });
    await db.query("select verify_authority_unit($1, true)", [w.yalaPending.id]);
    expect(await due()).toEqual([]);
    await db.query("delete from line_follows");
    // Unblocking later does not bring back an old decision.
    expect(await due()).toEqual([]);
  });
});

describe("the bell hears of a report's decision", () => {
  it("the reporter reads the decision on their own report; nobody else does", async () => {
    const report = await reportOf(w.otherUser);
    await as(db, { uid: w.admin });
    await db.query("select admin_moderate_report($1, 'approved')", [report]);

    await as(db, { uid: w.otherUser });
    const mine = await rows<{ report_id: string; status: string }>(
      db,
      "select * from my_report_decisions()",
    );
    expect(mine.map((r) => [r.report_id, r.status])).toEqual([[report, "approved"]]);

    await as(db, { uid: w.requester });
    expect(await rows(db, "select * from my_report_decisions()")).toEqual([]);

    await as(db, "anon");
    await expectDenied(db, "select * from my_report_decisions()", []);
  });
});
