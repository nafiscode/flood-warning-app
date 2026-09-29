/** Tests for the A1 helper functions: geography, safe-place ranking, SOS priority and duplicates. */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, rows } from "./db";
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

const one = async <T>(sql: string, params: unknown[] = []) => (await rows<T>(db, sql, params))[0]!;

describe("geography", () => {
  it("tambon_for_point finds the tambon, and nothing outside the covered provinces", async () => {
    await as(db, "anon");
    const inYala = await one<{ t: string }>(
      "select tambon_for_point(extensions.st_geomfromtext($1, 4326)) as t",
      [w.yalaPoint],
    );
    expect(inYala.t).toBe(w.yala1);
    const bangkok = await one<{ t: string | null }>(
      "select tambon_for_point(extensions.st_makepoint(100.5018, 13.7563)) as t",
    );
    expect(bangkok.t).toBeNull();
  });

  it("expand_coverage lists every tambon of a province and district", async () => {
    await as(db, "anon");
    const yala = await one<{ n: string }>(
      "select count(*) as n from expand_coverage('province', '95')",
    );
    const direct = await one<{ n: string }>(
      "select count(*) as n from tambons where province_code = '95'",
    );
    expect(Number(yala.n)).toBe(Number(direct.n));
    const district = w.yala1.slice(0, 4);
    const codes = await rows<{ t: string }>(db, "select t from expand_coverage('district', $1) t", [
      district,
    ]);
    expect(codes.every((c) => c.t.startsWith(district))).toBe(true);
  });

  it("districts and tambons line up: every tambon lies inside its district", async () => {
    const outside = await one<{ n: string }>(
      `select count(*) as n from tambons t join districts d on d.code = t.district_code
       where not extensions.st_covers(extensions.st_buffer(d.geom, 0.00001), t.geom)`,
    );
    expect(Number(outside.n)).toBe(0);
  });
});

describe("rank_safe_places", () => {
  it("ranks by score and distance, and leaves out closed places", async () => {
    await asOwner(db);
    const add = (name: string, dx: number, score: number, status = "open") =>
      db.query(
        `insert into safe_places (name, type, point, score, status)
         values (jsonb_build_object('th', $1::text), 'school',
                 extensions.st_translate(extensions.st_geomfromtext($2, 4326), $3, 0), $4, $5::safe_place_status)`,
        [name, w.yalaPoint, dx, score, status],
      );
    await add("near, good", 0.005, 0.9);
    await add("near, poor", 0.004, 0.1);
    await add("far, good", 0.15, 0.9);
    await add("closest, closed", 0.001, 1.0, "closed");
    await as(db, "anon");
    const top = await rows<{ name: { th: string } }>(
      db,
      "select name from rank_safe_places(extensions.st_geomfromtext($1, 4326), 3)",
      [w.yalaPoint],
    );
    expect(top.map((r) => r.name.th)).toEqual(["near, good", "near, poor", "far, good"]);
  });
});

describe("SOS helpers", () => {
  it("sos_priority is higher for vulnerable people in deep water", async () => {
    await asOwner(db);
    const calm = await one<{ id: string }>(
      `insert into sos_requests (point, tambon, people_count, depth_ref)
       values (extensions.st_geomfromtext($1, 4326), $2, 1, 'ankle') returning id`,
      [w.yalaPoint, w.yala1],
    );
    const urgent = await one<{ p: number }>("select sos_priority($1) as p", [w.yalaSos]);
    const mild = await one<{ p: number }>("select sos_priority($1) as p", [calm.id]);
    expect(urgent.p).toBeGreaterThan(mild.p);
  });

  it("flag_possible_duplicate flags a nearby recent case but never drops it", async () => {
    await asOwner(db);
    const second = await one<{ id: string }>(
      `insert into sos_requests (point, tambon)
       values (extensions.st_translate(extensions.st_geomfromtext($1, 4326), 0.001, 0), $2) returning id`,
      [w.yalaPoint, w.yala1],
    );
    const flagged = await one<{ d: string }>("select flag_possible_duplicate($1) as d", [
      second.id,
    ]);
    expect(flagged.d).toBe(w.yalaSos);
    const still = await one<{ status: string; duplicate_of: string | null }>(
      "select status, duplicate_of from sos_requests where id = $1",
      [second.id],
    );
    expect(still).toEqual({ status: "received", duplicate_of: null });
  });

  it("flag_possible_duplicate can't be called by clients", async () => {
    await as(db, { uid: w.admin });
    await db.query("savepoint s");
    await expect(db.query("select flag_possible_duplicate($1)", [w.yalaSos])).rejects.toMatchObject(
      { code: "42501" },
    );
    await db.query("rollback to savepoint s");
  });
});
