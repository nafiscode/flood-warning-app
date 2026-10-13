/**
 * A7, web push for a request for help: what is owed, to whom, and who may ask.
 *
 * What these tests are really guarding:
 *  - only Jaga's own server, holding the gate token, can ask which phones to notify; a visitor,
 *    a resident and a rescue team cannot, and none of them can read the tables behind it;
 *  - the offer goes to the phones of the team whose turn it is, once, and says a tambon and a
 *    kind of request - never the place or the person (safety rules 5 and 6);
 *  - the sender hears each step of their own case once, and only the sender can ask to.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

const TOKEN = "test-gate-token-0123456789abcdef0123456789";
const KEYS = JSON.stringify({ p256dh: "BPublicKeyOfThisBrowser", auth: "secret16" });
const TEAM_PHONE = "https://fcm.googleapis.com/fcm/send/team-phone";
const SENDER_PHONE = "https://web.push.apple.com/sender-phone-abcdefgh";

type Due = { kind: string; endpoint: string; sos_id: string; data: Record<string, unknown> };

/** What is owed for the fixture's own case (the dev database may hold other open requests). */
async function due(): Promise<Due[]> {
  await as(db, "anon");
  const all = await rows<Due>(db, "select * from push_due($1)", [TOKEN]);
  await asOwner(db);
  return all.filter((r) => r.sos_id === w.yalaSos);
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
  // The team's phone has notifications on.
  await as(db, { uid: w.yalaRescue.user });
  await db.query("select push_subscribe($1, $2::jsonb, '{}', 'th')", [TEAM_PHONE, KEYS]);
  await asOwner(db);
});
afterEach(async () => {
  await db.query("rollback");
});

describe("who may ask what is owed", () => {
  it("nobody without the server's token, whoever they are", async () => {
    for (const caller of ["anon", { uid: w.requester }, { uid: w.yalaRescue.user }] as const) {
      await as(db, caller);
      await expectDenied(db, "select * from push_due($1)", [
        "not-the-token-not-the-token-not-the-token",
      ]);
      await expectDenied(db, "select * from push_due(null)");
      await expectDenied(db, "select push_forget($1, '{}')", ["wrong"]);
    }
  });

  it("no client can read the gate, the followers or the log", async () => {
    for (const caller of ["anon", { uid: w.requester }, { uid: w.admin }] as const) {
      await as(db, caller);
      for (const table of ["push_gate", "push_sos_followers", "push_log"]) {
        await expectDenied(db, `select * from ${table}`);
      }
    }
  });
});

describe("the offer to the team whose turn it is", () => {
  it("goes to that team's phones once, with a tambon and a kind, and nothing about the person", async () => {
    const first = (await due()).filter((r) => r.kind === "offer");
    expect(first).toHaveLength(1);
    expect(first[0]!.endpoint).toBe(TEAM_PHONE);
    expect(Object.keys(first[0]!.data).sort()).toEqual([
      "expires_at",
      "request",
      "tambon_en",
      "tambon_th",
    ]);
    expect(first[0]!.data.request).toBe("rescue");
    const text = JSON.stringify(first);
    expect(text).not.toContain("66811111111");
    expect(text).not.toContain(w.requester);
    // Asked again within the same window: already handed out.
    expect((await due()).filter((r) => r.kind === "offer")).toEqual([]);
  });

  it("a team with no phone subscribed is simply not in the list", async () => {
    await db.query("delete from push_subscriptions");
    expect(await due()).toEqual([]);
  });
});

describe("the sender hears about their own case", () => {
  const follow = (sos: string) =>
    db.query("select push_follow_sos($1, null, $2, $3::jsonb, 'th')", [sos, SENDER_PHONE, KEYS]);

  it("only the sender can ask to", async () => {
    await as(db, { uid: w.otherUser });
    await expectDenied(db, "select push_follow_sos($1, null, $2, $3::jsonb, 'th')", [
      w.yalaSos,
      SENDER_PHONE,
      KEYS,
    ]);
    await as(db, "anon");
    await expectDenied(db, "select push_follow_sos($1, $2, $3, $4::jsonb, 'th')", [
      w.yalaSos,
      "a-token-that-is-not-this-case-token",
      SENDER_PHONE,
      KEYS,
    ]);
    await as(db, { uid: w.requester });
    await expectDenied(db, "select push_follow_sos($1, null, $2, $3::jsonb, 'th')", [
      w.yalaSos,
      "https://example.com/not-a-push-service-at-all",
      KEYS,
    ]);
    await follow(w.yalaSos);
  });

  it("accepted, then on the way, each once and naming the team", async () => {
    await as(db, { uid: w.requester });
    await follow(w.yalaSos);
    await due(); // the offer, not this test's business

    await as(db, { uid: w.yalaRescue.user });
    await db.query("select * from authority_accept_sos($1)", [w.yalaSos]);
    const accepted = await due();
    expect(accepted.map((r) => [r.kind, r.endpoint])).toEqual([["accepted", SENDER_PHONE]]);
    expect(accepted[0]!.data.unit).toBe("Yala rescue");
    expect(await due()).toEqual([]);

    await as(db, { uid: w.yalaRescue.user });
    await db.query("select authority_advance_sos($1, 'en_route')", [w.yalaSos]);
    expect((await due()).map((r) => r.kind)).toEqual(["en_route"]);
    expect(await due()).toEqual([]);
  });

  it("a sender who starts listening late gets the newest step only, not a backlog", async () => {
    await due();
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select * from authority_accept_sos($1)", [w.yalaSos]);
    await db.query("select authority_advance_sos($1, 'en_route')", [w.yalaSos]);
    await as(db, { uid: w.requester });
    await follow(w.yalaSos);
    expect((await due()).map((r) => r.kind)).toEqual(["en_route"]);
  });

  it("addresses the push services call dead are dropped, with the token", async () => {
    await as(db, { uid: w.requester });
    await follow(w.yalaSos);
    await as(db, "anon");
    await db.query("select push_forget($1, $2)", [TOKEN, [SENDER_PHONE, TEAM_PHONE]]);
    await asOwner(db);
    expect(await rows(db, "select 1 from push_sos_followers")).toEqual([]);
    expect(
      await rows(db, "select 1 from push_subscriptions where endpoint = $1", [TEAM_PHONE]),
    ).toEqual([]);
  });
});
