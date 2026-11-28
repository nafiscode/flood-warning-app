/**
 * `push_tick_owed()` (a7_push_tick_when_owed, 28 Nov 2026): when the database's minute knock calls
 * Jaga's server. It must call while a request nobody holds is open (its offer runs with the
 * clock), and every ten minutes whatever else is true, so that nothing the server's tick sends is
 * ever lost; it must not call every minute for a request a team already holds.
 *
 * What this file covers is the part that reads the real `sos_requests` and `sos_claims`, the
 * safety-net minutes, and who may call it. The alarm and season halves read the same tables the
 * push functions mark, and were checked scenario by scenario (40 checks, drills, cancelled alerts,
 * LINE, events older than a day) on a stand-in database in the session that wrote the migration.
 *
 * Meant for CI on a fresh database. The laptop does not run the RLS suite against jaga-dev, which
 * is the live database since the launch (decision 2026-11-28).
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

// Minute :03 is not a safety-net minute; :07 and :17 are.
const QUIET = "2026-11-28T10:03:00Z";
const BEAT = "2026-11-28T10:07:00Z";

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
  // Put every other request out of the three-day window, so only this test's own can matter.
  await db.query("update sos_requests set created_at = now() - interval '5 days'");
});
afterEach(async () => {
  await db.query("rollback");
});

const owed = async (at = QUIET) =>
  (await rows<{ o: boolean }>(db, "select public.push_tick_owed($1::timestamptz) o", [at]))[0]!.o;

describe("push_tick_owed", () => {
  it("is quiet when nothing is open, and rings every ten minutes anyway", async () => {
    expect(await owed(QUIET)).toBe(false);
    expect(await owed(BEAT)).toBe(true);
    expect(await owed("2026-11-28T10:17:00Z")).toBe(true);
    expect(await owed("2026-11-28T10:08:00Z")).toBe(false);
  });

  it("calls every minute while a request nobody holds is open", async () => {
    await db.query(
      "update sos_requests set created_at = now(), status = 'received' where id = $1",
      [w.yalaSos],
    );
    expect(await owed(QUIET)).toBe(true);
  });

  it("stops calling every minute once a team holds the request, and starts again if it lets go", async () => {
    await db.query(
      "update sos_requests set created_at = now(), status = 'assigned' where id = $1",
      [w.yalaSos],
    );
    await db.query("insert into sos_claims (sos_id, unit_id) values ($1, $2)", [
      w.yalaSos,
      w.yalaRescue.id,
    ]);
    expect(await owed(QUIET)).toBe(false);
    // The ten-minute net still reaches it.
    expect(await owed(BEAT)).toBe(true);
    await db.query("update sos_claims set released_at = now() where sos_id = $1", [w.yalaSos]);
    expect(await owed(QUIET)).toBe(true);
  });

  it("never calls for a request that has been closed or dismissed", async () => {
    await db.query(
      "update sos_requests set created_at = now(), status = 'dismissed' where id = $1",
      [w.yalaSos],
    );
    expect(await owed(QUIET)).toBe(false);
  });

  it("is for the database alone: no visitor, user or admin can call it", async () => {
    for (const who of ["anon", { uid: w.requester }, { uid: w.admin }] as const) {
      await as(db, who);
      await expectDenied(db, "select public.push_tick_owed()");
    }
  });
});
