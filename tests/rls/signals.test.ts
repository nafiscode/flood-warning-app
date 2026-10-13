/**
 * A8: the signal dashboard's read and the one thing it can change. The read is the admins'; a
 * threshold is set only by an admin, stops being provisional, and the change is logged.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;
const ZONE = "00000000-0000-4000-8000-0000000000a8";

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
    `insert into public.warning_zones (id, name, basin) values ($1, '{"en": "Test river"}'::jsonb, 'test_river')`,
    [ZONE],
  );
  await db.query(
    `insert into public.thresholds (zone_id, signal, levels, provisional) values ($1, 'rain_72h_mm', '{"watch": 100}'::jsonb, true)`,
    [ZONE],
  );
});
afterEach(async () => {
  await db.query("rollback");
});

type Answer = {
  d: { zones: { id: string; thresholds: { signal: string; provisional: boolean }[] }[] };
};

describe("admin_signals", () => {
  it("answers an admin with every zone and its thresholds", async () => {
    await as(db, { uid: w.admin });
    const got = await rows<Answer>(db, "select public.admin_signals() d");
    const zone = got[0]!.d.zones.find((z) => z.id === ZONE)!;
    expect(zone.thresholds).toEqual([
      expect.objectContaining({ signal: "rain_72h_mm", provisional: true }),
    ]);
  });

  it("is refused to a visitor and to a signed-in resident", async () => {
    await as(db, "anon");
    await expectDenied(db, "select public.admin_signals()");
    await as(db, { uid: w.requester });
    await expectDenied(db, "select public.admin_signals()");
  });

  it("no client may run the fetch", async () => {
    for (const who of [null, w.requester, w.admin]) {
      await as(db, who ? { uid: who } : "anon");
      await expectDenied(db, "select public.signals_fetch()");
    }
  });
});

describe("admin_set_threshold", () => {
  const set = "select public.admin_set_threshold($1, $2, $3::jsonb)";

  it("an admin's threshold is kept as theirs, and the change is in the log", async () => {
    await as(db, { uid: w.admin });
    await db.query(set, [ZONE, "rain_72h_mm", JSON.stringify({ watch: 140, warning: 220 })]);
    await asOwner(db);
    const t = await rows<{ levels: Record<string, number>; provisional: boolean; set_by: string }>(
      db,
      "select levels, provisional, set_by from public.thresholds where zone_id = $1 and signal = 'rain_72h_mm'",
      [ZONE],
    );
    expect(t[0]).toMatchObject({
      levels: { watch: 140, warning: 220 },
      provisional: false,
      set_by: w.admin,
    });
    const log = await rows<{ details: { from: unknown; to: unknown } }>(
      db,
      "select details from public.audit_log where action = 'threshold_set' and entity_id = $1",
      [ZONE],
    );
    expect(log).toHaveLength(1);
    expect(log[0]!.details).toMatchObject({
      from: { watch: 100 },
      to: { watch: 140, warning: 220 },
    });
  });

  it("a signal that had no threshold can be given one", async () => {
    await as(db, { uid: w.admin });
    await db.query(set, [ZONE, "key_level_m", JSON.stringify({ warning: 8.5, evacuate: 9.3 })]);
    await asOwner(db);
    expect(
      await rows(db, "select 1 from public.thresholds where zone_id = $1", [ZONE]),
    ).toHaveLength(2);
  });

  it("refuses a level that is not a number above nought, an unknown level, signal or zone", async () => {
    await as(db, { uid: w.admin });
    await expectDenied(db, set, [ZONE, "rain_72h_mm", JSON.stringify({ watch: 0 })]);
    await expectDenied(db, set, [ZONE, "rain_72h_mm", JSON.stringify({ watch: "many" })]);
    await expectDenied(db, set, [ZONE, "rain_72h_mm", JSON.stringify({ severe: 5 })]);
    await expectDenied(db, set, [ZONE, "rain_72h_mm", JSON.stringify({})]);
    await expectDenied(db, set, [ZONE, "moon_phase", JSON.stringify({ watch: 5 })]);
    await expectDenied(db, set, [
      "00000000-0000-4000-8000-00000000dead",
      "rain_72h_mm",
      JSON.stringify({ watch: 5 }),
    ]);
  });

  it("is refused to everyone who is not an admin", async () => {
    await as(db, "anon");
    await expectDenied(db, set, [ZONE, "rain_72h_mm", JSON.stringify({ watch: 1 })]);
    await as(db, { uid: w.requester });
    await expectDenied(db, set, [ZONE, "rain_72h_mm", JSON.stringify({ watch: 1 })]);
  });
});
