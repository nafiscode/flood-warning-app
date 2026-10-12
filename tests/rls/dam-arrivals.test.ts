/**
 * S7: the arrival ranges per tambon. Public to read, written by nobody but the seed, and the
 * table itself refuses a row whose times are out of order.
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
  await db.query("delete from public.dam_arrivals where source = 'test'");
  await db.query(
    `insert into public.dam_arrivals (dam_code, source, tambon_code, via, km_from_dam, warn_from_h,
       earliest_h, latest_h, peak_earliest_h, peak_latest_h)
     select 'bang_lang', 'test', t.tambon_code, t.via, 10, 1, 1.5, 2.5, 2, 3
       from public.dam_tambons t where t.dam_code = 'bang_lang' limit 1`,
  );
});
afterEach(async () => {
  await db.query("rollback");
});

const count = async () =>
  (
    await rows<{ n: number }>(
      db,
      "select count(*)::int n from public.dam_arrivals where source = 'test'",
    )
  )[0]!.n;

describe("dam_arrivals", () => {
  it("is read by a visitor and by a signed-in person", async () => {
    await as(db, "anon");
    expect(await count()).toBe(1);
    await as(db, { uid: w.requester });
    expect(await count()).toBe(1);
  });

  it("is written by no client, whatever their role", async () => {
    for (const who of [null, w.requester, w.admin]) {
      await as(db, who ? { uid: who } : "anon");
      await expectDenied(db, "update public.dam_arrivals set earliest_h = 0 where source = 'test'");
      await expectDenied(db, "delete from public.dam_arrivals where source = 'test'");
      await expectDenied(
        db,
        `insert into public.dam_arrivals (dam_code, source, tambon_code, via, km_from_dam, warn_from_h,
           earliest_h, latest_h, peak_earliest_h, peak_latest_h)
         select dam_code, 'test2', tambon_code, via, 1, 1, 1, 1, 1, 1 from public.dam_arrivals where source = 'test'`,
      );
    }
    await asOwner(db);
    expect(await count()).toBe(1);
  });

  it("refuses times that are out of order, even from the seed", async () => {
    await asOwner(db);
    await expectDenied(db, "update public.dam_arrivals set earliest_h = 9 where source = 'test'");
    await expectDenied(db, "update public.dam_arrivals set warn_from_h = 2 where source = 'test'");
    await expectDenied(
      db,
      "update public.dam_arrivals set peak_latest_h = 1 where source = 'test'",
    );
  });
});
