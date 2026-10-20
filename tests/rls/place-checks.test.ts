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

const RESIDENT_SQL = `select place_check_resident(p_place => $1, p_open => $2::safe_place_status,
     p_water => $3::place_water, p_road => $4::road_access, p_note => $5,
     p_lat => $6, p_lon => $7)`;
const residentArgs = (placeId: string, open = "closed", extra: Record<string, unknown> = {}) => [
  placeId,
  open,
  extra.water ?? null,
  extra.road ?? null,
  extra.note ?? null,
  extra.lat ?? null,
  extra.lon ?? null,
];
const saySomething = (placeId: string, open = "closed", extra: Record<string, unknown> = {}) =>
  one<{ place_check_resident: string }>(RESIDENT_SQL, residentArgs(placeId, open, extra));

/**
 * A resident's own check, sent from the place's pin on the map (the owner, 20 Oct). The rule
 * these tests exist for: it can tell everybody and it can reach the covering team, but it can
 * never move the status on the card.
 */
describe("place_check_resident", () => {
  it("lets a signed-in resident say what a place is like", async () => {
    const id = await place(w.yala1);
    await as(db, { uid: w.otherUser });
    await saySomething(id, "closed");
    await asOwner(db);
    const row = await one<{ source: string; open_state: string; author_id: string }>(
      "select source, open_state, author_id from place_checks where place_id = $1",
      [id],
    );
    expect(row.source).toBe("resident");
    expect(row.open_state).toBe("closed");
    expect(row.author_id).toBe(w.otherUser);
  });

  it("never moves the status where a team covers the area, however many people say so", async () => {
    // The whole point. A false "closed" turns people away from a dry shelter and a false "open"
    // sends somebody into a flooded one, so only an admin or a covering team writes this.
    const id = await place(w.yala1);
    await asOwner(db);
    await db.query("update safe_places set status = 'open' where id = $1", [id]);
    for (const uid of [w.otherUser, w.requester]) {
      await as(db, { uid });
      await saySomething(id, "closed");
    }
    await asOwner(db);
    const row = await one<{ status: string; checked_at: string | null; checked_source: string | null }>(
      "select status, checked_at, checked_source from safe_places where id = $1",
      [id],
    );
    expect(row.status).toBe("open");
    expect(row.checked_at).toBeNull();
    expect(row.checked_source).toBeNull();
  });

  it("refuses a visitor who is not signed in", async () => {
    const id = await place(w.yala1);
    await as(db, "anon");
    expect(await expectDenied(db, RESIDENT_SQL, residentArgs(id))).toBe("42501");
  });

  it("refuses a second check on the same place straight away", async () => {
    const id = await place(w.yala1);
    await as(db, { uid: w.otherUser });
    await saySomething(id, "closed");
    expect(await expectDenied(db, RESIDENT_SQL, residentArgs(id, "open"))).toBe("P0003");
  });

  it("refuses 'unknown', which is not a check", async () => {
    const id = await place(w.yala1);
    await as(db, { uid: w.otherUser });
    expect(await expectDenied(db, RESIDENT_SQL, residentArgs(id, "unknown"))).toBe("23514");
  });
});

describe("what residents said, as the public sees it", () => {
  it("counts people and not rows, and says nothing about who they are", async () => {
    const id = await place(w.yala1);
    for (const uid of [w.otherUser, w.requester]) {
      await as(db, { uid });
      await saySomething(id, "full");
    }
    await asOwner(db);
    const said = await one<{ said: Record<string, unknown> }>(
      "select residents_said(sp) as said from safe_places sp where sp.id = $1",
      [id],
    );
    expect(said.said.people).toBe(2);
    expect((said.said.counts as Record<string, number>).full).toBe(2);
    const json = JSON.stringify(said.said);
    expect(json).not.toContain(w.otherUser);
    expect(json).not.toContain(w.requester);
  });

  it("calls it disputed only when two people disagree with the card, never one", async () => {
    const id = await place(w.yala1);
    await asOwner(db);
    await db.query("update safe_places set status = 'open' where id = $1", [id]);
    const disputed = async () =>
      (
        await one<{ d: boolean }>(
          "select (residents_said(sp) ->> 'disputed')::boolean as d from safe_places sp where sp.id = $1",
          [id],
        )
      ).d;
    await as(db, { uid: w.otherUser });
    await saySomething(id, "closed");
    await asOwner(db);
    expect(await disputed()).toBe(false);
    await as(db, { uid: w.requester });
    await saySomething(id, "closed");
    await asOwner(db);
    expect(await disputed()).toBe(true);
  });

  it("reaches the covering team's round list, at the top of it", async () => {
    const quiet = await place(w.yala1, "Nobody has been");
    const disputed = await place(w.yala1, "Residents disagree");
    await asOwner(db);
    await db.query("update safe_places set status = 'open' where id = $1", [disputed]);
    for (const uid of [w.otherUser, w.requester]) {
      await as(db, { uid });
      await saySomething(disputed, "closed");
    }
    await as(db, { uid: w.yalaRescue.user });
    const list = await rows<{ place_id: string; residents_said: Record<string, unknown> | null }>(
      db,
      "select place_id, residents_said from authority_places()",
    );
    // Above even a place nobody has ever been to: two people disagreeing is the thing a team
    // can act on today.
    expect(list[0]!.place_id).toBe(disputed);
    expect(list[0]!.residents_said?.people).toBe(2);
    expect(list.map((r) => r.place_id)).toContain(quiet);
  });

  it("is nothing at all when nobody has said anything", async () => {
    const id = await place(w.yala1);
    await asOwner(db);
    const said = await one<{ said: unknown }>(
      "select residents_said(sp) as said from safe_places sp where sp.id = $1",
      [id],
    );
    expect(said.said).toBeNull();
  });
});

/**
 * Where nobody covers the tambon, the person standing there writes the status (the owner,
 * 20 Oct: "if no team then should directly update, no check"). This supersedes the rule above
 * for unteamed tambons only. w.yala2 has no coverage in the fixtures; w.yala1 has yalaRescue.
 */
describe("a tambon with no team", () => {
  it("has no covering team, where yala1 does", async () => {
    // Read as the owner, as place_check_resident does. A resident may not ask this question at
    // all: coverage is readable only by teams and admins (spec 9), so the function keeps the
    // caller's own view and execute is revoked from clients - the next test is that revoke.
    await asOwner(db);
    const seen = await one<{ a: boolean; b: boolean }>(
      "select has_covering_team($1) as a, has_covering_team($2) as b",
      [w.yala1, w.yala2],
    );
    expect(seen.a).toBe(true);
    expect(seen.b).toBe(false);
  });

  it("will not tell a signed-in person, or a visitor, which tambons have nobody", async () => {
    // Otherwise this is a map of where no team is watching, which section 9 keeps to teams and
    // admins. The visitor half is here because the first revoke missed the default PUBLIC grant
    // that `create function` makes, so the question was answerable by anybody at all.
    await as(db, { uid: w.otherUser });
    expect(await expectDenied(db, "select has_covering_team($1)", [w.yala1])).toBe("42501");
    await as(db, "anon");
    expect(await expectDenied(db, "select has_covering_team($1)", [w.yala1])).toBe("42501");
  });

  it("lets a resident's check write the status, marked as a resident's", async () => {
    const id = await place(w.yala2, "Unteamed shelter");
    await asOwner(db);
    await db.query("update safe_places set status = 'open' where id = $1", [id]);
    await as(db, { uid: w.otherUser });
    await saySomething(id, "full");
    await asOwner(db);
    const row = await one<{
      status: string;
      checked_source: string;
      checked_by_unit: string | null;
      checked_at: string | null;
    }>(
      "select status, checked_source, checked_by_unit, checked_at from safe_places where id = $1",
      [id],
    );
    expect(row.status).toBe("full");
    // Never dressed up as a team's or Jaga's word: the card says who said it.
    expect(row.checked_source).toBe("resident");
    expect(row.checked_by_unit).toBeNull();
    expect(row.checked_at).not.toBeNull();
  });

  it("writes that it set the status, so there is a trail", async () => {
    const id = await place(w.yala2);
    await as(db, { uid: w.otherUser });
    await saySomething(id, "closed");
    await asOwner(db);
    const seen = await rows<{ action: string }>(
      db,
      "select action from audit_log where entity = 'safe_places' and entity_id = $1 order by action",
      [id],
    );
    expect(seen.map((r) => r.action)).toContain("place_status_by_resident");
    expect(seen.map((r) => r.action)).toContain("place_checked");
  });

  it("stops writing the status as soon as a team covers the tambon", async () => {
    const id = await place(w.yala2);
    await asOwner(db);
    await db.query("update safe_places set status = 'open' where id = $1", [id]);
    await db.query(
      `insert into authority_coverage (unit_id, tambon, selected_level, selected_code)
       values ($1, $2, 'tambon', $2)`,
      [w.yalaRescue.id, w.yala2],
    );
    await as(db, { uid: w.otherUser });
    await saySomething(id, "closed");
    await asOwner(db);
    const row = await one<{ status: string; checked_source: string | null }>(
      "select status, checked_source from safe_places where id = $1",
      [id],
    );
    expect(row.status).toBe("open");
    expect(row.checked_source).toBeNull();
  });

  it("KEEPS a place a resident closed in the top three, and still drops one an admin closed", async () => {
    // Without this, one person could take the only shelter in an unteamed tambon off the list
    // with nobody to put it back. The card says "closed, reported by someone there"; the reader
    // decides. A team's or an admin's "closed" still removes it, as before.
    const byResident = await place(w.yala2, "Closed by a resident");
    const byAdmin = await place(w.yala2, "Closed by an admin");
    await as(db, { uid: w.otherUser });
    await saySomething(byResident, "closed");
    await as(db, { uid: w.admin });
    await one(
      `select place_check_send(p_place => $1, p_open => 'closed'::safe_place_status,
         p_water => null, p_road => null, p_needs => null, p_lat => null, p_lon => null)`,
      [byAdmin],
    );
    const at = await one<{ lat: number; lon: number }>(
      `select extensions.st_y(extensions.st_pointonsurface(geom)) as lat,
              extensions.st_x(extensions.st_pointonsurface(geom)) as lon
         from tambons where code = $1`,
      [w.yala2],
    );
    await as(db, "anon");
    const near = await rows<{ id: string; status: string }>(
      db,
      "select id, status from safe_places_near($1, $2, 20)",
      [at.lat, at.lon],
    );
    const ids = near.map((r) => r.id);
    expect(ids).toContain(byResident);
    expect(ids).not.toContain(byAdmin);
    expect(near.find((r) => r.id === byResident)!.status).toBe("closed");
  });
});
