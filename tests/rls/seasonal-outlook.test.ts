/**
 * S8: the seasonal outlook. Admins read it; visitors and other signed-in people see nothing; nobody
 * writes it from a client.
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
  // The test brings its own row, so it does not depend on the seed having been loaded.
  await db.query("delete from public.seasonal_outlooks where season = 1999");
  await db.query(
    `insert into public.seasonal_outlooks (season, issued_on, method, lean, odds_dry, odds_normal,
       odds_wet, past_hit_pct, chance_hit_pct, past_seasons, usable, note)
     values (1999, '1999-10-14', 'pacific', 'dry', 50, 30, 20, 40, 33, 30, true, 'test')`,
  );
});
afterEach(async () => {
  await db.query("rollback");
});

const count = async () =>
  (await rows<{ n: number }>(db, "select count(*)::int n from public.seasonal_outlooks where season = 1999"))[0]!
    .n;

describe("seasonal_outlooks", () => {
  it("is read by an admin and a super admin", async () => {
    await as(db, { uid: w.admin });
    expect(await count()).toBe(1);
    await as(db, { uid: w.superAdmin });
    expect(await count()).toBe(1);
  });

  it("shows nothing to a visitor or to a signed-in person who is not an admin", async () => {
    await as(db, "anon");
    expect(await count()).toBe(0);
    await as(db, { uid: w.requester });
    expect(await count()).toBe(0);
  });

  it("is written by nobody from a client, admins included", async () => {
    for (const who of ["anon", { uid: w.requester }, { uid: w.admin }] as const) {
      await as(db, who);
      await expectDenied(
        db,
        `insert into public.seasonal_outlooks (season, issued_on, method, lean, usable, note)
         values (1999, '1999-10-15', 'summary', 'none', false, 'x')`,
      );
      await expectDenied(db, "update public.seasonal_outlooks set lean = 'wet' where season = 1999");
      await expectDenied(db, "delete from public.seasonal_outlooks where season = 1999");
    }
  });

  it("refuses odds that do not add up and a lean it does not know", async () => {
    await asOwner(db);
    await expectDenied(
      db,
      `insert into public.seasonal_outlooks (season, issued_on, method, lean, odds_dry, odds_normal,
         odds_wet, usable, note) values (1999, '1999-10-16', 'x', 'dry', 50, 50, 50, true, 'x')`,
    );
    await expectDenied(
      db,
      `insert into public.seasonal_outlooks (season, issued_on, method, lean, usable, note)
       values (1999, '1999-10-16', 'x', 'very wet', true, 'x')`,
    );
  });
});
