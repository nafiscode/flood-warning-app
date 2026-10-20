/**
 * Place checks (owner, 20 Oct): a verified team can say what a safe place is like now, but only
 * one that covers it. Every role is tried here, including the ones that must be refused.
 *
 * What is being guarded: a check writes a safe place's live status, which residents act on. The
 * record itself (name, capacity, position) is not writable here, a check never publishes an
 * alert (safety rule 2), and the point a check was sent from is personal data (rule 5).
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
  // The database already holds the pipeline's own candidates (supabase/seed/50_safe_places.sql).
  // These tests are about the rows they add, so the table is cleared first; the transaction is
  // rolled back afterwards, so nothing is lost.
  await db.query("delete from safe_places");
});
afterEach(async () => {
  await db.query("rollback");
});

const one = async <T>(sql: string, params: unknown[] = []) => (await rows<T>(db, sql, params))[0]!;

/** A safe place at the given tambon's own point. */
async function place(tambon: string, name = "Yala shelter") {
  await asOwner(db);
  return (
    await one<{ id: string }>(
      `insert into safe_places (name, type, point, tambon, capacity)
       select $1::jsonb, 'shelter', extensions.st_pointonsurface(geom), code, 120
         from tambons where code = $2 returning id`,
      [JSON.stringify({ th: name, en: name }), tambon],
    )
  ).id;
}

const SEND_SQL = `select place_check_send(p_place => $1, p_open => $2::safe_place_status,
       p_water => $3::place_water, p_road => $4::road_access, p_needs => $5,
       p_lat => $6, p_lon => $7)`;

const sendArgs = (placeId: string, open = "full", extra: Record<string, unknown> = {}) => [
  placeId,
  open,
  extra.water ?? null,
  extra.road ?? null,
  extra.needs ?? null,
  extra.lat ?? null,
  extra.lon ?? null,
];

const send = (placeId: string, open = "full", extra: Record<string, unknown> = {}) =>
  one<{ place_check_send: string }>(SEND_SQL, sendArgs(placeId, open, extra));



describe("place_check_send", () => {
  it("lets a verified team covering the place say what it is like now", async () => {
    const id = await place(w.yala1);
    await as(db, { uid: w.yalaRescue.user });
    await send(id, "full");
    await asOwner(db);
    const row = await one<{
      status: string;
      checked_source: string;
      checked_by_unit: string;
      checked_at: string;
    }>("select status, checked_source, checked_by_unit, checked_at from safe_places where id = $1", [
      id,
    ]);
    expect(row.status).toBe("full");
    expect(row.checked_source).toBe("team");
    expect(row.checked_by_unit).toBe(w.yalaRescue.id);
    expect(row.checked_at).not.toBeNull();
  });

  it("refuses a verified team that does not cover the place", async () => {
    const id = await place(w.yala1);
    await as(db, { uid: w.songkhlaRescue.user });
    expect(await expectDenied(db, SEND_SQL, sendArgs(id))).toBe("42501");
  });

  it("refuses a team whose unit is not verified yet", async () => {
    const id = await place(w.yala1);
    await as(db, { uid: w.yalaPending.user });
    expect(await expectDenied(db, SEND_SQL, sendArgs(id))).toBe("42501");
  });

  it("refuses an ordinary resident, for now", async () => {
    // Residents get their own flow in the later phase, and it will never write the status
    // directly the way a team's check does.
    const id = await place(w.yala1);
    await as(db, { uid: w.otherUser });
    expect(await expectDenied(db, SEND_SQL, sendArgs(id))).toBe("42501");
  });

  it("lets an admin check any place, and marks it as the admin's", async () => {
    const id = await place(w.songkhla);
    await as(db, { uid: w.admin });
    await send(id, "closed");
    await asOwner(db);
    const row = await one<{ status: string; checked_source: string; checked_by_unit: string | null }>(
      "select status, checked_source, checked_by_unit from safe_places where id = $1",
      [id],
    );
    expect(row.status).toBe("closed");
    expect(row.checked_source).toBe("admin");
    expect(row.checked_by_unit).toBeNull();
  });

  it("works out how far the sender was from the place", async () => {
    const id = await place(w.yala1);
    const at = await one<{ lat: number; lon: number }>(
      `select extensions.st_y(extensions.st_geomfromtext($1, 4326)) as lat,
              extensions.st_x(extensions.st_geomfromtext($1, 4326)) as lon`,
      [w.yalaPoint],
    );
    await as(db, { uid: w.yalaRescue.user });
    await send(id, "open", { lat: at.lat, lon: at.lon });
    await asOwner(db);
    const row = await one<{ distance_m: number | null }>(
      "select distance_m from place_checks where place_id = $1",
      [id],
    );
    // Standing on the place's own point: a few metres at most.
    expect(row.distance_m).not.toBeNull();
    expect(row.distance_m!).toBeLessThan(50);
  });

  it("keeps a note an admin wrote when a two-tap check says nothing about needs", async () => {
    const id = await place(w.yala1);
    await asOwner(db);
    await db.query("update safe_places set needs = 'drinking water' where id = $1", [id]);
    await as(db, { uid: w.yalaRescue.user });
    await send(id, "open");
    await asOwner(db);
    const row = await one<{ needs: string }>("select needs from safe_places where id = $1", [id]);
    expect(row.needs).toBe("drinking water");
  });

  it("writes every check to the audit log", async () => {
    const id = await place(w.yala1);
    await as(db, { uid: w.yalaRescue.user });
    await send(id, "full");
    await asOwner(db);
    const row = await one<{ action: string; actor: string }>(
      "select action, actor from audit_log where entity = 'safe_places' and entity_id = $1",
      [id],
    );
    expect(row.action).toBe("place_checked");
    expect(row.actor).toBe(w.yalaRescue.user);
  });

  it("keeps every check, so the history is not overwritten", async () => {
    const id = await place(w.yala1);
    await as(db, { uid: w.yalaRescue.user });
    await send(id, "open");
    await send(id, "full");
    await asOwner(db);
    const kept = await rows<{ open_state: string }>(
      db,
      "select open_state from place_checks where place_id = $1 order by created_at",
      [id],
    );
    expect(kept.map((r) => r.open_state)).toEqual(["open", "full"]);
  });

  it("cannot be written around, straight into the table", async () => {
    const id = await place(w.yala1);
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(
      db,
      `insert into place_checks (place_id, source, open_state) values ($1, 'admin', 'open')`,
      [id],
    );
  });
});

describe("authority_places", () => {
  it("gives a team the places it covers, and not the others", async () => {
    const mine = await place(w.yala1, "Yala shelter");
    await place(w.songkhla, "Songkhla shelter");
    await as(db, { uid: w.yalaRescue.user });
    const list = await rows<{ place_id: string }>(db, "select place_id from authority_places()");
    expect(list.map((r) => r.place_id)).toEqual([mine]);
  });

  it("puts the places nobody has been to first", async () => {
    const never = await place(w.yala1, "Never checked");
    const checked = await place(w.yala1, "Checked today");
    await as(db, { uid: w.yalaRescue.user });
    await send(checked, "open");
    const list = await rows<{ place_id: string }>(db, "select place_id from authority_places()");
    expect(list[0]!.place_id).toBe(never);
    expect(list[1]!.place_id).toBe(checked);
  });

  it("refuses a resident and a team that is not verified", async () => {
    await place(w.yala1);
    await as(db, { uid: w.otherUser });
    expect(await expectDenied(db, "select * from authority_places()")).toBe("42501");
    await as(db, { uid: w.yalaPending.user });
    expect(await expectDenied(db, "select * from authority_places()")).toBe("42501");
  });
});

describe("what a check is worth to a reader", () => {
  it("shortens the window when an alert is in force where the place is", async () => {
    const normal = await one<{ window: string }>(
      "select place_check_window(tambon_level($1)) as window",
      [w.yala1],
    );
    await asOwner(db);
    await db.query(
      `with a as (
         insert into alerts (hazard_type, level, reason, messages, issued_by, next_update_at)
         values ('flood', 'warning', 'test', '{"th": "x"}', $1, now() + interval '3 hours')
         returning id)
       insert into alert_tambons (alert_id, tambon) select id, $2 from a`,
      [w.admin, w.yala1],
    );
    const warned = await one<{ window: string }>(
      "select place_check_window(tambon_level($1)) as window",
      [w.yala1],
    );
    expect(normal.window).not.toEqual(warned.window);
    const hours = await one<{ h: number }>(
      "select extract(epoch from place_check_window('warning'))/3600 as h",
    );
    expect(Number(hours.h)).toBe(6);
  });

  it("tells a resident when the place was last checked, but never who", async () => {
    const id = await place(w.yala1);
    await as(db, { uid: w.yalaRescue.user });
    await send(id, "open");
    const at = await one<{ lat: number; lon: number }>(
      `select extensions.st_y(extensions.st_geomfromtext($1, 4326)) as lat,
              extensions.st_x(extensions.st_geomfromtext($1, 4326)) as lon`,
      [w.yalaPoint],
    );
    await as(db, "anon");
    const row = await one<Record<string, unknown>>(
      "select * from safe_places_near($1, $2, 5) where id = $3",
      [at.lat, at.lon, id],
    );
    expect(row.checked_at).not.toBeNull();
    expect(row.checked_source).toBe("team");
    expect(row.check_due_at).not.toBeNull();
    // Nothing in the public answer can say which team, or which person.
    expect(Object.keys(row)).not.toContain("checked_by_unit");
    expect(JSON.stringify(row)).not.toContain(w.yalaRescue.id);
  });

  it("never lets the public read a check row itself", async () => {
    const id = await place(w.yala1);
    await as(db, { uid: w.yalaRescue.user });
    await send(id, "open");
    await as(db, "anon");
    const seen = await rows(db, "select * from place_checks");
    expect(seen).toHaveLength(0);
  });

  it("lets a team read the checks on places it covers, and not others'", async () => {
    const mine = await place(w.yala1);
    const theirs = await place(w.songkhla);
    await as(db, { uid: w.songkhlaRescue.user });
    await send(theirs, "open");
    await as(db, { uid: w.yalaRescue.user });
    await send(mine, "open");
    const seen = await rows<{ place_id: string }>(db, "select place_id from place_checks");
    expect(seen.map((r) => r.place_id)).toEqual([mine]);
  });
});
