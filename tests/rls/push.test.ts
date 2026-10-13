/**
 * A7, web push: who may write a subscription and who may read the addresses.
 *
 * What these tests are really guarding:
 *  - a visitor can subscribe (an alert must reach someone with no account), but only with the
 *    address of a browser maker's push service: Jaga's server will send a request to every
 *    address it holds and must not be made to call anything else;
 *  - nobody but an admin can read the addresses, and a drill hands out none;
 *  - an alert's targets are the phones following one of its tambons, and no others.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

const FCM = "https://fcm.googleapis.com/fcm/send/";
const KEYS = JSON.stringify({ p256dh: "BPublicKeyOfThisBrowser", auth: "secret16" });
const subscribe = (endpoint: string, tambons: string[], locale = "th") =>
  db.query("select push_subscribe($1, $2::jsonb, $3, $4)", [endpoint, KEYS, tambons, locale]);

async function alertFor(tambons: string[], drill = false): Promise<string> {
  await asOwner(db);
  const id = (
    await rows<{ id: string }>(
      db,
      `insert into alerts (level, reason, messages, issued_by, next_update_at, is_drill)
       values ('warning', 'River rising', '{"th": "น้ำกำลังขึ้น"}'::jsonb, $1, now() + interval '6 hours', $2)
       returning id`,
      [w.admin, drill],
    )
  )[0]!.id;
  for (const t of tambons) {
    await db.query("insert into alert_tambons (alert_id, tambon) values ($1, $2)", [id, t]);
  }
  return id;
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
  await db.query("delete from push_subscriptions");
});
afterEach(async () => {
  await db.query("rollback");
});

describe("subscribing", () => {
  it("a visitor can, and the row names nobody", async () => {
    await as(db, "anon");
    await subscribe(`${FCM}visitor`, [w.yala1, "999999"]);
    // A visitor cannot read it back, or anyone else's.
    expect(await rows(db, "select * from push_subscriptions")).toEqual([]);
    await asOwner(db);
    const saved = await rows<{ user_id: string | null; tambons: string[] }>(
      db,
      "select user_id, tambons from push_subscriptions",
    );
    // The tambon that does not exist is dropped.
    expect(saved).toEqual([{ user_id: null, tambons: [w.yala1] }]);
  });

  it("the same phone again updates its tambons instead of adding a row", async () => {
    await as(db, { uid: w.requester });
    await subscribe(`${FCM}phone`, [w.yala1]);
    await subscribe(`${FCM}phone`, [w.yala1, w.yala2], "ms");
    await asOwner(db);
    const saved = await rows<{ user_id: string; tambons: string[]; locale: string }>(
      db,
      "select user_id, tambons, locale from push_subscriptions",
    );
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ user_id: w.requester, locale: "ms" });
    expect(saved[0]!.tambons.sort()).toEqual([w.yala1, w.yala2].sort());
  });

  it("refuses an address that is not a browser maker's push service", async () => {
    await as(db, "anon");
    for (const bad of [
      "https://example.com/hook/abcdefghijklmnop",
      "http://fcm.googleapis.com/fcm/send/abcdefgh",
      "https://fcm.googleapis.com.evil.example/fcm/send/abc",
      "https://169.254.169.254/latest/meta-data/iam",
    ]) {
      await expectDenied(db, "select push_subscribe($1, $2::jsonb, $3, 'th')", [
        bad,
        KEYS,
        [w.yala1],
      ]);
    }
    for (const good of [
      "https://updates.push.services.mozilla.com/wpush/v2/abcdefgh",
      "https://web.push.apple.com/QAbcdefghijklmnop",
      "https://wns2-sg2p.notify.windows.com/w/?token=abcdefgh",
    ]) {
      await subscribe(good, [w.yala1]);
    }
  });

  it("refuses a subscription without its two keys", async () => {
    await as(db, "anon");
    await expectDenied(db, "select push_subscribe($1, $2::jsonb, $3, 'th')", [
      `${FCM}nokeys`,
      JSON.stringify({ p256dh: "x" }),
      [w.yala1],
    ]);
  });

  it("turning it off removes the row", async () => {
    await as(db, "anon");
    await subscribe(`${FCM}gone`, [w.yala1]);
    await db.query("select push_unsubscribe($1)", [`${FCM}gone`]);
    await asOwner(db);
    expect(await rows(db, "select 1 from push_subscriptions")).toEqual([]);
  });
});

describe("the addresses, at the moment an alert is published", () => {
  beforeEach(async () => {
    await as(db, "anon");
    await subscribe(`${FCM}in-yala1`, [w.yala1]);
    await subscribe(`${FCM}in-yala2`, [w.yala2]);
    await subscribe(`${FCM}both`, [w.yala1, w.yala2]);
  });

  it("go to an admin, only for phones following a tambon the alert names, and it is logged", async () => {
    const alert = await alertFor([w.yala1]);
    await as(db, { uid: w.admin });
    const got = await rows<{ endpoint: string }>(db, "select * from push_targets_for_alert($1)", [
      alert,
    ]);
    expect(got.map((r) => r.endpoint).sort()).toEqual([`${FCM}both`, `${FCM}in-yala1`]);
    await asOwner(db);
    const log = await rows(
      db,
      "select 1 from audit_log where action = 'push_targets' and entity_id = $1 and actor = $2",
      [alert, w.admin],
    );
    expect(log).toHaveLength(1);
  });

  it("a drill hands out none", async () => {
    const drill = await alertFor([w.yala1], true);
    await as(db, { uid: w.admin });
    expect(await rows(db, "select * from push_targets_for_alert($1)", [drill])).toEqual([]);
  });

  it("nobody but an admin can read them: not a visitor, a resident or a rescue team", async () => {
    const alert = await alertFor([w.yala1]);
    await as(db, "anon");
    await expectDenied(db, "select * from push_targets_for_alert($1)", [alert]);
    for (const uid of [w.requester, w.yalaRescue.user]) {
      await as(db, { uid });
      await expectDenied(db, "select * from push_targets_for_alert($1)", [alert]);
      await expectDenied(db, "select push_record_alert($1, 1, 0, '{}')", [alert]);
    }
  });

  it("the result is written beside the alert, and dead addresses are dropped", async () => {
    const alert = await alertFor([w.yala1]);
    await as(db, { uid: w.admin });
    await db.query("select push_record_alert($1, 1, 0, $2)", [alert, [`${FCM}both`]]);
    await asOwner(db);
    const sent = await rows<{ channel: string; recipients: number; status: string }>(
      db,
      "select channel, recipients, status from alert_deliveries where alert_id = $1",
      [alert],
    );
    expect(sent).toEqual([{ channel: "web_push", recipients: 1, status: "sent" }]);
    const left = await rows<{ endpoint: string }>(db, "select endpoint from push_subscriptions");
    expect(left.map((r) => r.endpoint).sort()).toEqual([`${FCM}in-yala1`, `${FCM}in-yala2`]);
  });
});
