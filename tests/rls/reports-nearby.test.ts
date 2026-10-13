/**
 * Flood reports the neighbours can see (the owner, 13 Oct 2026).
 *
 * What these tests are really guarding:
 *  - everyone gets counts per tambon only: no point, no reporter, no text (safety rule 6);
 *  - a report counts at once, but one an admin hid counts nowhere;
 *  - a report stands until its own reporter ends it, or two other people report dry ground after
 *    it. One person alone cannot take a neighbour's warning down;
 *  - "confirmed" needs three different people, not three reports from one account.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, createUser, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

type Row = {
  tambon: string;
  reports: number;
  people: number;
  deepest: string;
  confirmed: boolean;
  latest_at: Date;
};

const add = async (who: string, depth: string, age = "10 minutes", status = "pending") =>
  (
    await rows<{ id: string }>(
      db,
      `insert into reports (reporter_id, point, tambon, depth_ref, text, moderation_status, created_at)
       values ($1, extensions.st_geomfromtext($2, 4326), $3, $4::depth_ref, 'my street, house 12',
               $5::moderation_status, now() - $6::interval)
       returning id`,
      [who, w.yalaPoint, w.yala1, depth, status, age],
    )
  )[0]!.id;

const tambons = async () => {
  await as(db, "anon");
  const out = await rows<Row>(db, "select * from flood_reports_by_tambon()");
  await asOwner(db);
  return out;
};
const yala = async () => (await tambons()).find((r) => r.tambon === w.yala1);

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
  // Start from nothing: the fixture has a report of its own, and the dev database may have more.
  await db.query("delete from reports");
});
afterEach(async () => {
  await db.query("rollback");
});

describe("what everyone sees", () => {
  it("a report counts at once, and the answer has counts only", async () => {
    await add(w.requester, "knee");
    const all = await tambons();
    expect(all).toHaveLength(1);
    const row = all[0]!;
    expect(row).toMatchObject({ tambon: w.yala1, reports: 1, people: 1, deepest: "knee" });
    expect(row.confirmed).toBe(false);
    expect(row.latest_at.getUTCMinutes()).toBe(0);
    const text = JSON.stringify(all);
    expect(text).not.toContain(w.requester);
    expect(text).not.toContain("house 12");
    // The place given is the tambon's own, not the report's.
    expect(Object.keys(row)).not.toContain("point");
  });

  it("a hidden report, a dry one and one older than the standing time count nowhere", async () => {
    await add(w.requester, "roof", "10 minutes", "hidden");
    await add(w.requester, "dry");
    await add(w.otherUser, "waist", "80 hours");
    expect(await tambons()).toEqual([]);
    await as(db, "anon");
    expect(await rows(db, "select * from report_hex_bins()")).toEqual([]);
  });

  it("three reports from one person are not a confirmation; three people are", async () => {
    await add(w.requester, "knee");
    await add(w.requester, "knee");
    await add(w.requester, "waist");
    expect(await yala()).toMatchObject({ reports: 3, people: 1, confirmed: false });
    await add(w.otherUser, "ankle");
    const third = await createUser(db, { name: "third neighbour" });
    await add(third, "knee");
    expect(await yala()).toMatchObject({
      reports: 5,
      people: 3,
      confirmed: true,
      deepest: "waist",
    });
  });

  it("the internal list with points and reporters is closed to every client", async () => {
    await as(db, "anon");
    await expectDenied(db, "select * from standing_flood_reports()");
    await as(db, { uid: w.requester });
    await expectDenied(db, "select * from standing_flood_reports()");
  });
});

describe("a report stands until somebody says the water has gone", () => {
  it("its own reporter ends it, and only their own", async () => {
    const mine = await add(w.requester, "knee");
    const theirs = await add(w.otherUser, "knee");
    await as(db, { uid: w.requester });
    const tried = await rows<{ ok: boolean }>(db, "select end_my_flood_report($1) as ok", [theirs]);
    expect(tried[0]!.ok).toBe(false);
    const done = await rows<{ ok: boolean }>(db, "select end_my_flood_report($1) as ok", [mine]);
    expect(done[0]!.ok).toBe(true);
    const list = await rows<{ id: string; state: string }>(db, "select * from my_flood_reports()");
    expect(list).toEqual([expect.objectContaining({ id: mine, state: "ended" })]);
    await asOwner(db);
    expect(await yala()).toMatchObject({ reports: 1, people: 1 });
  });

  it("the reporter's own later dry report ends it too", async () => {
    await add(w.requester, "knee", "2 hours");
    await add(w.requester, "dry", "10 minutes");
    expect(await tambons()).toEqual([]);
  });

  it("one other person saying dry does not take it down; two do", async () => {
    const mine = await add(w.requester, "knee", "3 hours");
    await add(w.otherUser, "dry", "1 hour");
    expect(await yala()).toMatchObject({ reports: 1 });
    const third = await createUser(db, { name: "third neighbour" });
    await add(third, "dry", "30 minutes");
    expect(await tambons()).toEqual([]);
    await as(db, { uid: w.requester });
    const list = await rows<{ id: string; state: string }>(db, "select * from my_flood_reports()");
    expect(list).toEqual([expect.objectContaining({ id: mine, state: "cleared" })]);
  });

  it("dry reports from before a new flood report do not clear it", async () => {
    const third = await createUser(db, { name: "third neighbour" });
    await add(w.otherUser, "dry", "5 hours");
    await add(third, "dry", "4 hours");
    await add(w.requester, "waist", "1 hour");
    expect(await yala()).toMatchObject({ reports: 1, deepest: "waist" });
  });

  it("a visitor has no reports of their own to read or end", async () => {
    await as(db, "anon");
    await expectDenied(db, "select * from my_flood_reports()");
    await expectDenied(db, "select end_my_flood_report(gen_random_uuid())");
  });
});
