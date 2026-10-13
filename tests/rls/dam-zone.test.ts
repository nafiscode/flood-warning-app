/**
 * S7: the dam's downstream zone. Public to read, written by nobody but the seed, and the reads
 * the app uses follow whichever geometry a dam is drawn with.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

const SQUARE =
  "extensions.st_multi(extensions.st_geomfromtext('POLYGON((101.2 6.5, 101.3 6.5, 101.3 6.6, 101.2 6.6, 101.2 6.5))', 4326))";

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
  // A version of the path of our own, so the test does not lean on what the seed loaded.
  await db.query("delete from public.dam_zones where source = 'test'");
  await db.query(
    `insert into public.dam_zones (dam_code, source, band, geom) values
       ('bang_lang', 'test', 'zone', ${SQUARE}), ('bang_lang', 'test', 'outer', ${SQUARE})`,
  );
  await db.query(
    `insert into public.dam_reaches (dam_code, source, kind, seq, name, km_from_dam, length_km, line)
     select dam_code, 'test', kind, seq, name, km_from_dam, length_km, line
       from public.dam_reaches where dam_code = 'bang_lang' and source = 'osm' and kind = 'main'`,
  );
  await db.query(
    `insert into public.dam_tambons (dam_code, source, tambon_code, via, km_from_dam)
     select 'bang_lang', 'test', code, 'tributary', 5 from public.tambons order by code limit 2`,
  );
  await db.query("update public.dams set geometry_source = 'test' where code = 'bang_lang'");
});
afterEach(async () => {
  await db.query("rollback");
});

describe("dam_zones", () => {
  it("is read by a visitor through the map function, outer band first", async () => {
    await as(db, "anon");
    const zones = await rows<{ band: string; source: string; geom: { type: string } }>(
      db,
      "select band, source, geom from public.dam_zone_map('bang_lang')",
    );
    expect(zones.map((z) => z.band)).toEqual(["outer", "zone"]);
    expect(zones.every((z) => z.source === "test")).toBe(true);
    expect(zones.every((z) => JSON.stringify(z.geom).includes("Polygon"))).toBe(true);
  });

  it("gives only the outlines of the geometry the dam is drawn with", async () => {
    await asOwner(db);
    await db.query("update public.dams set geometry_source = 'osm' where code = 'bang_lang'");
    await as(db, { uid: w.requester });
    const zones = await rows(db, "select band from public.dam_zone_map() where source = 'test'");
    expect(zones).toHaveLength(0);
  });

  it("is written by no client, whatever their role", async () => {
    for (const who of [null, w.requester, w.admin]) {
      await as(db, who ? { uid: who } : "anon");
      await expectDenied(db, "delete from public.dam_zones where source = 'test'");
      await expectDenied(db, "update public.dam_zones set band = 'outer' where source = 'test'");
    }
    await asOwner(db);
    const left = await rows(db, "select 1 from public.dam_zones where source = 'test'");
    expect(left).toHaveLength(2);
  });

  it("refuses a band that is neither the zone nor its outer band", async () => {
    await asOwner(db);
    await expectDenied(
      db,
      `insert into public.dam_zones (dam_code, source, band, geom) values ('bang_lang', 'test2', 'inner', ${SQUARE})`,
    );
  });
});

describe("the dam's reads follow its own geometry", () => {
  it("dam_map and dam_state answer without being told a source", async () => {
    await as(db, "anon");
    const map = await rows<{
      geometry_source: string;
      tambons: number;
      tambons_main: number;
      reaches: unknown[];
    }>(
      db,
      "select geometry_source, tambons, tambons_main, reaches from public.dam_map() where code = 'bang_lang'",
    );
    expect(map).toHaveLength(1);
    expect(map[0]!.geometry_source).toBe("test");
    expect(map[0]!.tambons).toBe(2);
    expect(map[0]!.tambons_main).toBe(0);
    expect(map[0]!.reaches.length).toBeGreaterThan(0);
    const state = await rows(db, "select code from public.dam_state() where code = 'bang_lang'");
    expect(state).toHaveLength(1);
  });

  it("a source that no dam uses returns nothing, as before", async () => {
    await as(db, "anon");
    expect(await rows(db, "select code from public.dam_map('nowhere')")).toHaveLength(0);
    expect(await rows(db, "select code from public.dam_state('nowhere')")).toHaveLength(0);
  });

  it("a tambon is on the path of the geometry in use", async () => {
    await as(db, "anon");
    const mine = await rows<{ code: string }>(
      db,
      "select code from public.tambons order by code limit 1",
    );
    const hit = await rows<{ via: string }>(db, "select via from public.dam_tambon_on_path($1)", [
      mine[0]!.code,
    ]);
    expect(hit.map((h) => h.via)).toEqual(["tributary"]);
  });
});
