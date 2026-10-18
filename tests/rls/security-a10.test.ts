/**
 * A10 security review (docs/security-review-2026.md): each database fix, as the attacker would try
 * it. Safety rule 1 still holds in every case: a request for help is merged or created, never
 * refused.
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
});
afterEach(async () => {
  await db.query("rollback");
});

const one = async <T>(sql: string, params: unknown[] = []) => (await rows<T>(db, sql, params))[0]!;

type Sent = { sos_id: string; token: string | null; merged: boolean };

async function yalaLatLon() {
  return one<{ lat: number; lon: number }>(
    "select extensions.st_y(extensions.st_geomfromtext($1, 4326)) as lat, extensions.st_x(extensions.st_geomfromtext($1, 4326)) as lon",
    [w.yalaPoint],
  );
}

function send(opts: {
  lat: number;
  lon: number;
  device?: string | null;
  phone?: string | null;
  token?: string | null;
  battery?: number | null;
  text?: string | null;
}): Promise<Sent> {
  return one<Sent>(
    `select * from submit_sos(p_lat => $1, p_lon => $2, p_device_id => $3, p_phone => $4,
       p_token => $5, p_battery_pct => $6::smallint, p_location_text => $7)`,
    [
      opts.lat,
      opts.lon,
      opts.device ?? null,
      opts.phone ?? null,
      opts.token ?? null,
      opts.battery ?? null,
      opts.text ?? null,
    ],
  );
}

async function caseRow(id: string) {
  await asOwner(db);
  return one<{ lat: number; lon: number; requester_id: string | null; tambon: string | null }>(
    `select extensions.st_y(point) as lat, extensions.st_x(point) as lon, requester_id, tambon
       from sos_requests where id = $1`,
    [id],
  );
}

describe("a repeat SOS matched only by phone or device cannot move or take over a case", () => {
  it("someone who knows the sender's number cannot move the case or become its sender", async () => {
    const at = await yalaLatLon();
    await as(db, "anon");
    const victim = await send({ ...at, device: "victim-phone", phone: "66851234567" });

    // The attacker, signed in on their own phone, 300 m away, with the victim's number.
    await as(db, { uid: w.otherUser });
    const attack = await send({ lat: at.lat + 0.0027, lon: at.lon, phone: "66851234567" });
    expect(attack.merged).toBe(true);
    expect(attack.sos_id).toBe(victim.sos_id);
    expect(attack.token).toBeNull();

    const after = await caseRow(victim.sos_id);
    expect(after.lat).toBeCloseTo(at.lat, 6);
    expect(after.requester_id).toBeNull();
    // The attacker cannot read the case either.
    await as(db, { uid: w.otherUser });
    expect(
      await rows(db, "select * from sos_requests where id = $1", [victim.sos_id]),
    ).toHaveLength(0);
    await expectDenied(db, "select * from sos_timeline($1, null)", [victim.sos_id]);

    // The position was still kept, and the teams are told.
    await asOwner(db);
    const kept = await one<{ n: string }>(
      "select count(*) as n from sos_locations where sos_id = $1",
      [victim.sos_id],
    );
    expect(Number(kept.n)).toBe(2);
    const note = await one<{ note: string }>(
      "select note from sos_events where sos_id = $1 and event = 'repeat_merged'",
      [victim.sos_id],
    );
    expect(note.note).toMatch(/same phone or device, \d+ m from this case/);
  });

  it("a match by phone far from the case becomes a case of its own, still delivered", async () => {
    const at = await yalaLatLon();
    await as(db, "anon");
    const first = await send({ ...at, phone: "66851234568" });
    const far = await send({ lat: at.lat + 0.05, lon: at.lon, phone: "66851234568" });
    expect(far.merged).toBe(false);
    expect(far.sos_id).not.toBe(first.sos_id);
    expect(far.token).not.toBeNull();
    expect((await caseRow(first.sos_id)).lat).toBeCloseTo(at.lat, 6);
  });

  it("the same holds for a signed-in caller far away (the case has no account)", async () => {
    const at = await yalaLatLon();
    await as(db, "anon");
    const first = await send({ ...at, phone: "66851234569" });
    await as(db, { uid: w.otherUser });
    const far = await send({ lat: at.lat + 0.05, lon: at.lon, phone: "66851234569" });
    expect(far.sos_id).not.toBe(first.sos_id);
    const before = await caseRow(first.sos_id);
    expect(before.lat).toBeCloseTo(at.lat, 6);
    expect(before.requester_id).toBeNull();
  });

  it("the sender's own key still moves the case wherever they go", async () => {
    const at = await yalaLatLon();
    await as(db, "anon");
    const first = await send({ ...at, device: "own-phone" });
    const moved = await send({ lat: at.lat + 0.05, lon: at.lon, token: first.token });
    expect(moved.merged).toBe(true);
    expect(moved.sos_id).toBe(first.sos_id);
    expect((await caseRow(first.sos_id)).lat).toBeCloseTo(at.lat + 0.05, 6);
  });

  it("the same account still moves its own case", async () => {
    const at = await yalaLatLon();
    await as(db, { uid: w.otherUser });
    const first = await send({ ...at });
    const moved = await send({ lat: at.lat + 0.05, lon: at.lon });
    expect(moved.sos_id).toBe(first.sos_id);
    expect((await caseRow(first.sos_id)).lat).toBeCloseTo(at.lat + 0.05, 6);
  });
});

describe("submit_sos never refuses over a value that does not fit", () => {
  it("a battery of 500 % and a very long typed location are dropped or cut, not refused", async () => {
    const at = await yalaLatLon();
    await as(db, "anon");
    const sent = await send({ ...at, battery: 500, text: "x".repeat(2000) });
    expect(sent.sos_id).toBeTruthy();
    await asOwner(db);
    const row = await one<{ battery_pct: number | null; n: number }>(
      "select battery_pct, char_length(location_text) as n from sos_requests where id = $1",
      [sent.sos_id],
    );
    expect(row.battery_pct).toBeNull();
    expect(row.n).toBe(300);
  });
});

describe("reports go through submit_report only", () => {
  it("a reporter cannot insert directly, bring back a hidden report or change its date", async () => {
    await as(db, { uid: w.otherUser });
    await expectDenied(
      db,
      "insert into reports (reporter_id, point, tambon) values ($1, extensions.st_makepoint(101.28, 6.54), $2)",
      [w.otherUser, w.yala1],
    );
    await asOwner(db);
    const id = (
      await one<{ id: string }>(
        `insert into reports (reporter_id, point, tambon, moderation_status)
         values ($1, extensions.st_setsrid(extensions.st_makepoint(101.28, 6.54), 4326), $2, 'hidden') returning id`,
        [w.otherUser, w.yala1],
      )
    ).id;
    await as(db, { uid: w.otherUser });
    await expectDenied(db, "update reports set moderation_status = 'pending' where id = $1", [id]);
    await expectDenied(db, "update reports set created_at = '2099-01-01' where id = $1", [id]);
    // On a hidden report even the photos cannot change (nothing matches).
    const changed = await rows(db, "update reports set photos = '{}' where id = $1 returning id", [
      id,
    ]);
    expect(changed).toHaveLength(0);
  });

  it("a reporter can still add photos to their own pending report", async () => {
    await asOwner(db);
    const id = (
      await one<{ id: string }>(
        `insert into reports (reporter_id, point, tambon)
         values ($1, extensions.st_setsrid(extensions.st_makepoint(101.28, 6.54), 4326), $2) returning id`,
        [w.otherUser, w.yala1],
      )
    ).id;
    await as(db, { uid: w.otherUser });
    const changed = await rows(
      db,
      "update reports set photos = array[$1 || '/a.jpg'] where id = $1::uuid returning id",
      [id],
    );
    expect(changed).toHaveLength(1);
  });
});

describe("teams change claims only through the dispatch functions", () => {
  it("a verified team cannot insert or rewrite a claim directly", async () => {
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(db, "insert into sos_claims (sos_id, unit_id) values ($1, $2)", [
      w.yalaSos,
      w.yalaRescue.id,
    ]);
    await asOwner(db);
    await db.query("insert into sos_claims (sos_id, unit_id) values ($1, $2)", [
      w.yalaSos,
      w.yalaRescue.id,
    ]);
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(
      db,
      "update sos_claims set completed_at = now() - interval '2 days' where sos_id = $1",
      [w.yalaSos],
    );
  });
});

describe("household phones only through the logged reveal", () => {
  it("the old bulk read is closed to everyone", async () => {
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(db, "select * from households_in_tambon($1)", [w.yala1]);
  });
});

describe("another unit's POC phone", () => {
  it("is never shown for a unit still waiting for verification", async () => {
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(db, "select * from reveal_poc_phone($1)", [w.yalaPending.id]);
  });

  it("is still shown, and logged, for a verified unit in shared coverage", async () => {
    await as(db, { uid: w.yalaRescue.user });
    const got = await rows<{ poc_phone: string }>(db, "select * from reveal_poc_phone($1)", [
      w.yalaPlanning.id,
    ]);
    expect(got).toHaveLength(1);
  });
});

describe("the limit on admin email links", () => {
  it("only Jaga's server can ask, so nobody can use up an admin's allowance directly", async () => {
    await as(db, "anon");
    await expectDenied(db, "select email_link_allowed('not-the-token', 'admin@example.org', null)");
  });

  it("allows 5 links an hour to one address, then says no", async () => {
    await asOwner(db);
    await db.query(
      "insert into push_gate (token, site_url) values ('a10-test-gate-token-0123456789-abcdefghij', 'https://example.org') on conflict do nothing",
    );
    const gate = (await one<{ token: string }>("select token from push_gate limit 1")).token;
    await as(db, "anon");
    const answers: boolean[] = [];
    for (let i = 0; i < 6; i += 1) {
      answers.push(
        (
          await one<{ ok: boolean }>(
            "select email_link_allowed($1, 'limit-test@example.org', null) as ok",
            [gate],
          )
        ).ok,
      );
    }
    expect(answers).toEqual([true, true, true, true, true, false]);
  });
});

describe("the limit on tries at an admin's sign-in code", () => {
  it("only Jaga's server can ask, so nobody can use up an admin's tries directly", async () => {
    await as(db, "anon");
    await expectDenied(db, "select email_code_allowed('not-the-token', 'admin@example.org', null)");
  });

  it("allows 10 tries an hour at one address, then says no", async () => {
    await asOwner(db);
    await db.query(
      "insert into push_gate (token, site_url) values ('a10-test-gate-token-0123456789-abcdefghij', 'https://example.org') on conflict do nothing",
    );
    const gate = (await one<{ token: string }>("select token from push_gate limit 1")).token;
    await as(db, "anon");
    const answers: boolean[] = [];
    for (let i = 0; i < 11; i += 1) {
      answers.push(
        (
          await one<{ ok: boolean }>(
            "select email_code_allowed($1, 'code-limit-test@example.org', null) as ok",
            [gate],
          )
        ).ok,
      );
    }
    expect(answers.slice(0, 10)).toEqual(Array.from({ length: 10 }, () => true));
    expect(answers[10]).toBe(false);
  });

  it("counts the tries apart from the links, so a mistyped code never blocks a new link", async () => {
    await asOwner(db);
    await db.query(
      "insert into push_gate (token, site_url) values ('a10-test-gate-token-0123456789-abcdefghij', 'https://example.org') on conflict do nothing",
    );
    const gate = (await one<{ token: string }>("select token from push_gate limit 1")).token;
    await as(db, "anon");
    const ip = "198.51.100.77";
    for (let i = 0; i < 10; i += 1) {
      await one("select email_code_allowed($1, 'apart-test@example.org', $2::inet) as ok", [
        gate,
        ip,
      ]);
    }
    const link = await one<{ ok: boolean }>(
      "select email_link_allowed($1, 'apart-test@example.org', $2::inet) as ok",
      [gate, ip],
    );
    expect(link.ok).toBe(true);
  });
});

describe("no client role can empty a table", () => {
  it("anon and signed-in people hold no TRUNCATE anywhere in public", async () => {
    await asOwner(db);
    const held = await rows(
      db,
      `select table_name, grantee from information_schema.role_table_grants
        where table_schema = 'public' and privilege_type = 'TRUNCATE'
          and grantee in ('anon', 'authenticated')`,
    );
    expect(held).toEqual([]);
  });
});
