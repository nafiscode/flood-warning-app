/**
 * A team that registers is told to the admins' phones once (owner, 24 Oct 2026).
 *
 * What these tests guard:
 *  - only Jaga's own server, holding the gate token, can ask for the admins' addresses;
 *  - it hands them out once per unit, and only while the unit is still waiting;
 *  - they are the admins' addresses and nobody else's - not the team's, not a resident's;
 *  - what comes back names the team and carries no person or number.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

const TOKEN = "test-gate-token-0123456789abcdef0123456789";
const KEYS = JSON.stringify({ p256dh: "BPublicKeyOfThisBrowser", auth: "secret16" });
const ADMIN_PHONE = "https://fcm.googleapis.com/fcm/send/admin-phone";
const TEAM_PHONE = "https://fcm.googleapis.com/fcm/send/team-phone";
const RESIDENT_PHONE = "https://fcm.googleapis.com/fcm/send/resident-phone";

type Row = { endpoint: string; locale: string; unit_name: string };

const ask = async (unit: string, token = TOKEN) => {
  await as(db, "anon");
  const got = await rows<Row>(db, "select * from push_unit_waiting($1, $2)", [token, unit]);
  await asOwner(db);
  return got;
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
  await db.query(
    `insert into push_gate (id, token) values (true, $1)
     on conflict (id) do update set token = excluded.token`,
    [TOKEN],
  );
  for (const [uid, endpoint] of [
    [w.admin, ADMIN_PHONE],
    [w.yalaPending.user, TEAM_PHONE],
    [w.requester, RESIDENT_PHONE],
  ] as const) {
    await as(db, { uid });
    await db.query("select push_subscribe($1, $2::jsonb, '{}', 'th')", [endpoint, KEYS]);
  }
  await asOwner(db);
});
afterEach(async () => {
  await db.query("rollback");
});

describe("a team waiting to be verified", () => {
  it("is told to the admins' phones only, and names the team", async () => {
    const got = await ask(w.yalaPending.id);
    const ends = got.map((r) => r.endpoint);
    // (jaga-dev holds the real admins' phones too, so look for the test's own.)
    expect(ends).toContain(ADMIN_PHONE);
    expect(ends).not.toContain(TEAM_PHONE);
    expect(ends).not.toContain(RESIDENT_PHONE);
    expect(got.every((r) => r.unit_name === "Yala pending")).toBe(true);
    // Nothing else comes back: no person, no number, no place.
    expect(Object.keys(got[0]!).sort()).toEqual(["endpoint", "keys", "locale", "unit_name"]);
  });

  it("is told once, however many times it is asked", async () => {
    expect((await ask(w.yalaPending.id)).map((r) => r.endpoint)).toContain(ADMIN_PHONE);
    expect(await ask(w.yalaPending.id)).toHaveLength(0);
    expect(await ask(w.yalaPending.id)).toHaveLength(0);
  });

  it("is not told for a team that is already verified", async () => {
    expect(await ask(w.yalaRescue.id)).toHaveLength(0);
  });

  it("is not told again if the team is turned down and registers nothing new", async () => {
    await ask(w.yalaPending.id);
    await asOwner(db);
    await db.query("update authority_units set status = 'rejected' where id = $1", [
      w.yalaPending.id,
    ]);
    expect(await ask(w.yalaPending.id)).toHaveLength(0);
  });
});

describe("who may ask", () => {
  it("nobody without the server's token, whoever they are", async () => {
    for (const caller of [
      "anon",
      { uid: w.requester },
      { uid: w.yalaPending.user },
      { uid: w.admin },
    ] as const) {
      await as(db, caller);
      expect(
        await expectDenied(db, "select * from push_unit_waiting($1, $2)", [
          "not-the-token-not-the-token-not-the-token",
          w.yalaPending.id,
        ]),
      ).toBe("42501");
      await expectDenied(db, "select * from push_unit_waiting(null, $1)", [w.yalaPending.id]);
    }
  });

  it("asking with a wrong token does not use up the notification", async () => {
    await as(db, "anon");
    await expectDenied(db, "select * from push_unit_waiting($1, $2)", ["wrong", w.yalaPending.id]);
    await asOwner(db);
    expect((await ask(w.yalaPending.id)).map((r) => r.endpoint)).toContain(ADMIN_PHONE);
  });
});
