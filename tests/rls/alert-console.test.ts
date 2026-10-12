/**
 * A6: the alert console.
 *
 * What these tests are really guarding:
 *  - only an admin publishes, and always as themselves (safety rule 2);
 *  - the words come from the reviewed template, never from the caller;
 *  - a drill is invisible to everyone but admins, whichever way the public reads alerts, while a
 *    real alert is in the public answer the moment it is published;
 *  - Evacuate needs its second yes; an alert always has tambons and a next-update time;
 *  - a drill cannot take a real alert off the map;
 *  - every act is in the log.
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
  template: string,
  tambons: string[],
  extra: { drill?: boolean; supersedes?: string; confirm?: boolean; note?: string } = {},
): Promise<string> {
  const r = await rows<{ id: string }>(
    db,
    `select admin_publish_alert($1, $2, $3, $4, null, null, null, null, $5, $6, $7) as id`,
    [
      template,
      tambons,
      soon(3),
      extra.note ?? null,
      extra.supersedes ?? null,
      extra.drill ?? false,
      extra.confirm ?? false,
    ],
  );
  return r[0]!.id;
}

const inPublicStatus = async (id: string) =>
  (await rows(db, "select 1 from public_alert_status() where alert_id = $1", [id])).length;

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

describe("publishing", () => {
  it("is refused to everyone but admins", async () => {
    const call = `select admin_publish_alert($1, $2, $3)`;
    const args = [tpl.flood_watch, [w.yala1], soon(3)];
    await as(db, "anon");
    await expectDenied(db, call, args);
    await as(db, { uid: w.requester });
    await expectDenied(db, call, args);
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(db, call, args);
  });

  it("builds the three languages from the template, names the area, and signs as the caller", async () => {
    await as(db, { uid: w.admin });
    const id = await publish(tpl.flood_watch!, [w.yala1, w.yala2], { note: "ฝน 180 มม." });
    await asOwner(db);
    const [a] = await rows<{
      level: string;
      reason: string;
      messages: Record<string, string>;
      issued_by: string;
      is_drill: boolean;
    }>(db, "select level, reason, messages, issued_by, is_drill from alerts where id = $1", [id]);
    expect(a!.level).toBe("watch");
    expect(a!.issued_by).toBe(w.admin);
    expect(a!.is_drill).toBe(false);
    expect(a!.reason).toContain("ฝน 180 มม.");
    for (const locale of ["th", "ms", "en"]) {
      expect(a!.messages[locale]!.length).toBeGreaterThan(20);
      expect(a!.messages[locale]).not.toContain("{area}");
    }
    expect(a!.messages.th).toContain("ต.");
    expect(a!.messages.reason_ms).toContain("ฝน 180 มม.");
    expect(a!.messages.reason_en).toMatch(/^Heavy rain/);

    const log = await rows(
      db,
      "select 1 from audit_log where action = 'alert_published' and entity_id = $1 and actor = $2",
      [id, w.admin],
    );
    expect(log).toHaveLength(1);
  });

  it("puts a real alert in the public answer at once", async () => {
    await as(db, { uid: w.admin });
    const id = await publish(tpl.flood_warning!, [w.yala1]);
    await as(db, "anon");
    expect(await inPublicStatus(id)).toBe(1);
    const notices = await rows(db, "select 1 from public_notices($1) where id = $2", [
      [w.yala1],
      id,
    ]);
    expect(notices).toHaveLength(1);
  });

  it("refuses Evacuate without its second confirmation", async () => {
    await as(db, { uid: w.admin });
    await expectDenied(
      db,
      "select admin_publish_alert($1, $2, $3, null, null, null, null, null, null, false, false)",
      [tpl.flood_evacuate, [w.yala1], soon(2)],
    );
    const id = await publish(tpl.flood_evacuate!, [w.yala1], { confirm: true });
    expect(id).toMatch(/-/);
  });

  it("refuses an alert without an area, with an unknown area, or without a sane next update", async () => {
    await as(db, { uid: w.admin });
    const call = "select admin_publish_alert($1, $2, $3)";
    await expectDenied(db, call, [tpl.flood_watch, [], soon(3)]);
    await expectDenied(db, call, [tpl.flood_watch, [w.yala1, "999999"], soon(3)]);
    await expectDenied(db, call, [tpl.flood_watch, [w.yala1], soon(-1)]);
    await expectDenied(db, call, [tpl.flood_watch, [w.yala1], soon(24 * 8)]);
    await expectDenied(db, call, [tpl.flood_watch, [w.yala1], null]);
  });

  it("refuses a time window with one end or the wrong way round", async () => {
    await as(db, { uid: w.admin });
    await expectDenied(db, "select admin_publish_alert($1, $2, $3, null, $4, null)", [
      tpl.flood_watch,
      [w.yala1],
      soon(3),
      soon(5),
    ]);
    await expectDenied(db, "select admin_publish_alert($1, $2, $3, null, $4, $5)", [
      tpl.flood_watch,
      [w.yala1],
      soon(3),
      soon(9),
      soon(5),
    ]);
  });
});

describe("a drill", () => {
  it("is hidden from the public every way they read alerts, and shown to admins", async () => {
    await as(db, { uid: w.admin });
    const id = await publish(tpl.flood_warning!, [w.yala1], { drill: true });

    for (const caller of ["anon", { uid: w.requester }, { uid: w.yalaRescue.user }] as const) {
      await as(db, caller);
      expect(await inPublicStatus(id)).toBe(0);
      expect(
        await rows(db, "select 1 from public_notices($1) where id = $2", [[w.yala1], id]),
      ).toHaveLength(0);
      expect(await rows(db, "select 1 from alerts where id = $1", [id])).toHaveLength(0);
      expect(await rows(db, "select 1 from alert_tambons where alert_id = $1", [id])).toHaveLength(
        0,
      );
    }

    await as(db, { uid: w.admin });
    const mine = await rows<{ is_drill: boolean; tambons: string[] }>(
      db,
      "select is_drill, tambons from admin_alerts(500) where alert_id = $1",
      [id],
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]!.is_drill).toBe(true);
    expect(mine[0]!.tambons).toEqual([w.yala1]);
  });

  it("cannot replace a real alert, nor a real one a drill", async () => {
    await as(db, { uid: w.admin });
    const real = await publish(tpl.flood_watch!, [w.yala1]);
    const drill = await publish(tpl.flood_watch!, [w.yala2], { drill: true });
    await expectDenied(
      db,
      "select admin_publish_alert($1, $2, $3, null, null, null, null, null, $4, true)",
      [tpl.flood_warning, [w.yala1], soon(3), real],
    );
    await expectDenied(
      db,
      "select admin_publish_alert($1, $2, $3, null, null, null, null, null, $4, false)",
      [tpl.flood_warning, [w.yala2], soon(3), drill],
    );
    await as(db, "anon");
    expect(await inPublicStatus(real)).toBe(1);
  });
});

describe("after publishing", () => {
  it("superseding takes the old alert out of the public answer and links the two", async () => {
    await as(db, { uid: w.admin });
    const first = await publish(tpl.flood_watch!, [w.yala1]);
    const second = await publish(tpl.flood_warning!, [w.yala1, w.yala2], { supersedes: first });
    await as(db, "anon");
    expect(await inPublicStatus(first)).toBe(0);
    expect(await inPublicStatus(second)).toBe(1);

    await as(db, { uid: w.admin });
    const [old] = await rows<{ superseded_by: string; events: { action: string }[] }>(
      db,
      "select superseded_by, events from admin_alerts(500) where alert_id = $1",
      [first],
    );
    expect(old!.superseded_by).toBe(second);
    expect(old!.events.map((e) => e.action)).toEqual(["alert_published", "alert_superseded"]);
    // An alert already replaced cannot be replaced again.
    await expectDenied(
      db,
      "select admin_publish_alert($1, $2, $3, null, null, null, null, null, $4)",
      [tpl.flood_warning, [w.yala1], soon(3), first],
    );
  });

  it("extending moves only the next-update time and keeps the old one in the log", async () => {
    await as(db, { uid: w.admin });
    const id = await publish(tpl.flood_watch!, [w.yala1]);
    const later = soon(9);
    await db.query("select admin_extend_alert($1, $2, 'no change at the gauge')", [id, later]);
    await asOwner(db);
    const [a] = await rows<{ next_update_at: Date; level: string }>(
      db,
      "select next_update_at, level from alerts where id = $1",
      [id],
    );
    expect(a!.next_update_at.toISOString()).toBe(later);
    expect(a!.level).toBe("watch");
    const [log] = await rows<{ details: { from: string; note: string } }>(
      db,
      "select details from audit_log where action = 'alert_extended' and entity_id = $1",
      [id],
    );
    expect(log!.details.from).toBeTruthy();
    expect(log!.details.note).toBe("no change at the gauge");

    await as(db, { uid: w.requester });
    await expectDenied(db, "select admin_extend_alert($1, $2)", [id, soon(12)]);
  });

  it("cancelling ends it for the public, is logged, and cannot be done twice", async () => {
    await as(db, { uid: w.admin });
    const id = await publish(tpl.flood_watch!, [w.yala1]);
    await db.query("select admin_cancel_alert($1, 'sent to the wrong district')", [id]);
    await as(db, "anon");
    expect(await inPublicStatus(id)).toBe(0);
    await as(db, { uid: w.admin });
    await expectDenied(db, "select admin_cancel_alert($1, 'again')", [id]);
    await expectDenied(db, "select admin_extend_alert($1, $2)", [id, soon(6)]);
    await asOwner(db);
    expect(
      await rows(
        db,
        "select 1 from audit_log where action = 'alert_cancelled' and entity_id = $1 and actor = $2",
        [id, w.admin],
      ),
    ).toHaveLength(1);
  });
});

describe("the review step", () => {
  it("shows the words, counts who would be reached, and names alerts already in force", async () => {
    await asOwner(db);
    // The home tambon is worked out from the pin by a trigger; it cannot be set by itself.
    await db.query(
      "update profiles set home_point = extensions.st_geomfromtext($1, 4326) where user_id = $2",
      [w.yalaPoint, w.requester],
    );
    await as(db, { uid: w.admin });
    const existing = await publish(tpl.flood_watch!, [w.yala1]);
    const [r] = await rows<{
      p: {
        level: string;
        messages: Record<string, string>;
        tambons: number;
        reach: { homes: number; people: number };
        overlaps: { id: string; shared: number }[];
      };
    }>(db, "select admin_alert_preview($1, $2, null) as p", [
      tpl.flood_warning,
      [w.yala1, w.yala2],
    ]);
    expect(r!.p.level).toBe("warning");
    expect(r!.p.tambons).toBe(2);
    expect(r!.p.messages.th).toContain("ต.");
    expect(r!.p.reach.homes).toBeGreaterThanOrEqual(1);
    expect(r!.p.reach.people).toBeGreaterThanOrEqual(1);
    expect(r!.p.overlaps.find((o) => o.id === existing)?.shared).toBe(1);

    await as(db, { uid: w.requester });
    await expectDenied(db, "select admin_alert_preview($1, $2, null)", [
      tpl.flood_warning,
      [w.yala1],
    ]);
  });
});

describe("templates", () => {
  it("are read by admins, changed only by the super admin, and not read by anyone else", async () => {
    await as(db, { uid: w.requester });
    expect(await rows(db, "select 1 from alert_templates")).toHaveLength(0);
    await as(db, "anon");
    await expectDenied(db, "select 1 from alert_templates");

    await as(db, { uid: w.admin });
    expect((await rows(db, "select 1 from alert_templates")).length).toBeGreaterThanOrEqual(4);
    const tried = await db.query("update alert_templates set active = false where code = $1", [
      "flood_watch",
    ]);
    expect(tried.rowCount).toBe(0);

    await as(db, { uid: w.superAdmin });
    const done = await db.query("update alert_templates set active = false where code = $1", [
      "flood_watch",
    ]);
    expect(done.rowCount).toBe(1);
    // A template switched off cannot be published from.
    await expectDenied(db, "select admin_publish_alert($1, $2, $3)", [
      tpl.flood_watch,
      [w.yala1],
      soon(3),
    ]);
  });
});
