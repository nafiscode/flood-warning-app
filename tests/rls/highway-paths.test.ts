/**
 * A19, where a road may be holding water back: who may read it, and what `planning` alone opens.
 *
 * Two halves, and the first matters more than the feature does.
 *
 * **The lockdown.** A19 invites a provincial highway office to register with the `planning`
 * capability and province-wide coverage. Before 10 Nov 2026, `covers_tambon()` and
 * `is_verified_authority()` asked only whether a unit was verified and covered the place, so such
 * an office would have read every resident's exact address and telephone number in a whole
 * province. These tests hold that shut (safety rule 5), and hold open the case that must keep
 * working: a unit that is `planning` AND `rescue` is still a team in every way.
 *
 * **The feature.** Province scope, a note each office owns, and nothing of it anywhere near a
 * resident, a rescue team or a visitor.
 */
import { existsSync, readFileSync } from "node:fs";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, createUser, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

/**
 * A19's two migrations, run inside this test's own transaction when the database they are run
 * against has not had them applied yet.
 *
 * Unusual in a policy test, and here for a reason particular to this project: from the 25 October
 * launch, `jaga-dev` is the database the live site reads, so a migration waits for the owner to
 * apply it rather than going on by itself. Without this the suite could not be run at all until
 * then - and an RLS test nobody has run is worth nothing. On a fresh database (CI, `db:reset`)
 * the tables are already there from the migration folder and this does nothing.
 *
 * It works only because `unit_is_office_only` tests the capability LABELS rather than writing an
 * enum array literal: Postgres refuses a newly added enum value in the transaction that added it,
 * and 'dam' arrives in 20261109120000.
 */
const MIGRATIONS = [
  "supabase/migrations/20261110180000_a19_planning_not_a_field_team.sql",
  "supabase/migrations/20261110180100_a19_highway_paths.sql",
];

async function applyIfMissing(client: Client): Promise<void> {
  const [there] = await rows<{ yes: boolean }>(
    client,
    "select to_regclass('public.highway_sections') is not null as yes",
  );
  if (there!.yes) return;
  for (const file of MIGRATIONS) {
    if (!existsSync(file)) throw new Error(`missing migration: ${file}`);
    await client.query(readFileSync(file, "utf8"));
  }
}

/** A unit of our own, so this file does not depend on the fixtures growing capabilities. */
async function unit(name: string, caps: string[], tambons: string[]) {
  await asOwner(db);
  const user = await createUser(db, { name, role: "authority" });
  const id = (
    await rows<{ id: string }>(
      db,
      `insert into authority_units (org_id, user_id, unit_name, capabilities, status)
       values ($1, $2, $3, $4::authority_capability[], 'verified') returning id`,
      [w.org, user, name, caps],
    )
  )[0]!.id;
  await db.query(
    "insert into authority_unit_contacts (unit_id, poc_name, poc_phone) values ($1, $2, '66830000077')",
    [id, `${name} POC`],
  );
  for (const t of tambons) {
    await db.query(
      "insert into authority_coverage (unit_id, tambon, selected_level, selected_code) values ($1, $2, 'tambon', $2)",
      [id, t],
    );
  }
  return { user, id };
}

/** One section, and the stretch it is the best of. Province comes from the tambon. */
async function section(
  id: string,
  tambon: string,
  klass: "look_first" | "worth_a_look" | "no_sign" | "not_seen",
  score: number | null,
) {
  await asOwner(db);
  const stretch = klass === "look_first" || klass === "worth_a_look" ? `R${id.slice(1)}` : null;
  const point = (
    await rows<{ wkt: string }>(
      db,
      "select extensions.st_astext(extensions.st_pointonsurface(geom)) wkt from tambons where code = $1",
      [tambon],
    )
  )[0]!.wkt;
  await db.query(
    `insert into highway_sections (id, run_id, run_date, geom, mid, province_code, district_code,
       tambon_code, road_kind, road_ref, length_m, chain, section_index, class, score, stretch,
       upstream_side, upstream_by, seasons_seen, seasons_up_wetter, asymmetry, crossing_km2,
       crossings, crossing_from, crossing_opening, crossing_opening_m, persistence,
       passes_seen, passes_flooded_up, passes_flooded_down)
     values ($1, 'c97e0bf', '2026-10-15',
       extensions.st_makeline(extensions.st_geomfromtext($2, 4326),
         extensions.st_translate(extensions.st_geomfromtext($2, 4326), 0.004, 0.004)),
       extensions.st_geomfromtext($2, 4326),
       left($3, 2), left($3, 4), $3, 'trunk', '42', 500, 1, 1, $4::highway_path_class, $5, $6,
       'left', 'd8', 9, 8, 0.307, 54.74, 1, 'left', 'waterway', 249, 0.0789, 122, 38, 0)`,
    [id, point, tambon, klass, score, stretch],
  );
  if (stretch) {
    await db.query(
      `insert into highway_stretches (id, run_id, run_date, province_code, class, score, km,
         best_section, sections, rank)
       values ($1, 'c97e0bf', '2026-10-15', left($2, 2), $3::highway_path_class, $4, 0.5,
               $5, array[$5], 1)`,
      [stretch, tambon, klass, score ?? 0, id],
    );
  }
  return { id, stretch };
}

beforeAll(async () => {
  db = await connect();
});
afterAll(async () => {
  await db?.end();
});
beforeEach(async () => {
  await db.query("begin");
  await applyIfMissing(db);
  w = await buildWorld(db);
});
afterEach(async () => {
  await db.query("rollback");
});

describe("a planning office is not a team in the field (safety rule 5)", () => {
  it("is not a verified authority, so the case board and everything behind it is shut", async () => {
    await as(db, { uid: w.yalaPlanning.user });
    const [v] = await rows<{ v: boolean }>(db, "select is_verified_authority() v");
    expect(v!.v).toBe(false);
    await expectDenied(db, "select * from authority_board()");
    await expectDenied(db, "select * from authority_households()");
  });

  it("covers no tambon, so no exact point and no requester's phone", async () => {
    await as(db, { uid: w.yalaPlanning.user });
    const [c] = await rows<{ v: boolean }>(db, "select covers_tambon($1) v", [w.yala1]);
    expect(c!.v).toBe(false);
    expect(await expectDenied(db, "select reveal_sos_phone($1)", [w.yalaSos])).toBe("42501");
    // The SOS row itself carries the exact point: it must not be readable either.
    const seen = await rows(db, "select id from sos_requests where id = $1", [w.yalaSos]);
    expect(seen).toHaveLength(0);
  });

  it("cannot read another unit's point-of-contact phone, shared coverage or not", async () => {
    await as(db, { uid: w.yalaPlanning.user });
    expect(await expectDenied(db, "select * from reveal_poc_phone($1)", [w.yalaRescue.id])).toBe(
      "42501",
    );
  });

  it("is never offered a case and cannot accept one", async () => {
    await as(db, { uid: w.yalaPlanning.user });
    await expectDenied(db, "select authority_accept($1)", [w.yalaSos]);
  });

  it("but a unit that is planning AND rescue is a team in every way", async () => {
    const both = await unit("Yala irrigation with boats", ["planning", "rescue"], [w.yala1]);
    await as(db, { uid: both.user });
    const [v] = await rows<{ v: boolean }>(db, "select is_verified_authority() v");
    expect(v!.v).toBe(true);
    const [c] = await rows<{ v: boolean }>(db, "select covers_tambon($1) v", [w.yala1]);
    expect(c!.v).toBe(true);
    const board = await rows<{ sos_id: string }>(db, "select * from authority_board()");
    expect(board.some((r) => r.sos_id === w.yalaSos)).toBe(true);
  });

  it("and a rescue team is untouched by the change", async () => {
    await as(db, { uid: w.yalaRescue.user });
    const [v] = await rows<{ v: boolean }>(db, "select is_verified_authority() v");
    expect(v!.v).toBe(true);
    const [c] = await rows<{ v: boolean }>(db, "select covers_tambon($1) v", [w.yala1]);
    expect(c!.v).toBe(true);
  });

  it("still reads a drill addressed to every unit, and not one for rescue teams", async () => {
    await as(db, { uid: w.yalaPlanning.user });
    const [all] = await rows<{ v: boolean }>(db, "select drill_visible($1) v", [["units"]]);
    expect(all!.v).toBe(true);
    const [rescue] = await rows<{ v: boolean }>(db, "select drill_visible($1) v", [["rescue"]]);
    expect(rescue!.v).toBe(false);
  });
});

describe("the highway rows: who may read them", () => {
  beforeEach(async () => {
    await section("S00001", w.yala1, "look_first", 0.98);
    await section("S00002", w.yala1, "no_sign", 0.21);
    await section("S00003", w.songkhla, "look_first", 0.77);
  });

  it("are shut to a visitor", async () => {
    await as(db, "anon");
    expect(await rows(db, "select id from highway_sections")).toHaveLength(0);
    expect(await rows(db, "select id from highway_stretches")).toHaveLength(0);
    expect(await rows(db, "select stretch_id from highway_stretch_notes")).toHaveLength(0);
  });

  it("are shut to a resident", async () => {
    await as(db, { uid: w.requester });
    expect(await rows(db, "select id from highway_sections")).toHaveLength(0);
    expect(await expectDenied(db, "select highway_sections_export($1)", ["95"])).toBe("42501");
  });

  it("are shut to a rescue-only team covering the very same tambon", async () => {
    await as(db, { uid: w.yalaRescue.user });
    expect(await rows(db, "select id from highway_sections")).toHaveLength(0);
    expect(await expectDenied(db, "select * from highway_stretch_board($1)", ["95"])).toBe("42501");
  });

  it("are shut to a planning office in another province", async () => {
    const songkhla = await unit("Songkhla highways", ["planning"], [w.songkhla]);
    await as(db, { uid: songkhla.user });
    const seen = await rows<{ province_code: string }>(
      db,
      "select province_code from highway_sections",
    );
    expect(seen.every((r) => r.province_code === "90")).toBe(true);
    expect(seen.some((r) => r.province_code === "95")).toBe(false);
    expect(await expectDenied(db, "select * from highway_stretch_board($1)", ["95"])).toBe("42501");
    expect(await expectDenied(db, "select highway_sections_map($1)", ["95"])).toBe("42501");
    expect(await expectDenied(db, "select highway_sections_export($1)", ["95"])).toBe("42501");
  });

  it("are open to the planning office of that province, and to that province alone", async () => {
    await as(db, { uid: w.yalaPlanning.user });
    const seen = await rows<{ id: string; province_code: string }>(
      db,
      "select id, province_code from highway_sections order by id",
    );
    expect(seen.map((r) => r.id)).toEqual(["S00001", "S00002"]);
    const [provinces] = await rows<{ province_code: string }>(
      db,
      "select * from my_planning_provinces()",
    );
    expect(provinces!.province_code).toBe("95");
    expect(await rows(db, "select * from my_planning_provinces()")).toHaveLength(1);
  });

  it("are open to an admin, for all four provinces", async () => {
    await as(db, { uid: w.admin });
    expect(await rows(db, "select id from highway_sections")).toHaveLength(3);
    expect((await rows(db, "select * from my_planning_provinces()")).length).toBeGreaterThanOrEqual(
      4,
    );
  });

  it("give the office its province's flagged stretches with the figures behind them", async () => {
    await as(db, { uid: w.yalaPlanning.user });
    const board = await rows<Record<string, unknown>>(db, "select * from highway_stretch_board($1)", [
      "95",
    ]);
    expect(board).toHaveLength(1);
    expect(board[0]!.stretch_id).toBe("R00001");
    expect(board[0]!.section_id).toBe("S00001");
    expect(board[0]!.upstream_side).toBe("left");
    expect(Number(board[0]!.crossing_km2)).toBe(54.74);
    expect(board[0]!.crossing_opening).toBe("waterway");
  });

  it("hand the map one province as a FeatureCollection", async () => {
    await as(db, { uid: w.yalaPlanning.user });
    const [got] = await rows<{ j: { type: string; features: unknown[] } }>(
      db,
      "select highway_sections_map($1) j",
      ["95"],
    );
    expect(got!.j.type).toBe("FeatureCollection");
    expect(got!.j.features).toHaveLength(2);
  });

  it("hand the download one province, with names and geometry and no pipeline prose", async () => {
    await as(db, { uid: w.yalaPlanning.user });
    const [got] = await rows<{ j: Record<string, unknown>[] }>(
      db,
      "select highway_sections_export($1) j",
      ["95"],
    );
    expect(got!.j).toHaveLength(2);
    const first = got!.j.find((r) => r.id === "S00001")!;
    expect(first.province).toBe("Yala");
    expect(typeof first.tambon_th).toBe("string");
    expect((first.geometry as { type: string }).type).toBe("LineString");
    // The pipeline's own English sentence never leaves the pipeline (A19 item 4).
    expect(first.reasons).toBeUndefined();
  });
});

describe("the office's note on a stretch", () => {
  beforeEach(async () => {
    await section("S00001", w.yala1, "look_first", 0.98);
    await section("S00003", w.songkhla, "look_first", 0.77);
  });

  it("is written and read back by the office that owns the province", async () => {
    await as(db, { uid: w.yalaPlanning.user });
    await db.query("select set_highway_stretch_note($1, $2::highway_note_status, $3)", [
      "R00001",
      "checked_imagery",
      "The culvert is there on the 2024 imagery but silted.",
    ]);
    const got = await rows<{ status: string; note: string; unit_id: string }>(
      db,
      "select status, note, unit_id from highway_stretch_notes where stretch_id = $1",
      ["R00001"],
    );
    expect(got).toHaveLength(1);
    expect(got[0]!.status).toBe("checked_imagery");
    expect(got[0]!.unit_id).toBe(w.yalaPlanning.id);
    // And it comes back on the board beside the stretch.
    const board = await rows<{ note_status: string }>(
      db,
      "select note_status from highway_stretch_board($1)",
      ["95"],
    );
    expect(board[0]!.note_status).toBe("checked_imagery");
  });

  it("cannot be written on another province's stretch", async () => {
    await as(db, { uid: w.yalaPlanning.user });
    expect(
      await expectDenied(db, "select set_highway_stretch_note($1, $2::highway_note_status, $3)", [
        "R00003",
        "done",
        "not mine",
      ]),
    ).toBe("42501");
  });

  it("is not shown to another province's office", async () => {
    await as(db, { uid: w.yalaPlanning.user });
    await db.query("select set_highway_stretch_note($1, $2::highway_note_status, $3)", [
      "R00001",
      "work_planned",
      "ours",
    ]);
    const songkhla = await unit("Songkhla highways", ["planning"], [w.songkhla]);
    await as(db, { uid: songkhla.user });
    expect(await rows(db, "select stretch_id from highway_stretch_notes")).toHaveLength(0);
  });

  it("cannot be written by a rescue team, a resident or a visitor", async () => {
    for (const uid of [w.yalaRescue.user, w.requester, w.otherUser]) {
      await as(db, { uid });
      expect(
        await expectDenied(db, "select set_highway_stretch_note($1, $2::highway_note_status, $3)", [
          "R00001",
          "done",
          "x",
        ]),
      ).toBe("42501");
    }
    await as(db, "anon");
    await expectDenied(db, "select set_highway_stretch_note($1, $2::highway_note_status, $3)", [
      "R00001",
      "done",
      "x",
    ]);
  });

  it("survives a reload that replaces every row of the pipeline's run", async () => {
    await as(db, { uid: w.yalaPlanning.user });
    await db.query("select set_highway_stretch_note($1, $2::highway_note_status, $3)", [
      "R00001",
      "checked_ground",
      "went and looked",
    ]);
    // What `highway_paths load` does, in the order it does it.
    await asOwner(db);
    await db.query("delete from highway_stretches");
    await db.query("delete from highway_sections");
    await as(db, { uid: w.yalaPlanning.user });
    const kept = await rows<{ status: string; note: string }>(
      db,
      "select status, note from highway_stretch_notes where stretch_id = $1",
      ["R00001"],
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]!.note).toBe("went and looked");
  });

  it("is written to the audit log, under the person's own account", async () => {
    await as(db, { uid: w.yalaPlanning.user });
    await db.query("select set_highway_stretch_note($1, $2::highway_note_status, $3)", [
      "R00001",
      "done",
      "culvert enlarged",
    ]);
    await asOwner(db);
    const log = await rows<{ action: string; entity_id: string; details: { unit: string } }>(
      db,
      "select action, entity_id, details from audit_log where actor = $1 and action = 'highway_note_set'",
      [w.yalaPlanning.user],
    );
    expect(log).toHaveLength(1);
    expect(log[0]!.entity_id).toBe("R00001");
    expect(log[0]!.details.unit).toBe(w.yalaPlanning.id);
  });
});

describe("the page view and the download are logged", () => {
  it("records who looked at which province, and which format left", async () => {
    await as(db, { uid: w.yalaPlanning.user });
    await db.query("select log_highway_paths_view($1)", ["95"]);
    await db.query("select log_highway_paths_view($1, $2)", ["95", "csv"]);
    await asOwner(db);
    const log = await rows<{ action: string; entity_id: string; details: { format?: string } }>(
      db,
      "select action, entity_id, details from audit_log where actor = $1 and action like 'highway_paths%' order by action",
      [w.yalaPlanning.user],
    );
    expect(log.map((r) => r.action)).toEqual([
      "highway_paths_downloaded",
      "highway_paths_viewed",
    ]);
    expect(log[0]!.details.format).toBe("csv");
    expect(log[1]!.entity_id).toBe("95");
  });

  it("refuses to log a view of a province the caller may not read", async () => {
    await as(db, { uid: w.requester });
    expect(await expectDenied(db, "select log_highway_paths_view($1)", ["95"])).toBe("42501");
    await as(db, { uid: w.yalaPlanning.user });
    expect(await expectDenied(db, "select log_highway_paths_view($1)", ["90"])).toBe("42501");
  });
});

describe("nothing here is an alert", () => {
  it("leaves alerts untouched when a note is written", async () => {
    await section("S00001", w.yala1, "look_first", 0.98);
    await asOwner(db);
    const before = (await rows<{ n: string }>(db, "select count(*) n from alerts"))[0]!.n;
    await as(db, { uid: w.yalaPlanning.user });
    await db.query("select set_highway_stretch_note($1, $2::highway_note_status, $3)", [
      "R00001",
      "work_planned",
      "planning the culvert",
    ]);
    await asOwner(db);
    const after = (await rows<{ n: string }>(db, "select count(*) n from alerts"))[0]!.n;
    expect(after).toBe(before);
  });

  it("has no path from a section to an alert, a suggestion or a notification", async () => {
    await asOwner(db);
    // Nothing in the database reads these tables but the three A19 functions and the page.
    const readers = await rows<{ p: string }>(
      db,
      `select p.proname p from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.prosrc like '%highway_sections%'
       order by 1`,
    );
    expect(readers.map((r) => r.p).sort()).toEqual([
      "highway_sections_export",
      "highway_sections_map",
      "highway_stretch_board",
    ]);
  });
});
