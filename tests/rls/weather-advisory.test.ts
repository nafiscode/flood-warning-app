/**
 * A16, severe weather as a notification: who may ask, who is told, and what it will not do.
 *
 * What these tests are really guarding:
 *  - only Jaga's own server, holding the gate token, can list the places or record an advisory;
 *    a visitor, a resident and a rescue team cannot, and none of them can read the two tables;
 *  - an advisory reaches the phones that follow that tambon, once each;
 *  - the same weather is not said twice within the gap;
 *  - nothing is sent in the quiet hours of the night, and nothing is sent to a tambon that is
 *    under a Warning or an Evacuate, where the alert is the message (safety rules 2 and 3);
 *  - nothing here publishes or touches an alert.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

const TOKEN = "test-weather-token-0123456789abcdef0123";
const KEYS = JSON.stringify({ p256dh: "BPublicKeyOfThisBrowser", auth: "secret16" });
const PHONE = "https://fcm.googleapis.com/fcm/send/resident-phone";
const OTHER_PHONE = "https://web.push.apple.com/another-phone-abcdefgh";

/** 06:30 and 02:00 in Bangkok, so the night rule is tested whatever time the suite runs at. */
const MORNING = "2026-11-08 06:30+07";
const NIGHT = "2026-11-08 02:00+07";

type Owed = {
  advisory_id: string;
  endpoint: string;
  locale: string;
  kind: string;
  tambon_th: string;
  peak: number;
};

const push = (tambon: string, kind = "heavy_rain", at = MORNING, gap = 12) =>
  rows<Owed>(
    db,
    `select * from weather_advisory_push($1, $2, $3,
       '2026-11-08 14:00+07'::timestamptz, '2026-11-08 17:00+07'::timestamptz,
       18.4, 46.2, '2026-11-08 06:00+07'::timestamptz, $4, $5::timestamptz)`,
    [TOKEN, tambon, kind, gap, at],
  );

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
  await db.query(
    `insert into push_gate (id, token) values (true, $1)
     on conflict (id) do update set token = excluded.token`,
    [TOKEN],
  );
  // A resident's phone follows one tambon in Yala; another phone follows nothing.
  await as(db, "anon");
  await db.query("select push_subscribe($1, $2::jsonb, $3, 'th')", [PHONE, KEYS, [w.yala1]]);
  await db.query("select push_subscribe($1, $2::jsonb, '{}', 'en')", [OTHER_PHONE, KEYS]);
  await asOwner(db);
});
afterEach(async () => {
  await db.query("rollback");
});

describe("who may ask", () => {
  it("nobody without the server's token, whoever they are", async () => {
    for (const caller of ["anon", { uid: w.requester }, { uid: w.admin }] as const) {
      await as(db, caller);
      await expectDenied(db, "select * from weather_cells($1)", ["not-the-token-at-all-really"]);
      await expectDenied(db, "select * from weather_cells(null)");
      await expectDenied(
        db,
        `select * from weather_advisory_push($1, $2, 'heavy_rain', now(), now(), 1, 1, now())`,
        ["wrong-token", w.yala1],
      );
    }
    await asOwner(db);
  });

  it("no client can read the advisories or the log of what was sent", async () => {
    for (const caller of ["anon", { uid: w.requester }, { uid: w.yalaRescue.user }] as const) {
      await as(db, caller);
      await expectDenied(db, "select * from weather_advisories");
      await expectDenied(db, "select * from weather_push_log");
    }
    await asOwner(db);
  });
});

describe("what is asked about", () => {
  it("lists the tambons at least one phone follows, and no others", async () => {
    await as(db, "anon");
    const cells = await rows<{ tambon: string; followers: string; lat: number; lon: number }>(
      db,
      "select * from weather_cells($1, 300, $2::timestamptz)",
      [TOKEN, MORNING],
    );
    await asOwner(db);
    const mine = cells.find((c) => c.tambon === w.yala1);
    expect(mine).toBeTruthy();
    expect(Number(mine!.followers)).toBeGreaterThanOrEqual(1);
    // A point inside the four provinces, rounded: nothing exact about anybody's position.
    expect(mine!.lat).toBeGreaterThan(5.5);
    expect(mine!.lat).toBeLessThan(8);
    expect(String(mine!.lat)).toMatch(/^\d+(\.\d{1,2})?$/);
  });

  it("asks about nothing in the quiet hours of the night", async () => {
    await as(db, "anon");
    const cells = await rows(db, "select * from weather_cells($1, 300, $2::timestamptz)", [
      TOKEN,
      NIGHT,
    ]);
    await asOwner(db);
    expect(cells).toEqual([]);
  });
});

describe("one advisory", () => {
  it("goes to the phones that follow that tambon, once each", async () => {
    await as(db, "anon");
    const first = await push(w.yala1);
    const again = await push(w.yala1);
    await asOwner(db);
    expect(first.map((r) => r.endpoint)).toEqual([PHONE]);
    expect(first[0]!.kind).toBe("heavy_rain");
    expect(first[0]!.locale).toBe("th");
    expect(first[0]!.tambon_th).toBeTruthy();
    expect(Number(first[0]!.peak)).toBeCloseTo(18.4);
    // The same weather again inside the gap: recorded once, sent once.
    expect(again).toEqual([]);
    const kept = await rows<{ n: string }>(
      db,
      "select count(*) as n from weather_advisories where tambon = $1",
      [w.yala1],
    );
    expect(Number(kept[0]!.n)).toBe(1);
  });

  it("says a different kind of weather in its own right", async () => {
    await as(db, "anon");
    const rain = await push(w.yala1, "heavy_rain");
    const wind = await push(w.yala1, "wind");
    await asOwner(db);
    expect(rain).toHaveLength(1);
    expect(wind).toHaveLength(1);
  });

  it("is said again once the gap has passed", async () => {
    await as(db, "anon");
    await push(w.yala1, "heavy_rain", MORNING, 12);
    // Six hours later, with a gap of one hour: the weather is news again.
    const later = await push(w.yala1, "heavy_rain", "2026-11-08 12:30+07", 1);
    await asOwner(db);
    expect(later).toHaveLength(1);
  });

  it("is refused for a kind of weather Jaga does not send", async () => {
    await as(db, "anon");
    await expectDenied(
      db,
      `select * from weather_advisory_push($1, $2, 'fog', now(), now(), 1, 1, now())`,
      [TOKEN, w.yala1],
    );
    await asOwner(db);
  });

  it("is not sent in the night", async () => {
    await as(db, "anon");
    const nothing = await push(w.yala1, "heavy_rain", NIGHT);
    await asOwner(db);
    expect(nothing).toEqual([]);
  });
});

describe("the alert comes first", () => {
  it("is not sent to a tambon under a Warning, and that tambon is not even asked about", async () => {
    await asOwner(db);
    const alert = (
      await rows<{ id: string }>(
        db,
        `insert into alerts (level, reason, messages, issued_by, next_update_at)
         values ('warning', 'River rising', '{"th": "ระดับน้ำสูงขึ้น"}'::jsonb, $1,
                 now() + interval '6 hours')
         returning id`,
        [w.admin],
      )
    )[0]!.id;
    await db.query("insert into alert_tambons (alert_id, tambon) values ($1, $2)", [
      alert,
      w.yala1,
    ]);

    await as(db, "anon");
    const cells = await rows<{ tambon: string }>(
      db,
      "select * from weather_cells($1, 300, $2::timestamptz)",
      [TOKEN, MORNING],
    );
    const nothing = await push(w.yala1);
    await asOwner(db);
    expect(cells.map((c) => c.tambon)).not.toContain(w.yala1);
    expect(nothing).toEqual([]);
  });

  it("publishes nothing itself: no alert is created by any of this", async () => {
    const before = await rows<{ n: string }>(db, "select count(*) as n from alerts");
    await as(db, "anon");
    await push(w.yala1);
    await asOwner(db);
    const after = await rows<{ n: string }>(db, "select count(*) as n from alerts");
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});
