/** Watched places: watching places for others (spec 4.9). */
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

const count = async (sql: string, params: unknown[] = []) =>
  Number((await rows<{ n: string }>(db, `select count(*) as n from (${sql}) q`, params))[0]!.n);

/** otherUser watches "Mum's house" in Yala, with Mum's phone. */
async function watchMum(): Promise<string> {
  await as(db, { uid: w.otherUser });
  return (
    await rows<{ id: string }>(
      db,
      `insert into saved_places (user_id, label, point, contact_name, contact_phone, contact_consent_at)
       values ($1, 'Mum''s house', extensions.st_geomfromtext($2, 4326), 'Mum', '66877777777', now())
       returning id`,
      [w.otherUser, w.yalaPoint],
    )
  )[0]!.id;
}

describe("watched places", () => {
  it("derive their tambon from the pin, whatever the client sends", async () => {
    await as(db, { uid: w.otherUser });
    const [p] = await rows<{ tambon: string }>(
      db,
      `insert into saved_places (user_id, label, point, tambon)
       values ($1, 'Mum', extensions.st_geomfromtext($2, 4326), $3) returning tambon`,
      [w.otherUser, w.yalaPoint, w.songkhla],
    );
    expect(p!.tambon).toBe(w.yala1);
  });

  it("allow up to 10 per user", async () => {
    await as(db, { uid: w.otherUser });
    for (let i = 1; i <= 10; i++) {
      await db.query(
        "insert into saved_places (user_id, label, point) values ($1, $2, extensions.st_geomfromtext($3, 4326))",
        [w.otherUser, `Place ${i}`, w.yalaPoint],
      );
    }
    expect(
      await expectDenied(
        db,
        "insert into saved_places (user_id, label, point) values ($1, 'Eleven', extensions.st_geomfromtext($2, 4326))",
        [w.otherUser, w.yalaPoint],
      ),
    ).toBe("23514");
  });

  it("need the person's consent to store their phone", async () => {
    await as(db, { uid: w.otherUser });
    expect(
      await expectDenied(
        db,
        `insert into saved_places (user_id, label, point, contact_phone)
         values ($1, 'Mum', extensions.st_geomfromtext($2, 4326), '66877777777')`,
        [w.otherUser, w.yalaPoint],
      ),
    ).toBe("23514");
  });

  it("and the stored phone are private to the user: not other users, authorities or admins", async () => {
    await watchMum();
    expect(await count("select 1 from saved_places")).toBe(1);
    for (const uid of [w.requester, w.yalaRescue.user, w.admin, w.superAdmin]) {
      await as(db, { uid });
      expect(await count("select 1 from saved_places")).toBe(0);
    }
    await as(db, "anon");
    expect(await count("select 1 from saved_places")).toBe(0);
  });
});

describe("household for someone at a watched place", () => {
  it("can be registered at the user's own watched place, not someone else's", async () => {
    const mum = await watchMum();
    await db.query(
      `insert into households (owner_id, saved_place_id, on_behalf_of_other, point, vulnerable, consent_at)
       values ($1, $2, true, extensions.st_geomfromtext($3, 4326), '{"bedridden": 1}', now())`,
      [w.otherUser, mum, w.yalaPoint],
    );
    // The requester can't attach a household to otherUser's place.
    await as(db, { uid: w.requester });
    await expectDenied(
      db,
      `insert into households (owner_id, saved_place_id, on_behalf_of_other, point, consent_at)
       values ($1, $2, true, extensions.st_geomfromtext($3, 4326), now())`,
      [w.requester, mum, w.yalaPoint],
    );
    // A rescue unit covering Yala sees both households there (logged), like any household.
    await as(db, { uid: w.yalaRescue.user });
    expect(await count("select * from households_in_tambon($1)", [w.yala1])).toBe(2);
  });
});

describe("SOS", () => {
  it("gets its tambon from the location, so a client can't route it to another area", async () => {
    await asOwner(db);
    const [s] = await rows<{ tambon: string }>(
      db,
      `insert into sos_requests (point, tambon) values (extensions.st_geomfromtext($1, 4326), $2) returning tambon`,
      [w.yalaPoint, w.songkhla],
    );
    expect(s!.tambon).toBe(w.yala1);
  });

  it("sent on someone's behalf reveals both phones to the covering authority, logged", async () => {
    await asOwner(db);
    const [s] = await rows<{ id: string }>(
      db,
      `insert into sos_requests (requester_id, on_behalf, on_behalf_note, point)
       values ($1, true, 'my mother, bedridden', extensions.st_geomfromtext($2, 4326)) returning id`,
      [w.otherUser, w.yalaPoint],
    );
    await db.query(
      "insert into sos_contacts (sos_id, contact_phone, on_site_phone) values ($1, '66822222222', '66877777777')",
      [s!.id],
    );
    await as(db, { uid: w.yalaRescue.user });
    const [c] = await rows(db, "select * from reveal_sos_contacts($1)", [s!.id]);
    expect(c).toEqual({ contact_phone: "66822222222", on_site_phone: "66877777777" });
    await as(db, { uid: w.songkhlaRescue.user });
    expect(await expectDenied(db, "select * from reveal_sos_contacts($1)", [s!.id])).toBe("42501");
    await asOwner(db);
    expect(
      await count("select 1 from audit_log where action = 'reveal_phone' and entity_id = $1", [
        s!.id,
      ]),
    ).toBe(1);
  });
});

describe("alert recipients", () => {
  it("one row per user: home or any watched place with notifications on", async () => {
    await watchMum();
    await asOwner(db);
    await db.query(
      "update profiles set home_point = extensions.st_geomfromtext($2, 4326) where user_id = $1",
      [w.requester, w.yalaPoint],
    );
    const [a] = await rows<{ id: string }>(
      db,
      `insert into alerts (level, reason, messages, issued_by, next_update_at)
       values ('warning', 'test', '{"th": "x"}', $1, now() + interval '6 hours') returning id`,
      [w.admin],
    );
    await db.query("insert into alert_tambons (alert_id, tambon) values ($1, $2)", [
      a!.id,
      w.yala1,
    ]);
    const got = await rows<{
      user_id: string;
      home_affected: boolean;
      places: { label: string }[];
    }>(db, "select * from alert_recipients($1) order by home_affected desc", [a!.id]);
    expect(got.map((r) => [r.user_id, r.home_affected, r.places.map((p) => p.label)])).toEqual([
      [w.requester, true, []],
      [w.otherUser, false, ["Mum's house"]],
    ]);
    // Switching notifications off for the place removes it.
    await db.query("update saved_places set notify = false where user_id = $1", [w.otherUser]);
    expect(await count("select * from alert_recipients($1)", [a!.id])).toBe(1);
  });

  it("can't be called by clients", async () => {
    await as(db, { uid: w.admin });
    expect(await expectDenied(db, "select * from alert_recipients(gen_random_uuid())")).toBe(
      "42501",
    );
  });
});
