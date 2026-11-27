/**
 * The free-plan meters (a10_plan_meters, 27 Nov 2026): the readings are numbers about Jaga's own
 * hosting, so what matters is who may write them and that the push goes to the super admin and to
 * nobody else. Nothing here touches an alert.
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

async function add(meter = "active_cpu", value = 3): Promise<string> {
  const got = await rows<{ id: string }>(
    db,
    "select public.admin_plan_add('vercel', $1, $2, '2026-12-01', 'test') as id",
    [meter, value],
  );
  return got[0]!.id;
}

async function token(): Promise<string> {
  return (await rows<{ token: string }>(db, "select token from public.push_gate limit 1"))[0]!
    .token;
}

describe("who can read and write the readings", () => {
  it("lets an admin write one down and read it back, and nobody else touch it", async () => {
    await as(db, { uid: w.admin });
    const id = await add();
    const got = await rows<{ id: string; by_me: boolean }>(
      db,
      "select * from public.admin_plan_readings(30) where id = $1",
      [id],
    );
    expect(got).toHaveLength(1);
    expect(got[0]!.by_me).toBe(true);

    for (const who of [null, w.requester, w.otherUser]) {
      await as(db, who ? { uid: who } : "anon");
      await expectDenied(db, "select * from public.plan_readings");
      await expectDenied(db, "select public.admin_plan_add('vercel', 'active_cpu', 1)");
    }
    // A signed-in person who is not an admin is shown nothing, rather than refused.
    await as(db, { uid: w.requester });
    expect(await rows(db, "select * from public.admin_plan_readings(30)")).toHaveLength(0);
  });

  it("refuses a reading from the future, an unknown service and a negative number", async () => {
    await as(db, { uid: w.admin });
    await expectDenied(
      db,
      "select public.admin_plan_add('vercel', 'active_cpu', 1, null, null, now() + interval '2 days')",
    );
    await expectDenied(db, "select public.admin_plan_add('aws', 'active_cpu', 1)");
    await expectDenied(db, "select public.admin_plan_add('vercel', 'active_cpu', -1)");
  });

  it("lets an admin remove their own reading, not another's, and the super admin any", async () => {
    await as(db, { uid: w.admin });
    const mine = await add();
    await as(db, { uid: w.superAdmin });
    const theirs = await add("transfer", 5);

    await as(db, { uid: w.admin });
    const own = await rows<{ ok: boolean }>(db, "select public.admin_plan_delete($1) ok", [mine]);
    expect(own[0]!.ok).toBe(true);
    const other = await rows<{ ok: boolean }>(db, "select public.admin_plan_delete($1) ok", [
      theirs,
    ]);
    expect(other[0]!.ok).toBe(false);

    await as(db, { uid: w.superAdmin });
    const any = await rows<{ ok: boolean }>(db, "select public.admin_plan_delete($1) ok", [theirs]);
    expect(any[0]!.ok).toBe(true);
  });

  it("keeps the database's own snapshot out of an ordinary admin's hands", async () => {
    await asOwner(db);
    await db.query("select public.plan_snapshot()");
    const snap = await rows<{ id: string }>(
      db,
      "select id from public.plan_readings where auto order by id desc limit 1",
    );
    expect(snap).toHaveLength(1);
    await as(db, { uid: w.admin });
    const gone = await rows<{ ok: boolean }>(db, "select public.admin_plan_delete($1) ok", [
      snap[0]!.id,
    ]);
    expect(gone[0]!.ok).toBe(false);
    await expectDenied(db, "select public.plan_snapshot()");
  });
});

describe("what the database says about itself", () => {
  it("answers an admin, with the size and the crons, and refuses everyone else", async () => {
    await as(db, { uid: w.admin });
    const got = await rows<{ h: { dbBytes: number; crons: unknown[]; writers: unknown[] } }>(
      db,
      "select public.admin_plan_health() h",
    );
    const h = got[0]!.h;
    expect(h.dbBytes).toBeGreaterThan(0);
    expect(Array.isArray(h.crons)).toBe(true);
    expect(Array.isArray(h.writers)).toBe(true);
    for (const who of [null, w.requester]) {
      await as(db, who ? { uid: who } : "anon");
      await expectDenied(db, "select public.admin_plan_health()");
    }
  });

  it("writes a snapshot of the size, and drops cron log older than a week", async () => {
    await asOwner(db);
    await db.query("select public.plan_snapshot()");
    const got = await rows<{ meter: string }>(
      db,
      "select meter from public.plan_readings where auto and read_at > now() - interval '1 minute'",
    );
    expect(got.map((g) => g.meter)).toContain("db_size");
    const old = await rows<{ n: number }>(
      db,
      "select count(*)::int n from cron.job_run_details where end_time < now() - interval '7 days'",
    );
    expect(old[0]!.n).toBe(0);
  });
});

describe("the push to the super admin", () => {
  const PHONE = "https://fcm.googleapis.com/super-admin-phone";
  const ADMIN_PHONE = "https://fcm.googleapis.com/plain-admin-phone";

  it("owes only the super admin's phones, once per episode, and only with the server's token", async () => {
    await asOwner(db);
    for (const [uid, endpoint] of [
      [w.superAdmin, PHONE],
      [w.admin, ADMIN_PHONE],
    ] as const) {
      await db.query(
        `insert into public.push_subscriptions (user_id, endpoint, keys, locale, tambons)
         values ($1, $2, '{"p256dh": "k", "auth": "a"}'::jsonb, 'th', '{}')`,
        [uid, endpoint],
      );
    }
    const t = await token();
    const ask = (signature: string) =>
      rows<{ endpoint: string }>(db, "select * from public.push_plan_due($1, 'vercel', $2)", [
        t,
        signature,
      ]);
    // Every super admin's phone is owed it, so count only the two this test added: on jaga-dev the
    // real ones have phones of their own.
    const mine = (await ask("active_cpu:1"))
      .map((d) => d.endpoint)
      .filter((e) => e === PHONE || e === ADMIN_PHONE);
    expect(mine).toEqual([PHONE]);
    // Told once: the same episode owes the same phone nothing, a new one owes it again.
    expect((await ask("active_cpu:1")).map((d) => d.endpoint)).not.toContain(PHONE);
    expect((await ask("active_cpu:2")).map((d) => d.endpoint)).toContain(PHONE);

    for (const who of [null, w.requester, w.admin]) {
      await as(db, who ? { uid: who } : "anon");
      await expectDenied(db, "select * from public.push_plan_due('not-the-token', 'vercel', 'x')");
      await expectDenied(db, "select * from public.push_plan_readings('not-the-token')");
    }
  });

  it("hands the readings to the server's token, and writes nothing to alerts", async () => {
    await asOwner(db);
    await add();
    const before = await rows<{ n: number }>(db, "select count(*)::int n from public.alerts");
    const got = await rows<{ meter: string }>(db, "select * from public.push_plan_readings($1)", [
      await token(),
    ]);
    expect(got.map((g) => g.meter)).toContain("active_cpu");
    const after = await rows<{ n: number }>(db, "select count(*)::int n from public.alerts");
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});
