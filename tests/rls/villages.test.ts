/**
 * S3: villages as points, with buildings per hazard class (decision 16 Oct). Rows from the 2012
 * layer, whose terms are unknown, are read only by verified teams and admins; OpenStreetMap rows
 * (and 2012 rows OpenStreetMap also has) by everyone. Nobody writes from a client.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;
let lon = 0;
let lat = 0;

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
  [lon, lat] = w.yalaPoint
    .replace(/POINT\(|\)/g, "")
    .split(" ")
    .map(Number) as [number, number];
  // The test brings its own rows, so it does not depend on the seed having been loaded.
  await db.query("delete from public.villages");
  const insert = `insert into public.villages (id, source, public, tambon_code, name_th, name_en, point,
      radar_run, land_km2, buildings, high_buildings, medium_buildings, low_buildings, minimal_buildings,
      buildings_medium_or_high_pct)
    values ($1, $2, $3, $4, $5, $6, extensions.st_setsrid(extensions.st_makepoint($7, $8), 4326),
      'test', 1, 100, 10, 30, 20, 40, 40)`;
  // The private one sits on the point; the public one about 110 m north of it.
  await db.query(insert, ["v12:1", "dopa2012", false, w.yala1, "บ้านทดสอบลับ", null, lon, lat]);
  await db.query(insert, [
    "osm:1",
    "osm",
    true,
    w.yala1,
    "บ้านทดสอบ",
    "Ban Test",
    lon,
    lat + 0.001,
  ]);
});
afterEach(async () => {
  await db.query("rollback");
});

const seen = async () =>
  (await rows<{ id: string }>(db, "select id from public.villages order by id")).map((r) => r.id);
const near = async () =>
  rows<{ i: number; village_id: string; distance_m: number }>(
    db,
    "select * from public.villages_near($1::jsonb)",
    [
      JSON.stringify([
        [lon, lat],
        [lon + 1, lat + 1],
      ]),
    ],
  );

describe("villages", () => {
  it("a visitor and a signed-in resident see only the public villages", async () => {
    await as(db, "anon");
    expect(await seen()).toEqual(["osm:1"]);
    await as(db, { uid: w.requester });
    expect(await seen()).toEqual(["osm:1"]);
    // A team still waiting for verification is a resident here.
    await as(db, { uid: w.yalaPending.user });
    expect(await seen()).toEqual(["osm:1"]);
  });

  it("a verified team and an admin see every village", async () => {
    for (const uid of [w.yalaRescue.user, w.songkhlaRescue.user, w.admin]) {
      await as(db, { uid });
      expect(await seen()).toEqual(["osm:1", "v12:1"]);
    }
  });

  it("the nearest village follows the same rule; a point far from any gets nothing", async () => {
    await as(db, "anon");
    const forVisitor = await near();
    expect(forVisitor.map((r) => [r.i, r.village_id])).toEqual([[0, "osm:1"]]);
    expect(forVisitor[0]!.distance_m).toBeGreaterThan(80);
    expect(forVisitor[0]!.distance_m).toBeLessThan(150);
    await as(db, { uid: w.yalaRescue.user });
    const forTeam = await near();
    expect(forTeam.map((r) => [r.i, r.village_id, r.distance_m])).toEqual([[0, "v12:1", 0]]);
  });

  it("is written by no client, whatever their role", async () => {
    for (const who of [null, w.requester, w.yalaRescue.user, w.admin]) {
      await as(db, who ? { uid: who } : "anon");
      await expectDenied(db, "update public.villages set name_th = 'x'");
      await expectDenied(db, "delete from public.villages");
    }
    await asOwner(db);
    expect(await seen()).toEqual(["osm:1", "v12:1"]);
  });
});
