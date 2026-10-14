/**
 * The usage counter (the owner, 14 Oct): a phone's notes are only taken in the narrow forms the
 * two writing functions accept, nobody but an admin reads anything back, and an admin reads
 * counts, never a phone's own row.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;
const TOKEN = "usage-test-gate-token-0123456789abcdef0123";
const INSTALL = "00000000-0000-4000-8000-00000000d001";
const SESSION = "00000000-0000-4000-8000-00000000e001";
const TAMBON = "940101";

const hit = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    install: INSTALL,
    session: SESSION,
    path: "/th/sos/0f8b1c2d-1111-4222-8333-444455556666?x=1",
    device: "phone",
    os: "Android",
    osMajor: 13,
    browser: "Chrome",
    installed: true,
    push: false,
    signedIn: false,
    locale: "th",
    tambon: TAMBON,
    areaFrom: "list",
    watched: 2,
    country: "TH",
    city: "Pattani",
    lat: 6.8689,
    lon: 101.2501,
    memory: 2,
    net: "3g",
    screen: 360,
    fcp: 1400,
    ready: 2100,
    ...extra,
  });

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
});
afterEach(async () => {
  await db.query("rollback");
});

type Opened = { ok: boolean };

describe("usage_path", () => {
  it("drops the language, ids and the query", async () => {
    const got = await rows<{ a: string; b: string; c: string; d: string }>(
      db,
      `select public.usage_path('/th/sos/0f8b1c2d-1111-4222-8333-444455556666?x=1') a,
              public.usage_path('/en') b,
              public.usage_path('/account/places/42/edit') c,
              public.usage_path('/safe-places') d`,
    );
    expect(got[0]).toEqual({
      a: "/sos/:id",
      b: "/",
      c: "/account/places/:id/edit",
      d: "/safe-places",
    });
  });
});

describe("usage_open", () => {
  it("records a phone only with Jaga's server's token", async () => {
    await as(db, "anon");
    const wrong = await rows<Opened>(db, "select public.usage_open('nope', $1::jsonb) ok", [hit()]);
    expect(wrong[0]!.ok).toBe(false);
    const right = await rows<Opened>(db, "select public.usage_open($1, $2::jsonb) ok", [
      TOKEN,
      hit(),
    ]);
    expect(right[0]!.ok).toBe(true);
    await asOwner(db);
    const d = await rows<{ tambon: string; ip_lat: string; opens: number; city: string }>(
      db,
      "select tambon, ip_lat::text, opens, city from usage_devices where install_id = $1",
      [INSTALL],
    );
    // The rough place is cut to a tenth of a degree before it is kept.
    expect(d[0]).toEqual({ tambon: TAMBON, ip_lat: "6.9", opens: 1, city: "Pattani" });
    const s = await rows<{ entry: string }>(
      db,
      "select entry from usage_sessions where session_id = $1",
      [SESSION],
    );
    expect(s[0]!.entry).toBe("/sos/:id");
  });

  it("takes nothing it cannot read, and never raises", async () => {
    await as(db, "anon");
    for (const bad of [hit({ install: "not-a-uuid" }), hit({ lat: "north" }), "{}"]) {
      const got = await rows<Opened>(db, "select public.usage_open($1, $2::jsonb) ok", [
        TOKEN,
        bad,
      ]);
      expect(got[0]!.ok).toBe(false);
    }
  });
});

describe("usage_ping", () => {
  it("adds only to a session that was opened, and not faster than allowed", async () => {
    await as(db, "anon");
    const stranger = await rows<Opened>(
      db,
      "select public.usage_ping('00000000-0000-4000-8000-00000000ffff', 'view', '/map') ok",
    );
    expect(stranger[0]!.ok).toBe(false);
    await db.query("select public.usage_open($1, $2::jsonb)", [TOKEN, hit()]);
    // Straight after the open: too soon for another view or a beat.
    const soon = await rows<Opened>(db, "select public.usage_ping($1, 'view', '/map') ok", [
      SESSION,
    ]);
    expect(soon[0]!.ok).toBe(false);
    await asOwner(db);
    await db.query(
      "update usage_sessions set last_at = now() - interval '2 minutes' where session_id = $1",
      [SESSION],
    );
    await as(db, "anon");
    const view = await rows<Opened>(db, "select public.usage_ping($1, 'view', '/en/map') ok", [
      SESSION,
    ]);
    expect(view[0]!.ok).toBe(true);
    const odd = await rows<Opened>(db, "select public.usage_ping($1, 'delete', '/') ok", [SESSION]);
    expect(odd[0]!.ok).toBe(false);
    await asOwner(db);
    const s = await rows<{ path: string; views: number }>(
      db,
      "select path, views from usage_sessions where session_id = $1",
      [SESSION],
    );
    expect(s[0]).toEqual({ path: "/map", views: 2 });
  });
});

describe("reading", () => {
  it("no client reads the tables, and no client runs the roll-up", async () => {
    for (const who of ["anon", { uid: w.requester }, { uid: w.admin }] as const) {
      await as(db, who);
      for (const table of ["usage_devices", "usage_sessions", "usage_views", "usage_daily"]) {
        await expectDenied(db, `select * from ${table}`);
      }
      await expectDenied(db, "select public.usage_rollup()");
    }
  });

  it("admin_usage answers an admin with counts, and refuses everyone else", async () => {
    await as(db, "anon");
    await db.query("select public.usage_open($1, $2::jsonb)", [TOKEN, hit()]);
    await expectDenied(db, "select public.admin_usage(7)");
    await as(db, { uid: w.requester });
    await expectDenied(db, "select public.admin_usage(7)");
    await as(db, { uid: w.admin });
    const got = await rows<{ d: Record<string, unknown> }>(db, "select public.admin_usage(7) d");
    const d = got[0]!.d as {
      now: { live: number; tambons: { code: string; n: number }[] };
      today: { devices: number };
    };
    expect(d.now.live).toBeGreaterThanOrEqual(1);
    expect(d.now.tambons).toContainEqual(expect.objectContaining({ code: TAMBON }));
    expect(d.today.devices).toBeGreaterThanOrEqual(1);
    // Nothing that names one phone comes back.
    expect(JSON.stringify(d)).not.toContain(INSTALL);
    expect(JSON.stringify(d)).not.toContain(SESSION);
  });
});

describe("usage_rollup", () => {
  it("counts a finished day and lets the raw rows go after the keeping time", async () => {
    await as(db, "anon");
    await db.query("select public.usage_open($1, $2::jsonb)", [TOKEN, hit()]);
    await asOwner(db);
    await db.query(
      `update usage_sessions set started_at = now() - interval '2 days', last_at = now() - interval '2 days' + interval '10 minutes'
       where session_id = $1`,
      [SESSION],
    );
    await db.query("select public.usage_rollup()");
    const day = await rows<{ sessions: number; by_device: Record<string, number> }>(
      db,
      `select sessions, by_device from usage_daily
       where day = ((now() - interval '2 days') at time zone 'Asia/Bangkok')::date`,
    );
    expect(day[0]!.sessions).toBeGreaterThanOrEqual(1);
    expect(day[0]!.by_device.phone).toBeGreaterThanOrEqual(1);

    await db.query(
      `update usage_sessions set started_at = now() - interval '100 days', last_at = now() - interval '100 days' where session_id = $1`,
      [SESSION],
    );
    await db.query(
      "update usage_devices set last_seen = now() - interval '100 days' where install_id = $1",
      [INSTALL],
    );
    await db.query("select public.usage_rollup()");
    const left = await rows<{ n: number }>(
      db,
      "select count(*)::int n from usage_devices where install_id = $1",
      [INSTALL],
    );
    expect(left[0]!.n).toBe(0);
  });
});
