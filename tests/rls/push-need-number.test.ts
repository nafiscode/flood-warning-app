/**
 * "A number would help" (owner, 28 Nov 2026): the push that asks the sender of an open request for
 * a phone number. What is guarded: only Jaga's own server (the gate token) can ask who is owed it;
 * it goes to the phones that follow the request, once, five minutes after it was sent; it never
 * goes for a request that has a number, is closed, is supplies, is merged or is flagged; and a
 * request with no follower is not marked as asked, so a phone that starts following later still
 * hears it. Each test runs in a transaction that is rolled back.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

const TOKEN = "test-gate-token-0123456789abcdef0123456789";
const KEYS = JSON.stringify({ p256dh: "BPublicKeyOfThisBrowser", auth: "secret16" });
const SENDER_PHONE = "https://web.push.apple.com/sender-phone-abcdefgh";

type Due = { endpoint: string; sos_id: string; locale: string; keys: unknown };

/** What is owed for the fixture's own case (the dev database may hold other open requests). */
async function due(): Promise<Due[]> {
  await as(db, "anon");
  const all = await rows<Due>(db, "select * from push_need_number_due($1)", [TOKEN]);
  await asOwner(db);
  return all.filter((r) => r.sos_id === w.yalaSos);
}

/** The sender turns notifications on from their own case page. */
async function follow(endpoint = SENDER_PHONE) {
  await as(db, { uid: w.requester });
  await db.query("select push_follow_sos($1, null, $2, $3::jsonb, 'th')", [
    w.yalaSos,
    endpoint,
    KEYS,
  ]);
  await asOwner(db);
}

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
  // A request that went out with no number, ten minutes ago, and is not flagged.
  await db.query("delete from sos_contacts where sos_id = $1", [w.yalaSos]);
  await db.query("update sos_review set suspected_spam = false where sos_id = $1", [w.yalaSos]);
  await db.query(
    "update sos_requests set created_at = now() - interval '10 minutes' where id = $1",
    [w.yalaSos],
  );
});
afterEach(async () => {
  await db.query("rollback");
});

describe("who may ask who is owed it", () => {
  it("nobody without the server's token, whoever they are", async () => {
    for (const caller of ["anon", { uid: w.requester }, { uid: w.yalaRescue.user }] as const) {
      await as(db, caller);
      await expectDenied(db, "select * from push_need_number_due($1)", [
        "not-the-token-at-all-0000000000000000",
      ]);
      await expectDenied(db, "select * from push_need_number_due(null)");
    }
  });
});

describe("who is told, and when", () => {
  it("tells the sender's own phone once, for a request with no number", async () => {
    await follow();
    const first = await due();
    expect(first).toHaveLength(1);
    expect(first[0]!.endpoint).toBe(SENDER_PHONE);
    expect(first[0]!.locale).toBe("th");
    expect(await due()).toHaveLength(0);
  });

  it("does not ask before five minutes", async () => {
    await follow();
    await asOwner(db);
    await db.query(
      "update sos_requests set created_at = now() - interval '4 minutes' where id = $1",
      [w.yalaSos],
    );
    expect(await due()).toHaveLength(0);
    await asOwner(db);
    await db.query(
      "update sos_requests set created_at = now() - interval '6 minutes' where id = $1",
      [w.yalaSos],
    );
    expect(await due()).toHaveLength(1);
  });

  it("does not mark a request as asked while nobody follows it, so a later follower is asked", async () => {
    expect(await due()).toHaveLength(0);
    await asOwner(db);
    const log = await rows<{ n: string }>(
      db,
      "select count(*) as n from push_log where kind = 'need_number' and sos_id = $1",
      [w.yalaSos],
    );
    expect(Number(log[0]!.n)).toBe(0);
    await follow();
    expect(await due()).toHaveLength(1);
  });

  it("tells every phone that follows the same request, once", async () => {
    await follow();
    await follow("https://fcm.googleapis.com/fcm/send/second-phone");
    expect((await due()).map((r) => r.endpoint).sort()).toEqual([
      "https://fcm.googleapis.com/fcm/send/second-phone",
      SENDER_PHONE,
    ]);
    expect(await due()).toHaveLength(0);
  });
});

describe("who is not asked", () => {
  it("leaves out a request that has a number", async () => {
    await follow();
    await asOwner(db);
    await db.query("insert into sos_contacts (sos_id, contact_phone) values ($1, '66811111111')", [
      w.yalaSos,
    ]);
    expect(await due()).toHaveLength(0);
  });

  it("leaves out a closed request, supplies, a merged one and a suspected nuisance send", async () => {
    await follow();
    for (const change of [
      "status = 'rescued', closed_at = now()",
      "kind = 'supplies'",
      `duplicate_of = '${w.songkhlaSos}'`,
    ]) {
      await db.query("savepoint s");
      await asOwner(db);
      await db.query(`update sos_requests set ${change} where id = $1`, [w.yalaSos]);
      expect(await due(), change).toHaveLength(0);
      await asOwner(db);
      await db.query("rollback to savepoint s");
    }
    await asOwner(db);
    await db.query("update sos_review set suspected_spam = true where sos_id = $1", [w.yalaSos]);
    expect(await due()).toHaveLength(0);
  });

  it("is still asked when a team already holds the case: the team needs the number too", async () => {
    await follow();
    await asOwner(db);
    await db.query("insert into sos_claims (sos_id, unit_id) values ($1, $2)", [
      w.yalaSos,
      w.yalaRescue.id,
    ]);
    await db.query("update sos_requests set status = 'assigned' where id = $1", [w.yalaSos]);
    expect(await due()).toHaveLength(1);
  });
});
