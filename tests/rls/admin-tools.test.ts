/**
 * A6, the rest of the admin console: moderation, safe places, the access log, handover notes,
 * announcements, exports and merging duplicate SOS.
 *
 * What these tests are really guarding:
 *  - none of it is open to anyone but an admin;
 *  - every act lands in the access log;
 *  - no list and no export carries a phone number or says who sent something, and the
 *    anonymized SOS export cannot be matched back to a case;
 *  - a merged SOS is never lost: it stays open, its sender sees the team of the main case, and
 *    it comes back to the boards by itself when the main case ends first.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

const logged = async (action: string, actor: string) => {
  await asOwner(db);
  return rows<{ entity_id: string | null; details: Record<string, unknown> }>(
    db,
    "select entity_id, details from audit_log where action = $1 and actor = $2 order by id",
    [action, actor],
  );
};

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

describe("closed to everyone but admins", () => {
  it("refuses a visitor, a resident and a rescue team", async () => {
    const calls: [string, unknown[]][] = [
      ["select * from admin_reports_queue()", []],
      ["select admin_moderate_report($1, 'approved')", [w.yalaSos]],
      ["select * from admin_safe_places('9501')", []],
      ["select admin_safe_place_add('ทดสอบ', null, 'school', 6.5, 101.3)", []],
      ["select * from admin_audit_log()", []],
      ["select * from admin_audit_actions()", []],
      ["select * from admin_handover()", []],
      ["select * from admin_export_sos(30, true)", []],
      ["select * from admin_export_reports(30)", []],
      ["select * from admin_export_alerts(30)", []],
      ["select * from admin_sos_duplicates()", []],
      ["select admin_sos_merge($1, $2)", [w.yalaSos, w.songkhlaSos]],
      ["select admin_sos_unmerge($1)", [w.yalaSos]],
    ];
    for (const caller of ["anon", { uid: w.requester }, { uid: w.yalaRescue.user }] as const) {
      await as(db, caller);
      for (const [sql, params] of calls) await expectDenied(db, sql, params);
    }
  });
});

describe("report moderation", () => {
  it("lists what is waiting without saying who sent it, and logs the decision", async () => {
    await as(db, { uid: w.admin });
    const queue = await rows<Record<string, unknown>>(
      db,
      "select * from admin_reports_queue('pending', 200) where tambon = $1",
      [w.yala1],
    );
    expect(queue.length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(queue[0]!)).not.toContain("reporter_id");
    const id = queue[0]!.report_id as string;

    await db.query("select admin_moderate_report($1, 'approved')", [id]);
    expect(
      await rows(db, "select 1 from admin_reports_queue('approved', 200) where report_id = $1", [
        id,
      ]),
    ).toHaveLength(1);
    // The same answer twice is one decision, not two log rows.
    await db.query("select admin_moderate_report($1, 'approved')", [id]);
    const log = (await logged("report_moderated", w.admin)).filter((l) => l.entity_id === id);
    expect(log).toHaveLength(1);
    expect(log[0]!.details).toEqual({ from: "pending", to: "approved" });
  });
});

describe("safe places", () => {
  it("adds one inside the service area, with its tambon worked out, and logs it", async () => {
    await as(db, { uid: w.admin });
    const [pt] = await rows<{ lat: number; lon: number }>(
      db,
      "select extensions.st_y(p) as lat, extensions.st_x(p) as lon from (select extensions.st_pointonsurface(geom) p from tambons where code = $1) x",
      [w.yala1],
    );
    const [made] = await rows<{ id: string }>(
      db,
      "select admin_safe_place_add('โรงเรียนทดสอบ', 'Test school', 'school', $1, $2, 120, true) as id",
      [pt!.lat, pt!.lon],
    );
    const [place] = await rows<Record<string, unknown>>(
      db,
      "select * from admin_safe_places($1) where place_id = $2",
      [w.yala1.slice(0, 4), made!.id],
    );
    expect(place).toMatchObject({
      tambon: w.yala1,
      capacity: 120,
      verification_status: "verified",
      source: "admin",
      name: { th: "โรงเรียนทดสอบ", en: "Test school" },
    });
    expect((await logged("safe_place_added", w.admin)).at(-1)!.entity_id).toBe(made!.id);
  });

  it("refuses a position outside the provinces Jaga covers, and a place without a Thai name", async () => {
    await as(db, { uid: w.admin });
    await expectDenied(db, "select admin_safe_place_add('กรุงเทพ', null, 'school', 13.75, 100.5)");
    await expectDenied(db, "select admin_safe_place_add('  ', null, 'school', 6.5, 101.3)");
  });

  it("changes status and needs, keeps a rejected place for admins only, and logs what changed", async () => {
    await asOwner(db);
    const [made] = await rows<{ id: string }>(
      db,
      `insert into safe_places (name, type, point, tambon)
       values ('{"th": "วัดทดสอบ"}', 'temple', extensions.st_geomfromtext($1, 4326), $2) returning id`,
      [w.yalaPoint, w.yala1],
    );
    await as(db, { uid: w.admin });
    await db.query(
      "select admin_safe_place_update($1, 'วัดทดสอบ', 'Test temple', 80, 'ต้องการน้ำดื่ม', 'full', 'verified')",
      [made!.id],
    );
    await as(db, "anon");
    const [seen] = await rows<Record<string, unknown>>(
      db,
      "select status, needs, capacity, verification_status from safe_places where id = $1",
      [made!.id],
    );
    expect(seen).toEqual({
      status: "full",
      needs: "ต้องการน้ำดื่ม",
      capacity: 80,
      verification_status: "verified",
    });

    await as(db, { uid: w.admin });
    await db.query(
      "select admin_safe_place_update($1, 'วัดทดสอบ', null, 80, null, 'closed', 'rejected')",
      [made!.id],
    );
    expect(
      await rows(db, "select 1 from admin_safe_places($1, 'rejected') where place_id = $2", [
        w.yala1.slice(0, 4),
        made!.id,
      ]),
    ).toHaveLength(1);
    await as(db, "anon");
    expect(await rows(db, "select 1 from safe_places where id = $1", [made!.id])).toHaveLength(0);

    const log = (await logged("safe_place_updated", w.admin)).filter(
      (l) => l.entity_id === made!.id,
    );
    expect(log).toHaveLength(2);
    expect(log[0]!.details.status).toEqual(["unknown", "full"]);
    expect(log[1]!.details.verification).toEqual(["verified", "rejected"]);
  });
});

describe("the access log and handover notes", () => {
  it("shows the log newest first, with names, filtered by kind of act", async () => {
    await as(db, { uid: w.admin });
    await db.query("select admin_sos_note($1, 'called the village head')", [w.yalaSos]);
    const all = await rows<{ action: string; actor_name: string; log_id: string }>(
      db,
      "select * from admin_audit_log(null, null, 5)",
    );
    expect(all[0]).toMatchObject({ action: "note_sos", actor_name: "admin" });
    const only = await rows<{ action: string }>(
      db,
      "select action from admin_audit_log('note_sos', null, 50)",
    );
    expect(only.every((r) => r.action === "note_sos")).toBe(true);
    const older = await rows(db, "select 1 from admin_audit_log(null, $1, 5) where log_id >= $1", [
      all[0]!.log_id,
    ]);
    expect(older).toHaveLength(0);
    const kinds = await rows<{ action: string }>(db, "select action from admin_audit_actions()");
    expect(kinds.map((k) => k.action)).toContain("note_sos");
  });

  it("lets an admin write a handover note as themselves only, and never change one", async () => {
    await as(db, { uid: w.admin });
    await db.query("insert into handover_notes (author_id, note) values ($1, 'river steady')", [
      w.admin,
    ]);
    await expectDenied(db, "insert into handover_notes (author_id, note) values ($1, 'not mine')", [
      w.superAdmin,
    ]);
    const [note] = await rows<{ author_name: string; note: string; note_id: string }>(
      db,
      "select * from admin_handover(1)",
    );
    expect(note).toMatchObject({ author_name: "admin", note: "river steady" });
    // Never changed: since A10 the write itself is refused, not just matched to no row.
    await expectDenied(db, "update handover_notes set note = 'edited' where id = $1", [
      note!.note_id,
    ]);
    await as(db, { uid: w.requester });
    await expectDenied(db, "insert into handover_notes (author_id, note) values ($1, 'hello')", [
      w.requester,
    ]);
  });
});

describe("announcements", () => {
  it("are logged when posted and when withdrawn", async () => {
    await as(db, { uid: w.admin });
    const [made] = await rows<{ id: string }>(
      db,
      `select admin_announce('{"th": "ระบบจะปิดปรับปรุงคืนนี้"}'::jsonb, $1) as id`,
      [[w.yala1]],
    );
    await expectDenied(db, `select admin_announce('{"th": "  "}'::jsonb)`);
    await db.query("select admin_announce_cancel($1)", [made!.id]);
    await db.query("select admin_announce_cancel($1)", [made!.id]);
    expect((await logged("announcement_posted", w.admin)).at(-1)!.entity_id).toBe(made!.id);
    expect(
      (await logged("announcement_cancelled", w.admin)).filter((l) => l.entity_id === made!.id),
    ).toHaveLength(1);
  });
});

describe("tambons without a team", () => {
  const without = () =>
    rows<{ admin_tambons_without_team: string }>(
      db,
      "select admin_tambons_without_team() order by 1",
    ).then((r) => r.map((row) => row.admin_tambons_without_team));

  it("only an admin may ask", async () => {
    await as(db, { uid: w.requester });
    expect(await expectDenied(db, "select admin_tambons_without_team()")).toBe("42501");
  });

  it("lists service-area tambons no verified unit covers", async () => {
    await as(db, { uid: w.admin });
    const list = await without();
    // yala1 and songkhla each have a verified unit; yala2 has none.
    expect(list).toContain(w.yala2);
    expect(list).not.toContain(w.yala1);
    expect(list).not.toContain(w.songkhla);
    // Only the service provinces (codes 90/94/95/96) are ever in it.
    expect(list.every((code) => ["90", "94", "95", "96"].includes(code.slice(0, 2)))).toBe(true);
  });

  it("drops a tambon as soon as a verified unit covers it", async () => {
    await as(db, { uid: w.admin });
    expect(await without()).toContain(w.yala2);
    await asOwner(db);
    const unit = (
      await rows<{ id: string }>(
        db,
        `insert into authority_units (org_id, user_id, unit_name, capabilities, status)
         values ((select id from organizations limit 1), $1, 'Yala2 unit',
                 '{support}'::authority_capability[], 'verified') returning id`,
        [w.admin],
      )
    )[0]!.id;
    await db.query(
      "insert into authority_coverage (unit_id, tambon, selected_level, selected_code) values ($1, $2, 'tambon', $2)",
      [unit, w.yala2],
    );
    await as(db, { uid: w.admin });
    expect(await without()).not.toContain(w.yala2);
  });
});

describe("exports", () => {
  const PRIVATE = /phone|requester|reporter|device|text|voice|photo_|name|injur|vulnerable/;

  it("an anonymized SOS export has no id, a rounded place and a rounded time", async () => {
    await as(db, { uid: w.admin });
    const out = await rows<Record<string, unknown>>(
      db,
      "select * from admin_export_sos(30, true) where tambon = $1",
      [w.yala1],
    );
    expect(out.length).toBeGreaterThanOrEqual(1);
    for (const r of out) {
      expect(r.sos_id).toBeNull();
      expect(Number((Number(r.lat) * 100).toFixed(6)) % 1).toBe(0);
      expect((r.created_at as Date).getUTCMinutes()).toBe(0);
    }
    expect(Object.keys(out[0]!).filter((k) => PRIVATE.test(k))).toEqual([]);
    const log = await logged("export", w.admin);
    expect(log.at(-1)!.details).toMatchObject({ anonymized: true, days: 30 });
    expect(Number(log.at(-1)!.details.rows)).toBeGreaterThanOrEqual(out.length);
  });

  it("the full SOS export has the case and its place, and still nothing personal", async () => {
    await as(db, { uid: w.admin });
    const out = await rows<Record<string, unknown>>(
      db,
      "select * from admin_export_sos(30, false) where sos_id = $1",
      [w.yalaSos],
    );
    expect(out).toHaveLength(1);
    expect(Object.keys(out[0]!).filter((k) => PRIVATE.test(k))).toEqual([]);
    expect(JSON.stringify(out[0])).not.toContain("66811111111");
  });

  it("reports and alerts export without a sender, and each export is logged", async () => {
    await as(db, { uid: w.admin });
    const reports = await rows<Record<string, unknown>>(
      db,
      "select * from admin_export_reports(30) where tambon = $1",
      [w.yala1],
    );
    expect(reports.length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(reports[0]!).filter((k) => PRIVATE.test(k))).toEqual([]);

    const [tpl] = await rows<{ id: string }>(
      db,
      "select id from alert_templates where code = 'flood_watch'",
    );
    const [alert] = await rows<{ id: string }>(
      db,
      "select admin_publish_alert($1, $2, now() + interval '3 hours') as id",
      [tpl!.id, [w.yala1]],
    );
    const alerts = await rows<{ tambons: string[]; geometry: { type: string }; state: string }>(
      db,
      "select * from admin_export_alerts(30) where alert_id = $1",
      [alert!.id],
    );
    expect(alerts[0]).toMatchObject({ tambons: [w.yala1], state: "in_force" });
    expect(alerts[0]!.geometry.type).toMatch(/Polygon/);
    const log = await logged("export", w.admin);
    expect(log.map((l) => l.details.rows !== undefined)).toEqual([true, true]);
  });
});

describe("merging duplicate SOS", () => {
  let twin = "";
  beforeEach(async () => {
    await asOwner(db);
    twin = (
      await rows<{ id: string }>(
        db,
        `insert into sos_requests (requester_id, point, tambon, people_count, possible_duplicate_of)
         values ($1, extensions.st_geomfromtext($2, 4326), $3, 2, $4) returning id`,
        [w.otherUser, w.yalaPoint, w.yala1, w.yalaSos],
      )
    )[0]!.id;
  });

  it("offers the pair the system noticed, with how far apart they are", async () => {
    await as(db, { uid: w.admin });
    const [pair] = await rows<Record<string, unknown>>(
      db,
      "select * from admin_sos_duplicates() where sos_id = $1",
      [twin],
    );
    expect(pair).toMatchObject({ other_id: w.yalaSos, merged: false, distance_m: 0 });
  });

  it("hides the duplicate from the teams, keeps it open, and shows its sender the main case's team", async () => {
    await as(db, { uid: w.admin });
    await db.query("select admin_sos_merge($1, $2, 'same house, two phones')", [twin, w.yalaSos]);

    await asOwner(db);
    const [row] = await rows<{ status: string; closed_at: Date | null; duplicate_of: string }>(
      db,
      "select status, closed_at, duplicate_of from sos_requests where id = $1",
      [twin],
    );
    expect(row).toEqual({ status: "received", closed_at: null, duplicate_of: w.yalaSos });

    await as(db, { uid: w.yalaRescue.user });
    const board = await rows<{ sos_id: string }>(db, "select sos_id from authority_board()");
    expect(board.map((b) => b.sos_id)).toContain(w.yalaSos);
    expect(board.map((b) => b.sos_id)).not.toContain(twin);
    await db.query("select authority_accept_sos($1)", [w.yalaSos]);

    await as(db, { uid: w.otherUser });
    const [team] = await rows<{ unit_name: string; searching: boolean; phone_available: boolean }>(
      db,
      "select unit_name, searching, phone_available from sos_responder($1)",
      [twin],
    );
    expect(team).toMatchObject({ unit_name: "Yala rescue", searching: false });
    expect(team!.phone_available).toBe(false);

    expect((await logged("sos_merged", w.admin)).at(-1)).toMatchObject({
      entity_id: twin,
      details: { into: w.yalaSos, note: "same house, two phones" },
    });
  });

  it("comes back to the boards by itself when the main case ends first", async () => {
    await as(db, { uid: w.admin });
    await db.query("select admin_sos_merge($1, $2)", [twin, w.yalaSos]);
    await asOwner(db);
    await db.query(
      "update sos_requests set status = 'safe_cancelled', closed_at = now() where id = $1",
      [w.yalaSos],
    );
    const [row] = await rows<{ duplicate_of: string | null; status: string }>(
      db,
      "select duplicate_of, status from sos_requests where id = $1",
      [twin],
    );
    expect(row).toEqual({ duplicate_of: null, status: "received" });
    await as(db, { uid: w.yalaRescue.user });
    const board = await rows<{ sos_id: string }>(db, "select sos_id from authority_board()");
    expect(board.map((b) => b.sos_id)).toContain(twin);
  });

  it("can be undone, and refuses the merges that would lose someone", async () => {
    await as(db, { uid: w.admin });
    await expectDenied(db, "select admin_sos_merge($1, $1)", [twin]);
    await db.query("select admin_sos_merge($1, $2)", [twin, w.yalaSos]);
    // Already merged; and a case others are merged into cannot itself be merged away.
    await expectDenied(db, "select admin_sos_merge($1, $2)", [twin, w.songkhlaSos]);
    await expectDenied(db, "select admin_sos_merge($1, $2)", [w.yalaSos, w.songkhlaSos]);
    await db.query("select admin_sos_unmerge($1)", [twin]);
    await expectDenied(db, "select admin_sos_unmerge($1)", [twin]);
    expect((await logged("sos_unmerged", w.admin)).at(-1)!.entity_id).toBe(twin);

    // A team already on its way to a case: that case is not a duplicate to hide.
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select authority_accept_sos($1)", [twin]);
    await as(db, { uid: w.admin });
    await expectDenied(db, "select admin_sos_merge($1, $2)", [twin, w.yalaSos]);
  });
});
