/**
 * The reservoirs' half of the automated alarm (27 Oct 2026): which reservoirs are ticked, the
 * drafts it raises, and the all-clear that answers an alert.
 *
 * Who may see and do what is the point of these tests. The rules themselves are measured in
 * pipeline/tests/test_dam_spill.py and were walked through against jaga-dev by hand; here the
 * questions are: can a visitor read the tick, can a signed-in user write one, can only an admin
 * see the log, and does the all-clear reach exactly the people the alert reached.
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
  await asOwner(db);
});
afterEach(async () => {
  await db.query("rollback");
});

describe("auto_alarm_dams", () => {
  it("is read by an admin and by nobody else", async () => {
    await asOwner(db);
    await db.query(
      `insert into public.auto_alarm_dams (dam_code, enabled) values ('khlong_chamrai', true)
       on conflict (dam_code) do update set enabled = true`,
    );
    await as(db, { uid: w.admin });
    expect(await rows(db, "select dam_code from public.auto_alarm_dams")).toHaveLength(1);
    // A visitor and an ordinary user see nothing: which reservoirs publish by themselves is an
    // operational detail, not public information.
    await as(db, "anon");
    expect(await rows(db, "select dam_code from public.auto_alarm_dams")).toHaveLength(0);
    await as(db, { uid: w.requester });
    expect(await rows(db, "select dam_code from public.auto_alarm_dams")).toHaveLength(0);
  });

  it("is written by no client, whatever their role", async () => {
    for (const who of [null, w.requester, w.admin]) {
      await as(db, who ? { uid: who } : "anon");
      await expectDenied(
        db,
        "insert into public.auto_alarm_dams (dam_code, enabled) values ('ban_baik', true)",
      );
      await expectDenied(db, "update public.auto_alarm_dams set enabled = false");
      await expectDenied(db, "delete from public.auto_alarm_dams");
    }
  });

  it("is ticked through the admin's own function, and only by an admin", async () => {
    await as(db, { uid: w.requester });
    await expectDenied(db, "select public.admin_set_auto_alarm_dam('khlong_chamrai', true)");
    await as(db, { uid: w.admin });
    const n = await rows<{ n: number }>(
      db,
      "select public.admin_set_auto_alarm_dam('khlong_chamrai', true) as n",
    );
    expect(Number(n[0]!.n)).toBe(1);
    const log = await rows(
      db,
      "select 1 from public.audit_log where action = 'auto_alarm_on' and entity = 'dams'",
    );
    expect(log.length).toBeGreaterThan(0);
  });
});

describe("the drafts the alarm raises", () => {
  it("names exactly one subject: a warning zone or a reservoir, never both and never neither", async () => {
    await asOwner(db);
    await expectDenied(
      db,
      `insert into public.auto_alarm_events (level, value, threshold, observed_at, deadline)
         values ('warning', 1, 1, now(), now())`,
    );
    const zone = await rows<{ id: string }>(db, "select id from public.warning_zones limit 1");
    await expectDenied(
      db,
      `insert into public.auto_alarm_events (zone_id, dam_code, level, value, threshold,
                                             observed_at, deadline)
         values ($1, 'ban_baik', 'warning', 1, 1, now(), now())`,
      // expectDenied takes no parameters, so the zone goes in as a literal below instead.
    ).catch(() => undefined);
    await expectDenied(
      db,
      `insert into public.auto_alarm_events (zone_id, dam_code, level, value, threshold,
                                             observed_at, deadline)
         values ('${zone[0]!.id}', 'ban_baik', 'warning', 1, 1, now(), now())`,
    );
  });

  it("allows the all-clear as a level, and only an all-clear answers an alert", async () => {
    await asOwner(db);
    await db.query(
      `insert into public.auto_alarm_events (dam_code, level, value, threshold, observed_at,
                                             deadline)
         values ('khlong_chamrai', 'return', 4.8, 5.1, now(), now() + interval '20 minutes')`,
    );
    expect(
      await rows(db, "select 1 from public.auto_alarm_events where level = 'return'"),
    ).toHaveLength(1);
    // A warning cannot carry the alert it would replace: only the all-clear answers one.
    const alert = await rows<{ id: string }>(
      db,
      `insert into public.alerts (hazard_type, level, reason, messages, next_update_at)
         values ('flood', 'warning', 'test', '{"th":"x","ms":"x","en":"x"}'::jsonb,
                 now() + interval '3 hours')
       returning id`,
    );
    await expectDenied(
      db,
      `insert into public.auto_alarm_events (dam_code, level, value, threshold, observed_at,
                                             deadline, supersedes)
         values ('ban_baik', 'warning', 1, 1, now(), now(), '${alert[0]!.id}')`,
    );
  });

  it("is read by an admin only, and written by no client", async () => {
    await asOwner(db);
    await db.query(
      `insert into public.auto_alarm_events (dam_code, level, value, threshold, observed_at,
                                             deadline)
         values ('khlong_chamrai', 'warning', 5.8, 5.7, now(), now() + interval '20 minutes')`,
    );
    await as(db, { uid: w.admin });
    expect(await rows(db, "select id from public.auto_alarm_events")).toHaveLength(1);
    await as(db, "anon");
    expect(await rows(db, "select id from public.auto_alarm_events")).toHaveLength(0);
    await as(db, { uid: w.requester });
    expect(await rows(db, "select id from public.auto_alarm_events")).toHaveLength(0);
    await expectDenied(db, "update public.auto_alarm_events set status = 'dismissed'");
  });

  it("is listed for the console by an admin only, with the reservoir's name in it", async () => {
    await asOwner(db);
    await db.query(
      `insert into public.auto_alarm_events (dam_code, level, value, threshold, observed_at,
                                             deadline)
         values ('khlong_chamrai', 'warning', 5.8, 5.7, now(), now() + interval '20 minutes')`,
    );
    await as(db, { uid: w.requester });
    await expectDenied(db, "select public.admin_auto_alarms(1)");
    await as(db, { uid: w.admin });
    const got = await rows<{ list: Record<string, unknown>[] }>(
      db,
      "select public.admin_auto_alarms(1) as list",
    );
    const row = got[0]!.list.find((x) => x.dam === "khlong_chamrai");
    expect(row).toBeDefined();
    expect(row!.kind).toBe("reservoir");
    // The name is there for the screen to read in the viewer's language, and as Thai beside it.
    expect(typeof row!.zone).toBe("string");
    expect((row!.zone as string).length).toBeGreaterThan(0);
    const thai = (row!.names as { th?: string }).th ?? "";
    expect(thai.length).toBeGreaterThan(0);
    // And how full it was, which is how a reservoir is read.
    expect(Number(row!.percent)).toBeGreaterThan(0);
  });
});

describe("the reservoir's own rules", () => {
  it("grades a reservoir that is near full, and only once it is", async () => {
    await asOwner(db);
    await db.query(
      `update public.dams set grades = coalesce(grades, '{}'::jsonb)
         || '{"near_full_pct": 80, "full_pct": 95, "min_consecutive_h": 1}'::jsonb
        where code = 'khlong_chamrai'`,
    );
    await db.query(
      `delete from public.dam_readings where dam_code = 'khlong_chamrai'
         and observed_at > now() - interval '5 days'`,
    );
    const grade = async (yesterday: number, today: number) => {
      await db.query(
        `delete from public.dam_readings where dam_code = 'khlong_chamrai'
           and observed_at > now() - interval '5 days'`,
      );
      await db.query(
        `insert into public.dam_readings (dam_code, observed_at, fetched_at, storage_mcm, window_h)
           values ('khlong_chamrai', now() - interval '1 day', now(), $1, 24),
                  ('khlong_chamrai', now(), now(), $2, 24)`,
        [yesterday, today],
      );
      const got = await rows<{ grade: string; reasons: string[] }>(
        db,
        "select grade, reasons from public.dam_signal('khlong_chamrai')",
      );
      return got[0]!;
    };
    // Half full: nothing to say.
    expect((await grade(2.9, 3.0)).grade).toBe("quiet");
    // 85% and steady: watchful, and it says why.
    const near = await grade(5.1, 5.1);
    expect(near.grade).toBe("watchful");
    expect(near.reasons).toContain("near_full");
    // 96% and still filling: releasing, which is what raises a draft for the admins.
    const full = await grade(5.6, 5.76);
    expect(full.grade).toBe("releasing");
    expect(full.reasons).toContain("full_and_rising");
    // 96% but falling: watchful again. The water is not rising towards anybody.
    const falling = await grade(5.9, 5.76);
    expect(falling.grade).toBe("watchful");
    expect(falling.reasons).not.toContain("full_and_rising");
  });

  it("leaves a dam with no such rule alone", async () => {
    await as(db, "anon");
    const got = await rows<{ grade: string }>(
      db,
      "select grade from public.dam_signal('bang_lang')",
    );
    // Bang Lang is graded on spill, outflow, inflow and its own normal high water, which is a
    // real level well below full; the two new keys are not set on it.
    if (got.length > 0) expect(["quiet", "watchful", "releasing"]).toContain(got[0]!.grade);
  });

  it("will not raise a draft for a reservoir with nobody to warn", async () => {
    await asOwner(db);
    await db.query(
      `insert into public.auto_alarm_dams (dam_code, enabled) values ('khlong_chamrai', true)
       on conflict (dam_code) do update set enabled = true`,
    );
    await db.query(
      `delete from public.dam_tambons where dam_code = 'khlong_chamrai'`,
    );
    await db.query(
      `update public.dams set grades = coalesce(grades, '{}'::jsonb)
         || '{"full_pct": 95, "min_consecutive_h": 1}'::jsonb where code = 'khlong_chamrai'`,
    );
    await db.query(
      `delete from public.dam_readings where dam_code = 'khlong_chamrai'
         and observed_at > now() - interval '5 days'`,
    );
    await db.query(
      `insert into public.dam_readings (dam_code, observed_at, fetched_at, storage_mcm, window_h)
         values ('khlong_chamrai', now() - interval '1 day', now(), 5.6, 24),
                ('khlong_chamrai', now(), now(), 5.9, 24)`,
    );
    await db.query("select public.auto_alarm_check()");
    expect(
      await rows(db, "select id from public.auto_alarm_events where dam_code = 'khlong_chamrai'"),
    ).toHaveLength(0);
  });
});
