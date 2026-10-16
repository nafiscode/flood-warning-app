/**
 * The coastal gate's reference (science plan Module 10, 16 Oct 2026): written by the pipeline's
 * seed, read by admins only, written by no client. A mouth with no warning zone keeps its row.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;
const ZONE = "00000000-0000-4000-8000-0000000000c0";

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
    `insert into public.warning_zones (id, name, basin)
     values ($1, '{"en": "Test river"}'::jsonb, 'test_gate_river')`,
    [ZONE],
  );
  await db.query(
    `insert into public.coastal_gate_reference
       (id, zone_id, name, lat, lon, llw_p50, llw_p90, llw_p98, season_days, method)
     values ('test_mouth', $1, '{"en": "Test mouth"}'::jsonb, 6.5, 101.9, 0.68, 0.89, 1.03, 450,
             '{"source": "test"}'::jsonb),
            ('test_orphan', null, '{"en": "Mouth with no zone"}'::jsonb, 6.44, 101.84,
             0.68, 0.89, 1.03, 450, '{"source": "test"}'::jsonb)`,
    [ZONE],
  );
});
afterEach(async () => {
  await db.query("rollback");
});

describe("the coastal gate reference", () => {
  it("only admins read it, through the table or the function", async () => {
    await as(db, "anon");
    await expectDenied(db, "select 1 from public.coastal_gate_reference");
    await expectDenied(db, "select 1 from public.admin_coastal_gate()");
    await as(db, { uid: w.requester });
    expect(await rows(db, "select 1 from public.coastal_gate_reference")).toHaveLength(0);
    expect(await rows(db, "select 1 from public.admin_coastal_gate()")).toHaveLength(0);
    await as(db, { uid: w.admin });
    const [row] = await rows<{ llw_p90: number; basin: string }>(
      db,
      "select llw_p90, basin from public.admin_coastal_gate() where id = 'test_mouth'",
    );
    expect(row?.llw_p90).toBe(0.89);
    // The function hands the dashboard the basin, which is what a zone is matched on.
    expect(row?.basin).toBe("test_gate_river");
  });

  it("keeps a mouth that has no warning zone, with no basin to match", async () => {
    await as(db, { uid: w.admin });
    const [row] = await rows<{ basin: string | null; zone_id: string | null }>(
      db,
      "select basin, zone_id from public.admin_coastal_gate() where id = 'test_orphan'",
    );
    expect(row?.zone_id).toBeNull();
    expect(row?.basin).toBeNull();
  });

  it("no client writes it, not even an admin", async () => {
    for (const who of [w.requester, w.admin]) {
      await as(db, { uid: who });
      await expectDenied(
        db,
        "update public.coastal_gate_reference set llw_p90 = 9 where id = 'test_mouth'",
      );
      await expectDenied(db, "delete from public.coastal_gate_reference where id = 'test_mouth'");
      await expectDenied(
        db,
        `insert into public.coastal_gate_reference (id, name, lat, lon)
         values ('sneaked', '{}'::jsonb, 6, 101)`,
      );
    }
  });

  it("loses its zone, not its row, if a warning zone is deleted", async () => {
    await asOwner(db);
    await db.query("delete from public.warning_zones where id = $1", [ZONE]);
    const [row] = await rows<{ zone_id: string | null }>(
      db,
      "select zone_id from public.coastal_gate_reference where id = 'test_mouth'",
    );
    expect(row?.zone_id).toBeNull();
  });
});
