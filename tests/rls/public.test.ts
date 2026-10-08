/** A3: what a visitor can read for the home screen and the public map (safety rules 3, 6, 10). */
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

/** An alert in force, issued by the admin; `extra` sets one more column from an SQL expression. */
async function alert(
  level: string,
  tambons: string[],
  extra?: { column: string; value: string },
): Promise<string> {
  const { id } = await one<{ id: string }>(
    `insert into alerts (level, reason, messages, issued_by, issued_at, next_update_at
                         ${extra ? `, ${extra.column}` : ""})
     values ($1::alert_level, 'River rising at the test gauge', '{"th": "ทดสอบ"}', $2,
             now() - interval '1 hour', now() + interval '5 hours' ${extra ? `, ${extra.value}` : ""})
     returning id`,
    [level, w.admin],
  );
  for (const t of tambons) {
    await db.query("insert into alert_tambons (alert_id, tambon) values ($1, $2)", [id, t]);
  }
  return id;
}

describe("public_alert_status", () => {
  it("lists alerts in force with their tambons, and never the issuer", async () => {
    await asOwner(db);
    const active = await alert("warning", [w.yala1, w.yala2]);
    await alert("watch", [w.songkhla], { column: "cancelled_at", value: "now()" });
    const old = await alert("watch", [w.yala1]);
    await db.query("update alerts set superseded_by = $1 where id = $2", [active, old]);

    await as(db, "anon");
    const seen = await rows<Record<string, unknown>>(db, "select * from public_alert_status()");
    expect(seen.map((r) => r.alert_id)).toEqual([active]);
    expect(seen[0]!.level).toBe("warning");
    expect(seen[0]!.tambons).toEqual([w.yala1, w.yala2].sort());
    expect(seen[0]!.reason).toBe("River rising at the test gauge");
    expect(seen[0]!.next_update_at).toBeInstanceOf(Date);
    expect(Object.keys(seen[0]!)).not.toContain("issued_by");
    expect(JSON.stringify(seen)).not.toContain(w.admin);
  });

  it("gives the expected windows as two ends of a range", async () => {
    await asOwner(db);
    await alert("warning", [w.yala1], {
      column: "expected_onset_window",
      value: "tstzrange(now() + interval '1 day', now() + interval '2 days')",
    });
    await as(db, "anon");
    const a = await one<{ onset_from: Date; onset_to: Date; return_from: Date | null }>(
      "select onset_from, onset_to, return_from from public_alert_status()",
    );
    expect(a.onset_to.getTime()).toBeGreaterThan(a.onset_from.getTime());
    expect(a.return_from).toBeNull();
  });
});

describe("report_hex_bins: counts per hexagon only (safety rule 6)", () => {
  const point = () =>
    one<{ lon: string; lat: string }>(
      `select extensions.st_x(extensions.st_geomfromtext($1, 4326))::text as lon,
              extensions.st_y(extensions.st_geomfromtext($1, 4326))::text as lat`,
      [w.yalaPoint],
    );

  it("a visitor cannot read reports, and pending reports are not counted", async () => {
    await as(db, "anon");
    // No policy lets a visitor read a report.
    const direct = await one<{ n: string }>("select count(*) as n from reports");
    expect(Number(direct.n)).toBe(0);
    expect(await rows(db, "select * from report_hex_bins()")).toEqual([]);
  });

  it("counts approved recent reports and gives only a hexagon, a count, a depth and an hour", async () => {
    await asOwner(db);
    await db.query("update reports set moderation_status = 'approved'");
    const add = (status: string, age: string, depth: string) =>
      db.query(
        `insert into reports (reporter_id, point, depth_ref, moderation_status, created_at)
         values ($1, extensions.st_geomfromtext($2, 4326), $3::depth_ref, $4::moderation_status,
                 now() - $5::interval)`,
        [w.otherUser, w.yalaPoint, depth, status, age],
      );
    await add("approved", "2 hours", "waist");
    await add("hidden", "1 hour", "roof");
    await add("pending", "1 hour", "roof");
    await add("approved", "5 days", "roof");

    await as(db, "anon");
    const bins = await rows<Record<string, unknown>>(db, "select * from report_hex_bins()");
    expect(bins).toHaveLength(1);
    const bin = bins[0]!;
    expect(Object.keys(bin).sort()).toEqual(["deepest", "hex", "latest", "reports"]);
    expect(bin.reports).toBe(2);
    expect(bin.deepest).toBe("waist");
    expect((bin.latest as Date).getUTCMinutes()).toBe(0);
    const hex = bin.hex as { type: string; coordinates: number[][][] };
    expect(hex.type).toBe("Polygon");
    expect(hex.coordinates[0]).toHaveLength(7);

    // The exact point and the reporter are nowhere in the answer.
    const p = await point();
    const text = JSON.stringify(bins);
    expect(text).not.toContain(p.lon.slice(0, 9));
    expect(text).not.toContain(p.lat.slice(0, 8));
    expect(text).not.toContain(w.otherUser);

    // About one square kilometre, so a single report is not pinned to a house.
    await asOwner(db);
    const { km2 } = await one<{ km2: number }>(
      `select extensions.st_area(extensions.st_geomfromgeojson($1)::extensions.geography) / 1e6 as km2`,
      [JSON.stringify(hex)],
    );
    expect(km2).toBeGreaterThan(0.8);
    expect(km2).toBeLessThan(1.1);
  });
});

describe("station_status: never 'normal' without levels or a recent reading", () => {
  it("compares the last reading with the station's levels", async () => {
    await asOwner(db);
    const station = async (
      code: string,
      watch: number | null,
      value: number | null,
      age: string,
    ) => {
      const { id } = await one<{ id: string }>(
        `insert into stations (source, code, name, point, watch_m, warning_m)
         values ('test', $1, '{"th": "สถานีทดสอบ"}', extensions.st_geomfromtext($2, 4326), $3::real, $3::real + 1)
         returning id`,
        [code, w.yalaPoint, watch],
      );
      if (value !== null) {
        await db.query(
          `insert into observations (station_id, ts, variable, value)
           values ($1, now() - $2::interval, 'water_level_msl', $3)`,
          [id, age, value],
        );
      }
    };
    await station("a-low", 3, 2.5, "1 hour");
    await station("b-watch", 3, 3.2, "1 hour");
    await station("c-warning", 3, 4.4, "1 hour");
    await station("d-old", 3, 2.5, "9 hours");
    await station("e-no-levels", null, 2.5, "1 hour");
    await station("f-no-data", 3, null, "1 hour");

    await as(db, "anon");
    const seen = await rows<{ status: string }>(
      db,
      "select status from station_status() where name ->> 'th' = 'สถานีทดสอบ'",
    );
    expect(seen.map((s) => s.status)).toEqual([
      "normal",
      "above_watch",
      "above_warning",
      "no_recent_data",
      "no_levels",
      "no_recent_data",
    ]);
  });
});

describe("areas", () => {
  it("locate_area names the tambon in a covered province", async () => {
    await as(db, "anon");
    const here = await one<{ tambon_code: string; province_code: string; province_status: string }>(
      `select * from locate_area(extensions.st_y(extensions.st_geomfromtext($1, 4326)),
                                 extensions.st_x(extensions.st_geomfromtext($1, 4326)))`,
      [w.yalaPoint],
    );
    expect(here.tambon_code).toBe(w.yala1);
    expect(here.province_code).toBe("95");
    expect(here.province_status).toBe("active");
  });

  it("gives only the province, marked coming soon, outside the covered provinces", async () => {
    await as(db, "anon");
    const bangkok = await rows<{ tambon_code: string | null; province_status: string }>(
      db,
      "select * from locate_area(13.7563, 100.5018)",
    );
    expect(bangkok).toHaveLength(1);
    expect(bangkok[0]!.tambon_code).toBeNull();
    expect(bangkok[0]!.province_status).toBe("coming_soon");
    expect(await rows(db, "select * from locate_area(6.5, 103.5)")).toEqual([]);
  });

  it("tambon_directory lists every tambon with a point inside it", async () => {
    await as(db, "anon");
    const { n, inside } = await one<{ n: string; inside: string }>(
      `select count(*) as n,
              count(*) filter (where extensions.st_intersects(
                t.geom_web, extensions.st_setsrid(extensions.st_makepoint(d.lon, d.lat), 4326))) as inside
       from tambon_directory() d join tambons t on t.code = d.code`,
    );
    const { total } = await one<{ total: string }>("select count(*) as total from tambons");
    expect(Number(n)).toBe(Number(total));
    // Rounded to about a metre, so a point on a very thin sliver may fall just outside.
    expect(Number(inside)).toBeGreaterThanOrEqual(Number(total) - 2);
  });
});

describe("safe_places_near", () => {
  it("lists places for people and car parking separately, without closed or rejected ones", async () => {
    await asOwner(db);
    const add = (name: string, type: string, extra = "") =>
      db.query(
        `insert into safe_places (name, type, point, score, status, verification_status)
         values (jsonb_build_object('th', $1::text), $2::safe_place_type,
                 extensions.st_translate(extensions.st_geomfromtext($3, 4326), 0.003, 0), 0.8,
                 $4::safe_place_status, $5::verification_status)`,
        [
          name,
          type,
          w.yalaPoint,
          extra === "closed" ? "closed" : "open",
          extra === "rejected" ? "rejected" : "verified",
        ],
      );
    await add("school", "school");
    await add("car park", "high_ground_parking");
    await add("closed mosque", "mosque", "closed");
    await add("rejected temple", "temple", "rejected");

    await as(db, "anon");
    const near = (parking: boolean) =>
      rows<{ name: { th: string }; distance_m: number; lat: number }>(
        db,
        `select * from safe_places_near(extensions.st_y(extensions.st_geomfromtext($1, 4326)),
                                        extensions.st_x(extensions.st_geomfromtext($1, 4326)), 3, $2)`,
        [w.yalaPoint, parking],
      );
    const people = await near(false);
    expect(people.map((p) => p.name.th)).toEqual(["school"]);
    expect(people[0]!.distance_m).toBeGreaterThan(200);
    expect(people[0]!.distance_m).toBeLessThan(500);
    expect((await near(true)).map((p) => p.name.th)).toEqual(["car park"]);
  });
});
