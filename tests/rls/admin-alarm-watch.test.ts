/**
 * A8: admins see what the automatic alarm did, and choose whether every alert reaches their bell
 * (owner, 15 Oct 2026).
 *
 * What these tests guard:
 *  - the automatic alarms' history and the admin bell feed are for admins only;
 *  - the tick is each admin's own, off by default;
 *  - off: the feed adds no alerts; on: every real alert, anywhere, and never a drill.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

type Feed = {
  allAlerts: boolean;
  autoAlarms: { id: string; status: string }[];
  alerts: { id: string }[];
};

const feed = async (uid: string): Promise<Feed> => {
  await as(db, { uid });
  const out = (await rows<{ f: Feed }>(db, "select admin_notice_feed() as f"))[0]!.f;
  await asOwner(db);
  return out;
};

async function alert(drill: boolean): Promise<string> {
  const id = (
    await rows<{ id: string }>(
      db,
      `insert into alerts (level, reason, messages, issued_by, next_update_at, is_drill)
       values ('warning', 'River rising', '{"th": "น้ำกำลังขึ้น"}'::jsonb, $1, now() + interval '6 hours', $2)
       returning id`,
      [w.admin, drill],
    )
  )[0]!.id;
  await db.query("insert into alert_tambons (alert_id, tambon) values ($1, $2)", [id, w.songkhla]);
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
  await db.query("delete from alerts");
  await db.query("delete from auto_alarm_events");
});
afterEach(async () => {
  await db.query("rollback");
});

describe("the automatic alarms and the admin's bell", () => {
  it("are for admins only", async () => {
    for (const caller of ["anon", { uid: w.requester }, { uid: w.yalaRescue.user }] as const) {
      await as(db, caller);
      await expectDenied(db, "select admin_auto_alarms(30)", []);
      await expectDenied(db, "select admin_notice_feed()", []);
      await expectDenied(db, "select admin_set_all_alerts(true)", []);
    }
  });

  it("an admin sees every automatic alarm with what became of it", async () => {
    const zone = (await rows<{ id: string }>(db, "select id from warning_zones limit 1"))[0]!.id;
    await db.query(
      `insert into auto_alarm_events (zone_id, level, value, threshold, observed_at, deadline, status)
       values ($1, 'warning', 16.2, 16.0, now(), now() + interval '20 minutes', 'pending'),
              ($1, 'evacuate', 16.8, 16.5, now() - interval '2 days', now() - interval '2 days', 'lapsed')`,
      [zone],
    );
    await as(db, { uid: w.admin });
    const list = (
      await rows<{ a: { status: string; zone: string }[] }>(db, "select admin_auto_alarms(30) as a")
    )[0]!.a;
    expect(list.map((a) => a.status)).toEqual(["pending", "lapsed"]);
    expect(list[0]!.zone).toBeTruthy();
    await asOwner(db);
    expect((await feed(w.admin)).autoAlarms).toHaveLength(2);
  });

  it("the tick is each admin's own: off adds no alerts, on adds every real alert and never a drill", async () => {
    const real = await alert(false);
    await alert(true);
    const before = await feed(w.admin);
    expect(before.allAlerts).toBe(false);
    expect(before.alerts).toEqual([]);

    await as(db, { uid: w.admin });
    await db.query("select admin_set_all_alerts(true)");
    await asOwner(db);
    const after = await feed(w.admin);
    expect(after.allAlerts).toBe(true);
    expect(after.alerts.map((a) => a.id)).toEqual([real]);
    // Another admin's bell is unchanged.
    expect((await feed(w.superAdmin)).allAlerts).toBe(false);
    // And the change is in the access log.
    const logged = await rows(
      db,
      "select 1 from audit_log where action = 'admin_all_alerts' and actor = $1",
      [w.admin],
    );
    expect(logged).toHaveLength(1);
  });
});
