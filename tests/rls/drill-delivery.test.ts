/**
 * A10: a drill that is sent (the owner, 20 Oct).
 *
 * What these tests are really guarding:
 *  - the silent drill is exactly as it was: nobody outside the console sees it, nobody is told;
 *  - a sent drill is seen only by the audience it was sent to, and a drill to the teams is not
 *    readable by a resident or a visitor;
 *  - a sent drill never carries the template's instructions - the words are the drill's own, in
 *    all three languages, and say so in their first few characters;
 *  - no drill, sent or silent, moves tambon_level: nothing the rest of Jaga works from changes
 *    because a test was run (safety rules 2 and 3);
 *  - one person with a home and three watched places in the area is told once, not four times;
 *  - the audience is a thing only a drill can have.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;
let tpl: Record<string, string>;

const soon = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

async function publish(
  tambons: string[],
  extra: {
    drill?: boolean;
    audience?: string[];
    template?: string;
    channels?: string[];
  } = {},
): Promise<string> {
  const r = await rows<{ id: string }>(
    db,
    `select admin_publish_alert($1, $2, $3, null, null, null, null, null, null, $4, false, $5, $6)
            as id`,
    [
      extra.template ?? tpl.flood_warning,
      tambons,
      soon(3),
      extra.drill ?? true,
      extra.audience ?? [],
      extra.channels ?? ["push", "line"],
    ],
  );
  return r[0]!.id;
}

const seenBy = async (id: string) =>
  (await rows(db, "select 1 from alerts where id = $1", [id])).length;
const inPublicStatus = async (id: string) =>
  (await rows(db, "select 1 from public_alert_status() where alert_id = $1", [id])).length;
const inNotices = async (id: string, tambon: string) =>
  (await rows(db, "select 1 from public_notices($1) where id = $2", [[tambon], id])).length;

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
  tpl = Object.fromEntries(
    (await rows<{ code: string; id: string }>(db, "select code, id from alert_templates")).map(
      (r) => [r.code, r.id],
    ),
  );
});
afterEach(async () => {
  await db.query("rollback");
});

describe("the silent drill is untouched", () => {
  it("is still seen by nobody but an admin, and told to nobody", async () => {
    await as(db, { uid: w.admin });
    const id = await publish([w.yala1], { drill: true, audience: [] });
    expect(await seenBy(id)).toBe(1);

    for (const who of [w.requester, w.yalaRescue.user]) {
      await as(db, { uid: who });
      expect(await seenBy(id)).toBe(0);
      expect(await inPublicStatus(id)).toBe(0);
      expect(await inNotices(id, w.yala1)).toBe(0);
    }
    await as(db, "anon");
    expect(await seenBy(id)).toBe(0);

    // And nobody is told: both roads refuse it, as they always have.
    await as(db, { uid: w.admin });
    expect(await rows(db, "select * from push_targets_for_alert($1)", [id])).toHaveLength(0);
    expect(await rows(db, "select * from line_targets_for_alert($1)", [id])).toHaveLength(0);
  });
});

describe("a drill sent to everyone", () => {
  it("is read by a visitor, and says in every language that it is a drill", async () => {
    await as(db, { uid: w.admin });
    const id = await publish([w.yala1], { drill: true, audience: ["everyone"] });

    await as(db, "anon");
    expect(await inPublicStatus(id)).toBe(1);
    expect(await inNotices(id, w.yala1)).toBe(1);
    const [row] = await rows<{ drill: boolean }>(
      db,
      "select drill from public_alert_status() where alert_id = $1",
      [id],
    );
    expect(row!.drill).toBe(true);

    await asOwner(db);
    const [a] = await rows<{ messages: Record<string, string>; reason: string }>(
      db,
      "select messages, reason from alerts where id = $1",
      [id],
    );
    // The template's instructions are not in it anywhere, in any language.
    const [t] = await rows<{ messages: Record<string, string> }>(
      db,
      "select messages from alert_templates where id = $1",
      [tpl.flood_warning],
    );
    for (const locale of ["th", "ms", "en"]) {
      expect(a!.messages[locale]!.length).toBeGreaterThan(40);
      expect(a!.messages[locale]).not.toBe(t!.messages[locale]);
    }
    // And it says what it is in the first words, where a notification is cut off.
    expect(a!.messages.th!.slice(0, 20)).toContain("ซ้อม");
    expect(a!.messages.ms!.slice(0, 20)).toMatch(/LATIHAN/i);
    expect(a!.messages.en!.slice(0, 20)).toMatch(/DRILL/i);
    expect(a!.reason).toContain("ซ้อม");
  });
});

describe("a drill sent to the teams", () => {
  it("reaches the rescue team and nobody else", async () => {
    await as(db, { uid: w.admin });
    const id = await publish([w.yala1], { drill: true, audience: ["rescue"] });

    await as(db, { uid: w.yalaRescue.user });
    expect(await seenBy(id)).toBe(1);

    // A planning-only unit covering the same tambon is not a rescue team.
    await as(db, { uid: w.yalaPlanning.user });
    expect(await seenBy(id)).toBe(0);
    // Nor is an ordinary resident, nor a visitor.
    await as(db, { uid: w.requester });
    expect(await seenBy(id)).toBe(0);
    expect(await inPublicStatus(id)).toBe(0);
    await as(db, "anon");
    expect(await seenBy(id)).toBe(0);
  });

  it("goes to a covering team wherever they live, and not to a team elsewhere", async () => {
    await as(db, { uid: w.admin });
    const id = await publish([w.yala1], { drill: true, audience: ["rescue"] });
    const targets = await rows<{ user_id: string }>(
      db,
      "select u as user_id from drill_audience_users($1, $2) u",
      [["rescue"], [w.yala1]],
    );
    const ids = targets.map((t) => t.user_id);
    expect(ids).toContain(w.yalaRescue.user);
    // Songkhla's rescue team covers none of the chosen tambons.
    expect(ids).not.toContain(w.songkhlaRescue.user);
    // The planning unit is verified and covers the tambon, but is not a rescue team.
    expect(ids).not.toContain(w.yalaPlanning.user);
    expect(await seenBy(id)).toBe(1);
  });

  it("includes every verified unit when the audience is all units", async () => {
    const ids = (
      await rows<{ user_id: string }>(db, "select u as user_id from drill_audience_users($1, $2) u", [
        ["units"],
        [w.yala1],
      ])
    ).map((t) => t.user_id);
    expect(ids).toContain(w.yalaRescue.user);
    expect(ids).toContain(w.yalaPlanning.user);
    // A unit still waiting to be verified is never an audience.
    expect(ids).not.toContain(w.yalaPending.user);
  });
});

describe("what a drill may never do", () => {
  it("does not move the level the rest of Jaga works from", async () => {
    await as(db, { uid: w.admin });
    for (const audience of [[], ["everyone"], ["rescue"]]) {
      await db.query("savepoint drill");
      await publish([w.yala1], { drill: true, audience });
      await as(db, "anon");
      const [level] = await rows<{ level: string }>(db, "select tambon_level($1) as level", [
        w.yala1,
      ]);
      expect(level!.level).toBe("normal");
      await as(db, { uid: w.admin });
      await db.query("rollback to savepoint drill");
    }
    // A real alert of the same template does move it, so the test above is not vacuous.
    await publish([w.yala1], { drill: false, audience: [] });
    await as(db, "anon");
    const [level] = await rows<{ level: string }>(db, "select tambon_level($1) as level", [w.yala1]);
    expect(level!.level).toBe("warning");
  });

  it("cannot be an audience on a real alert", async () => {
    await as(db, { uid: w.admin });
    await expectDenied(
      db,
      `select admin_publish_alert($1, $2, $3, null, null, null, null, null, null, false, false, $4)`,
      [tpl.flood_warning, [w.yala1], soon(3), ["everyone"]],
    );
  });

  it("refuses an audience that is not one of the four", async () => {
    await as(db, { uid: w.admin });
    await expectDenied(
      db,
      `select admin_publish_alert($1, $2, $3, null, null, null, null, null, null, true, false, $4)`,
      [tpl.flood_warning, [w.yala1], soon(3), ["the_press"]],
    );
  });
});

describe("one person, one message", () => {
  it("tells somebody with a home and three watched places in the area exactly once", async () => {
    await asOwner(db);
    // The same person: home in yala1, and three places they watch, all in the alert's area.
    // home_tambon is derived from the point by a trigger, so the point is what is set.
    await db.query(
      `update profiles
          set home_point = extensions.st_setsrid(extensions.st_geomfromtext($1), 4326),
              line_user_id = $2
        where user_id = $3`,
      [w.yalaPoint, "U-one-person", w.requester],
    );
    for (const label of ["work", "mum", "school"]) {
      await db.query(
        `insert into saved_places (user_id, label, tambon, notify, point)
         values ($1, $2, $3, true,
                 extensions.st_setsrid(extensions.st_geomfromtext($4), 4326))`,
        [w.requester, label, w.yala1, w.yalaPoint],
      );
    }
    await db.query(
      `insert into push_subscriptions (user_id, endpoint, keys, tambons, locale)
       values ($1, 'https://fcm.googleapis.com/one-phone', '{"p256dh":"k","auth":"a"}', $2, 'th')`,
      [w.requester, [w.yala1]],
    );

    await as(db, { uid: w.admin });
    // Counted for this one person: the database also holds other accounts, and since 21 Oct
    // every account without a place of its own is told about every alert too.
    const ours = async (id: string) => ({
      push: (
        await rows<{ endpoint: string }>(db, "select * from push_targets_for_alert($1)", [id])
      ).filter((t) => t.endpoint === "https://fcm.googleapis.com/one-phone").length,
      line: (
        await rows<{ line_user_id: string }>(db, "select * from line_targets_for_alert($1)", [id])
      ).filter((t) => t.line_user_id === "U-one-person").length,
    });

    const real = await publish([w.yala1], { drill: false, audience: [] });
    // One device, one LINE account: four places are still one person.
    expect(await ours(real)).toEqual({ push: 1, line: 1 });

    const drill = await publish([w.yala1], { drill: true, audience: ["everyone"] });
    expect(await ours(drill)).toEqual({ push: 1, line: 1 });
  });
});

describe("everywhere people use Jaga", () => {
  it("names the tambons somebody lives in or watches, and is admin only", async () => {
    await asOwner(db);
    await db.query(
      `update profiles set home_point = extensions.st_setsrid(extensions.st_geomfromtext($1), 4326)
        where user_id = $2`,
      [w.yalaPoint, w.requester],
    );
    await db.query(
      `insert into saved_places (user_id, label, tambon, notify, point)
       values ($1, 'mum', $2, true, extensions.st_setsrid(extensions.st_geomfromtext($3), 4326))`,
      [w.otherUser, w.songkhla, w.songkhlaPoint],
    );

    await as(db, { uid: w.admin });
    const codes = (
      await rows<{ t: string }>(db, "select t from tambons_with_people() t")
    ).map((r) => r.t);
    expect(codes).toContain(w.yala1);
    expect(codes).toContain(w.songkhla);
    expect(codes).not.toContain(w.yala2);

    // It says where Jaga's users are, so it is for admins and nobody else.
    await as(db, { uid: w.requester });
    await expectDenied(db, "select t from tambons_with_people() t", []);
    await as(db, "anon");
    await expectDenied(db, "select t from tambons_with_people() t", []);
  });
});

describe("somebody who signed in and never chose a place", () => {
  /*
   * On jaga-dev 25 of 27 accounts are in this state, almost all of them LINE sign-ins, so this
   * is most of the audience rather than an edge of it (owner, 21 Oct).
   */
  beforeEach(async () => {
    await asOwner(db);
    // The fixture's requester has neither a home nor a watched place; give them LINE and a phone.
    await db.query("update profiles set line_user_id = $1 where user_id = $2", [
      "U-no-place",
      w.requester,
    ]);
    await db.query(
      `insert into push_subscriptions (user_id, endpoint, keys, tambons, locale)
       values ($1, 'https://fcm.googleapis.com/no-place', '{"p256dh":"k","auth":"a"}', '{}', 'th')`,
      [w.requester],
    );
  });

  it("is told about a real alert for an area they never named", async () => {
    await as(db, { uid: w.admin });
    const id = await publish([w.yala1], { drill: false, audience: [] });
    const push = await rows<{ endpoint: string }>(db, "select * from push_targets_for_alert($1)", [
      id,
    ]);
    const line = await rows<{ line_user_id: string; placeless: boolean }>(
      db,
      "select * from line_targets_for_alert($1)",
      [id],
    );
    expect(push.map((p) => p.endpoint)).toContain("https://fcm.googleapis.com/no-place");
    const theirs = line.find((l) => l.line_user_id === "U-no-place");
    expect(theirs).toBeDefined();
    // Marked, so the sender gives them the alert's real area and not "your area".
    expect(theirs!.placeless).toBe(true);
  });

  it("is told about a drill sent to everyone, and not about one sent to the teams", async () => {
    await as(db, { uid: w.admin });
    const everyone = await publish([w.yala1], { drill: true, audience: ["everyone"] });
    expect(
      (await rows<{ line_user_id: string }>(db, "select * from line_targets_for_alert($1)", [
        everyone,
      ])).map((l) => l.line_user_id),
    ).toContain("U-no-place");

    const teams = await publish([w.yala1], { drill: true, audience: ["rescue"] });
    expect(
      (await rows<{ line_user_id: string }>(db, "select * from line_targets_for_alert($1)", [
        teams,
      ])).map((l) => l.line_user_id),
    ).not.toContain("U-no-place");
  });

  it("is still told once, and the silent drill still tells nobody", async () => {
    await as(db, { uid: w.admin });
    const id = await publish([w.yala1], { drill: false, audience: [] });
    const mine = (
      await rows<{ line_user_id: string }>(db, "select * from line_targets_for_alert($1)", [id])
    ).filter((l) => l.line_user_id === "U-no-place");
    expect(mine).toHaveLength(1);

    const silent = await publish([w.yala1], { drill: true, audience: [] });
    expect(await rows(db, "select * from push_targets_for_alert($1)", [silent])).toHaveLength(0);
    expect(await rows(db, "select * from line_targets_for_alert($1)", [silent])).toHaveLength(0);
  });

  it("is not one of them if they saved a place and muted it", async () => {
    await asOwner(db);
    // A muted watched place is a choice to be left alone, not an absence of one: the LINE
    // suite caught this the day after the rule went in.
    await db.query(
      `insert into saved_places (user_id, label, tambon, notify, point)
       values ($1, 'quiet', $2, false,
               extensions.st_setsrid(extensions.st_geomfromtext($3), 4326))`,
      [w.requester, w.songkhla, w.songkhlaPoint],
    );
    await as(db, { uid: w.admin });
    const id = await publish([w.yala1], { drill: false, audience: [] });
    expect(
      (await rows<{ line_user_id: string }>(db, "select * from line_targets_for_alert($1)", [
        id,
      ])).map((l) => l.line_user_id),
    ).not.toContain("U-no-place");
  });

  it("stops being one of them as soon as they choose a place", async () => {
    await asOwner(db);
    await db.query(
      `update profiles set home_point = extensions.st_setsrid(extensions.st_geomfromtext($1), 4326)
        where user_id = $2`,
      [w.songkhlaPoint, w.requester],
    );
    await as(db, { uid: w.admin });
    // Their home is in Songkhla now, so a Yala alert is no longer theirs to hear.
    const id = await publish([w.yala1], { drill: false, audience: [] });
    expect(
      (await rows<{ line_user_id: string }>(db, "select * from line_targets_for_alert($1)", [
        id,
      ])).map((l) => l.line_user_id),
    ).not.toContain("U-no-place");
  });
});

describe("the roads an alert travels", () => {
  /*
   * LINE is metered and push is not, so an admin may send a drill down one road and not the
   * other (the owner, 21 Oct: "so for drill i don't need to lose Line quota"). The choice is
   * kept on the alert, not only acted on by the server, so nothing that asks later can spend
   * the quota that was declined.
   */
  beforeEach(async () => {
    await asOwner(db);
    await db.query("update profiles set line_user_id = $1 where user_id = $2", [
      "U-roads",
      w.requester,
    ]);
    await db.query(
      `insert into push_subscriptions (user_id, endpoint, keys, tambons, locale)
       values ($1, 'https://fcm.googleapis.com/roads', '{"p256dh":"k","auth":"a"}', '{}', 'th')`,
      [w.requester],
    );
  });

  it("spends no LINE quota on a drill sent by push alone", async () => {
    await as(db, { uid: w.admin });
    const id = await publish([w.yala1], {
      drill: true,
      audience: ["everyone"],
      channels: ["push"],
    });
    expect(await rows(db, "select * from line_targets_for_alert($1)", [id])).toHaveLength(0);
    expect(
      (await rows<{ endpoint: string }>(db, "select * from push_targets_for_alert($1)", [id])).map(
        (t) => t.endpoint,
      ),
    ).toContain("https://fcm.googleapis.com/roads");
  });

  it("holds the other way round too", async () => {
    await as(db, { uid: w.admin });
    const id = await publish([w.yala1], { drill: false, channels: ["line"] });
    expect(await rows(db, "select * from push_targets_for_alert($1)", [id])).toHaveLength(0);
    expect(
      (await rows<{ line_user_id: string }>(db, "select * from line_targets_for_alert($1)", [
        id,
      ])).map((t) => t.line_user_id),
    ).toContain("U-roads");
  });

  it("sends nothing at all when no road is ticked, and still publishes the alert", async () => {
    await as(db, { uid: w.admin });
    const id = await publish([w.yala1], { drill: false, channels: [] });
    expect(await rows(db, "select * from push_targets_for_alert($1)", [id])).toHaveLength(0);
    expect(await rows(db, "select * from line_targets_for_alert($1)", [id])).toHaveLength(0);
    // It is still a real alert: in force, and the public can read it.
    await as(db, "anon");
    expect(await inPublicStatus(id)).toBe(1);
  });

  it("leaves LINE out unless it is ticked (owner, 22 Oct: no paid LINE plan for now)", async () => {
    await asOwner(db);
    const [c] = await rows<{ d: string }>(
      db,
      `select column_default as d from information_schema.columns
        where table_schema = 'public' and table_name = 'alerts' and column_name = 'channels'`,
    );
    expect(c!.d).toContain("push");
    expect(c!.d).not.toContain("line");
  });

  it("keeps both roads when both are ticked, and refuses a road that is not one", async () => {
    await as(db, { uid: w.admin });
    const id = await publish([w.yala1], { drill: false });
    await asOwner(db);
    const [a] = await rows<{ channels: string[] }>(
      db,
      "select channels from alerts where id = $1",
      [id],
    );
    expect(a!.channels.sort()).toEqual(["line", "push"]);

    await as(db, { uid: w.admin });
    await expectDenied(
      db,
      `select admin_publish_alert($1, $2, $3, null, null, null, null, null, null, false, false,
                                  '{}', $4)`,
      [tpl.flood_warning, [w.yala1], soon(3), ["carrier_pigeon"]],
    );
  });
});
