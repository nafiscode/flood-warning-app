/**
 * A6: the admins' war room (spec 6.4 and 9). What is checked here is who may call each function,
 * what it refuses to hand over (watched places as rows, any phone number), that the writes land
 * on the case and in the audit log, and that nothing an admin does can drop an SOS (safety
 * rule 1). Each test runs in its own transaction on the dev database and is rolled back.
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

const one = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  (await rows<T>(db, sql, params))[0]!;

const auditCount = async (action: string, entityId: string | null = null) => {
  await asOwner(db);
  const sql = entityId
    ? "select count(*) as n from audit_log where action = $1 and entity_id = $2"
    : "select count(*) as n from audit_log where action = $1";
  const r = await rows<{ n: string }>(db, sql, entityId ? [action, entityId] : [action]);
  return Number(r[0]!.n);
};

/** Every war-room function, with arguments that are valid for an admin. */
const READS: [string, string, unknown[]][] = [
  ["admin_overview", "select * from admin_overview()", []],
  ["admin_sos_board", "select * from admin_sos_board(72)", []],
  ["admin_sos_history", "select * from admin_sos_history($1)", ["sos"]],
  ["admin_people", "select * from admin_people(null, 50, 0)", []],
  ["admin_people_points", "select * from admin_people_points(100)", []],
  ["admin_watched_by_tambon", "select * from admin_watched_by_tambon()", []],
  ["admin_reports_recent", "select * from admin_reports_recent(72)", []],
  ["admin_units_for_tambon", "select * from admin_units_for_tambon($1)", ["tambon"]],
];

const args = (names: unknown[]) =>
  names.map((n) => (n === "sos" ? w.yalaSos : n === "tambon" ? w.yala1 : n));

describe("who may read the war room", () => {
  it("lets an admin call every one of its reads", async () => {
    for (const [name, sql, params] of READS) {
      await as(db, { uid: w.admin });
      const result = await rows(db, sql, args(params));
      expect(Array.isArray(result), name).toBe(true);
    }
  });

  it("refuses a visitor, a user and a verified authority", async () => {
    for (const [name, sql, params] of READS) {
      await as(db, "anon");
      expect(await expectDenied(db, sql, args(params)), `${name} / anon`).toBe("42501");
      await as(db, { uid: w.requester });
      expect(await expectDenied(db, sql, args(params)), `${name} / user`).toBe("42501");
      await as(db, { uid: w.yalaRescue.user });
      expect(await expectDenied(db, sql, args(params)), `${name} / authority`).toBe("42501");
    }
  });

  it("keeps the gate itself out of a caller's reach", async () => {
    await as(db, { uid: w.admin });
    expect(await expectDenied(db, "select admin_only()")).toBe("42501");
  });
});

describe("the counters", () => {
  // They count the whole database, and the dev project holds the owner's own rows, so what is
  // checked is the change each insert makes, not an absolute number.
  const overview = async () => {
    await as(db, { uid: w.admin });
    const o = await one<Record<string, string>>("select * from admin_overview()");
    return (key: string) => Number(o[key]);
  };

  it("count the people, the watched places, the units and the open cases", async () => {
    const before = await overview();
    await asOwner(db);
    await db.query(
      `insert into saved_places (user_id, label, point, tambon, notify)
       values ($1, 'grandmother', extensions.st_geomfromtext($2, 4326), $3, true)`,
      [w.requester, w.yalaPoint, w.yala1],
    );
    await db.query(
      "update profiles set home_tambon = $2, home_point = extensions.st_geomfromtext($3, 4326) where user_id = $1",
      [w.requester, w.yala1, w.yalaPoint],
    );
    const after = await overview();
    expect(after("watched_places") - before("watched_places")).toBe(1);
    expect(after("watched_notify") - before("watched_notify")).toBe(1);
    expect(after("people_with_home") - before("people_with_home")).toBe(1);
    // The fixture world itself: four people, three verified units, one pending, two open cases
    // that nobody holds yet.
    expect(before("people")).toBeGreaterThanOrEqual(4);
    expect(before("units_verified")).toBeGreaterThanOrEqual(3);
    expect(before("units_pending")).toBeGreaterThanOrEqual(1);
    expect(before("sos_open")).toBeGreaterThanOrEqual(2);
    expect(before("sos_waiting")).toBe(before("sos_open"));
    expect(before("sos_working")).toBe(0);
    expect(before("unclaimed_minutes")).toBe(15);
    expect(before("tambons_covered")).toBeGreaterThanOrEqual(2);
  });

  it("calls a case overdue once it is older than the setting", async () => {
    const fresh = await overview();
    await asOwner(db);
    await db.query(
      "update sos_requests set created_at = now() - interval '40 minutes' where id = $1",
      [w.yalaSos],
    );
    const aged = await overview();
    expect(aged("sos_overdue") - fresh("sos_overdue")).toBe(1);

    // The threshold is a setting, not a constant (spec 6.4): at 60 minutes it waits again.
    await asOwner(db);
    await db.query(
      "update system_settings set value = '{\"minutes\": 60}' where key = 'sos_unclaimed_minutes'",
    );
    const patient = await overview();
    expect(patient("unclaimed_minutes")).toBe(60);
    expect(patient("sos_overdue") - fresh("sos_overdue")).toBe(0);
  });
});

describe("the case board", () => {
  it("says where the case is, who is on it and whether there is a phone, but never the number", async () => {
    await as(db, { uid: w.admin });
    const board = await rows<Record<string, unknown>>(db, "select * from admin_sos_board(72)");
    const ids = board.map((c) => c.sos_id);
    expect(ids).toContain(w.yalaSos);
    expect(ids).toContain(w.songkhlaSos);
    const yala = board.find((c) => c.sos_id === w.yalaSos)!;
    expect(yala.tambon).toBe(w.yala1);
    expect(yala.tambon_th).toBeTruthy();
    expect(Number(yala.lat)).toBeGreaterThan(5);
    expect(Number(yala.lon)).toBeGreaterThan(99);
    expect(yala.has_phone).toBe(true);
    expect(yala.claim_unit_id).toBe(null);
    expect(yala.suspected_spam).toBe(true);
    expect(Number(yala.units_covering)).toBe(2);
    // Not one column carries a phone number.
    expect(Object.keys(yala).some((k) => k.includes("phone") && k !== "has_phone")).toBe(false);
    expect(JSON.stringify(yala)).not.toContain("66811111111");
  });

  it("shows a flagged case like any other (safety rule 1)", async () => {
    await as(db, { uid: w.admin });
    const board = await rows<{ sos_id: string }>(db, "select * from admin_sos_board(72)");
    expect(board.map((c) => c.sos_id)).toContain(w.yalaSos);
  });

  it("keeps an open case on the board however old it is", async () => {
    await asOwner(db);
    await db.query(
      "update sos_requests set created_at = now() - interval '30 days' where id = $1",
      [w.yalaSos],
    );
    await as(db, { uid: w.admin });
    const board = await rows<{ sos_id: string }>(db, "select * from admin_sos_board(1)");
    expect(board.map((c) => c.sos_id)).toContain(w.yalaSos);
  });

  it("marks the watch in the audit log, once per ten minutes and not once per poll", async () => {
    await as(db, { uid: w.admin });
    for (let i = 0; i < 4; i++) await rows(db, "select * from admin_sos_board(72)");
    expect(await auditCount("read_sos_board")).toBe(1);
  });
});

describe("the people list", () => {
  it("shows the home area and the counts, and no phone number", async () => {
    await asOwner(db);
    await db.query(
      "update profiles set home_tambon = $2, home_point = extensions.st_geomfromtext($3, 4326) where user_id = $1",
      [w.requester, w.yala1, w.yalaPoint],
    );
    await as(db, { uid: w.admin });
    const people = await rows<Record<string, unknown>>(
      db,
      "select * from admin_people(null, 50, 0)",
    );
    const person = people.find((p) => p.user_id === w.requester)!;
    expect(person.display_name).toBe("requester");
    expect(person.has_phone).toBe(true);
    expect(person.phone_verified).toBe(true);
    expect(person.home_tambon).toBe(w.yala1);
    expect(Number(person.sos_sent)).toBe(1);
    expect(JSON.stringify(person)).not.toContain("66811111111");
    expect(await auditCount("read_people")).toBe(1);
  });

  it("finds a person by name", async () => {
    await as(db, { uid: w.admin });
    const found = await rows<{ display_name: string }>(
      db,
      "select * from admin_people('request', 50, 0)",
    );
    expect(found.map((p) => p.display_name)).toEqual(["requester"]);
  });
});

describe("watched places", () => {
  it("come back as counts per tambon, never as rows (spec 9: an admin reads none)", async () => {
    await asOwner(db);
    await db.query(
      `insert into saved_places (user_id, label, point, tambon, notify, contact_name, contact_phone, contact_consent_at)
       values ($1, 'grandmother in Bannang Sata', extensions.st_geomfromtext($2, 4326), $3, true, 'Mak', '66844444444', now())`,
      [w.requester, w.yalaPoint, w.yala1],
    );
    await as(db, { uid: w.admin });
    const counts = await rows<Record<string, unknown>>(
      db,
      "select * from admin_watched_by_tambon()",
    );
    const row = counts.find((c) => c.tambon === w.yala1)!;
    expect(Number(row.places)).toBe(1);
    expect(Number(row.owners)).toBe(1);
    const text = JSON.stringify(counts);
    expect(text).not.toContain("grandmother");
    expect(text).not.toContain("Mak");
    expect(text).not.toContain("66844444444");
    // And the table itself stays closed to an admin.
    expect(await rows(db, "select * from saved_places")).toEqual([]);
  });
});

describe("what an admin can do with a case", () => {
  it("assigns it to a unit that covers it, and writes the history and the log", async () => {
    await as(db, { uid: w.admin });
    const status = await one<{ admin_sos_assign: string }>(
      "select admin_sos_assign($1, $2, 'called the unit, they are going') as admin_sos_assign",
      [w.yalaSos, w.yalaRescue.id],
    );
    expect(status.admin_sos_assign).toBe("assigned");
    const board = await rows<Record<string, unknown>>(db, "select * from admin_sos_board(72)");
    const yala = board.find((c) => c.sos_id === w.yalaSos)!;
    expect(yala.claim_unit_id).toBe(w.yalaRescue.id);
    expect(yala.claim_unit_name).toBe("Yala rescue");
    expect(yala.last_event).toBe("assigned_by_admin");
    expect(await auditCount("assign_sos", w.yalaSos)).toBe(1);
  });

  it("refuses a unit that does not cover the case, and one that is not verified", async () => {
    await as(db, { uid: w.admin });
    expect(
      await expectDenied(db, "select admin_sos_assign($1, $2)", [w.yalaSos, w.songkhlaRescue.id]),
    ).toBe("23514");
    expect(
      await expectDenied(db, "select admin_sos_assign($1, $2)", [w.yalaSos, w.yalaPending.id]),
    ).toBe("23514");
  });

  it("refuses to take a case off the unit that already holds it", async () => {
    await as(db, { uid: w.admin });
    await db.query("select admin_sos_assign($1, $2)", [w.yalaSos, w.yalaRescue.id]);
    expect(
      await expectDenied(db, "select admin_sos_assign($1, $2)", [w.yalaSos, w.yalaPlanning.id]),
    ).toBe("23505");
  });

  it("releases a case back to the relay, with a reason", async () => {
    await as(db, { uid: w.admin });
    await db.query("select admin_sos_assign($1, $2)", [w.yalaSos, w.yalaRescue.id]);
    expect(await expectDenied(db, "select admin_sos_release($1, '')", [w.yalaSos])).toBe("23514");
    const back = await one<{ admin_sos_release: string }>(
      "select admin_sos_release($1, 'their boat broke down') as admin_sos_release",
      [w.yalaSos],
    );
    expect(back.admin_sos_release).toBe("received");
    const board = await rows<Record<string, unknown>>(db, "select * from admin_sos_board(72)");
    expect(board.find((c) => c.sos_id === w.yalaSos)!.claim_unit_id).toBe(null);
    expect(await auditCount("release_sos", w.yalaSos)).toBe(1);
  });

  it("adds a note to the case history", async () => {
    await as(db, { uid: w.admin });
    await db.query("select admin_sos_note($1, 'phoned the tambon office')", [w.yalaSos]);
    const history = await rows<{ event: string; note: string }>(
      db,
      "select * from admin_sos_history($1)",
      [w.yalaSos],
    );
    expect(history.at(-1)!.event).toBe("admin_note");
    expect(history.at(-1)!.note).toBe("phoned the tambon office");
    expect(await expectDenied(db, "select admin_sos_note($1, '   ')", [w.yalaSos])).toBe("23514");
  });

  it("dismisses and restores the spam flag without touching the case", async () => {
    await as(db, { uid: w.admin });
    await db.query("select admin_sos_spam($1, false, 'real call, I spoke to them')", [w.yalaSos]);
    let board = await rows<Record<string, unknown>>(db, "select * from admin_sos_board(72)");
    let yala = board.find((c) => c.sos_id === w.yalaSos)!;
    expect(yala.suspected_spam).toBe(false);
    expect(yala.spam_dismissed_at).not.toBe(null);
    expect(yala.status).toBe("received");

    await db.query("select admin_sos_spam($1, true, 'the eighth today from one phone')", [
      w.yalaSos,
    ]);
    board = await rows<Record<string, unknown>>(db, "select * from admin_sos_board(72)");
    yala = board.find((c) => c.sos_id === w.yalaSos)!;
    expect(yala.suspected_spam).toBe(true);
    expect(yala.spam_dismissed_at).toBe(null);
    // Still on the board, still open: a flag is an opinion, not a rejection (safety rule 1).
    expect(yala.status).toBe("received");
    expect(await auditCount("dismiss_spam", w.yalaSos)).toBe(1);
    expect(await auditCount("flag_spam", w.yalaSos)).toBe(1);
  });

  it("refuses every write to anyone but an admin", async () => {
    for (const caller of [w.requester, w.yalaRescue.user]) {
      await as(db, { uid: caller });
      expect(
        await expectDenied(db, "select admin_sos_assign($1, $2)", [w.yalaSos, w.yalaRescue.id]),
      ).toBe("42501");
      expect(await expectDenied(db, "select admin_sos_release($1, 'no')", [w.yalaSos])).toBe(
        "42501",
      );
      expect(await expectDenied(db, "select admin_sos_note($1, 'no')", [w.yalaSos])).toBe("42501");
      expect(await expectDenied(db, "select admin_sos_spam($1, true)", [w.yalaSos])).toBe("42501");
    }
  });

  it("will not assign a closed case", async () => {
    await asOwner(db);
    await db.query("update sos_requests set status = 'rescued', closed_at = now() where id = $1", [
      w.yalaSos,
    ]);
    await as(db, { uid: w.admin });
    expect(
      await expectDenied(db, "select admin_sos_assign($1, $2)", [w.yalaSos, w.yalaRescue.id]),
    ).toBe("23514");
  });
});

describe("the units offered for a case", () => {
  it("lists the verified units covering the tambon, with no phone", async () => {
    await as(db, { uid: w.admin });
    const units = await rows<Record<string, unknown>>(
      db,
      "select * from admin_units_for_tambon($1)",
      [w.yala1],
    );
    expect(units.map((u) => u.unit_name).sort()).toEqual(["Yala planning", "Yala rescue"]);
    expect(JSON.stringify(units)).not.toContain("66830000001");
  });
});
