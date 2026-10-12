/**
 * A12 part 1, the rest of it: an admin sends the dam release notice (spec section 15).
 *
 * This is the one place in Jaga where a person deliberately reaches tens of thousands of phones,
 * so what is tested is everything that could make that go wrong:
 *
 *   * only an admin can send one, and the issuer stored is the admin who sent it (safety rule 2);
 *   * the zone is S7's and cannot be aimed by whoever is sending;
 *   * the words must arrive from the template in all three languages, or the notice is refused;
 *   * the expected-arrival window is the measured one, counted from the time the gates opened;
 *   * it can be withdrawn, and both the sending and the withdrawal are in the access log.
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

const MESSAGES = {
  th: "เขื่อนบางลางเปิดประตูระบายน้ำ ระบายน้ำ 650 ลบ.ม./วินาที",
  ms: "Empangan Bang Lang membuka pintu pelepasan, 650 m3/s",
  en: "Bang Lang Dam has opened its gates, releasing 650 m3/s",
};
const REASON = "เขื่อนบางลางระบายน้ำ 650 ลบ.ม./วินาที";

/** The call itself, with everything that is not under test held at a sensible value. */
function send(over: Record<string, unknown> = {}) {
  const args = {
    dam: "bang_lang",
    gates: "now() - interval '1 hour'",
    cms: 650,
    level: "warning",
    messages: JSON.stringify(MESSAGES),
    reason: REASON,
    next: "now() + interval '6 hours'",
    end: null as string | null,
    notice: null as string | null,
    ...over,
  };
  return {
    sql: `select public.admin_send_dam_release($1, ${args.gates}, $2, $3, $4::jsonb, $5,
            ${args.next}, ${args.end ?? "null"}, $6) as id`,
    params: [args.dam, args.cms, args.level, args.messages, args.reason, args.notice],
  };
}

describe("who may send a dam release notice", () => {
  it("an admin can, and the alert is issued in their own name", async () => {
    await as(db, { uid: w.admin });
    const call = send();
    const { id } = await one<{ id: string }>(call.sql, call.params);
    expect(id).toBeTruthy();
    const alert = await one<{
      issued_by: string;
      level: string;
      kind: string;
      dam: string;
      cms: string;
    }>(
      `select issued_by, level::text, signals_snapshot->>'kind' kind,
              signals_snapshot->>'dam_code' dam, signals_snapshot->>'release_cms' cms
         from public.alerts where id = $1`,
      [id],
    );
    expect(alert.issued_by).toBe(w.admin);
    expect(alert.level).toBe("warning");
    expect(alert.kind).toBe("dam_release");
    expect(alert.dam).toBe("bang_lang");
    expect(Number(alert.cms)).toBe(650);
  });

  it("a signed-in person who is not an admin cannot", async () => {
    await as(db, { uid: w.requester });
    const call = send();
    await expectDenied(db, call.sql, call.params);
  });

  it("a visitor cannot", async () => {
    await as(db, "anon");
    const call = send();
    await expectDenied(db, call.sql, call.params);
  });
});

describe("the zone is the river's, not the sender's", () => {
  it("reaches every tambon S7 put on the dam's path, and only those", async () => {
    await as(db, { uid: w.admin });
    const call = send();
    const { id } = await one<{ id: string }>(call.sql, call.params);
    const zone = await one<{ sent: string; path: string; off_path: string }>(
      `select (select count(*) from public.alert_tambons where alert_id = $1) sent,
              (select count(*) from public.dam_tambons t join public.dams d on d.code = t.dam_code
                where t.dam_code = 'bang_lang' and t.source = d.geometry_source) path,
              (select count(*) from public.alert_tambons at
                where at.alert_id = $1
                  and not exists (select 1 from public.dam_tambons t join public.dams d
                                    on d.code = t.dam_code
                                  where t.dam_code = 'bang_lang' and t.source = d.geometry_source
                                    and t.tambon_code = at.tambon)) off_path`,
      [id],
    );
    expect(Number(zone.sent)).toBe(Number(zone.path));
    expect(Number(zone.sent)).toBeGreaterThan(30);
    expect(Number(zone.off_path)).toBe(0);
  });

  it("the expected arrival window is the measured one, counted from the gates", async () => {
    await as(db, { uid: w.admin });
    const call = send({ gates: "now() - interval '1 hour'" });
    const { id } = await one<{ id: string }>(call.sql, call.params);
    const win = await one<{ from_h: string; to_h: string }>(
      `select extract(epoch from (lower(expected_onset_window)
                - (signals_snapshot->>'gates_open_at')::timestamptz)) / 3600 from_h,
              extract(epoch from (upper(expected_onset_window)
                - (signals_snapshot->>'gates_open_at')::timestamptz)) / 3600 to_h
         from public.alerts where id = $1`,
      [id],
    );
    const measured = await one<{ lo: string; hi: string }>(
      `select min(warn_from_h) lo, max(latest_h) hi from public.dam_arrivals
        where dam_code = 'bang_lang'`,
    );
    // To the minute, because the window is built with whole minutes.
    expect(Number(win.from_h)).toBeCloseTo(Number(measured.lo), 1);
    expect(Number(win.to_h)).toBeCloseTo(Number(measured.hi), 1);
  });

  it("names the version of the measurement it used", async () => {
    await as(db, { uid: w.admin });
    const call = send();
    const { id } = await one<{ id: string }>(call.sql, call.params);
    const { source } = await one<{ source: string }>(
      `select signals_snapshot->>'arrival_source' source from public.alerts where id = $1`,
      [id],
    );
    expect(source).toBe("gauges-2026-10");
  });
});

describe("what it refuses", () => {
  const cases: [string, Record<string, unknown>][] = [
    ["a level that is not a warning level", { level: "normal" }],
    ["a release of nothing", { cms: 0 }],
    ["gates that opened a month ago", { gates: "now() - interval '30 days'" }],
    ["a next update already in the past", { next: "now() - interval '1 hour'" }],
    ["an end before the start", { end: "now() - interval '3 hours'" }],
    ["a missing language", { messages: JSON.stringify({ th: MESSAGES.th, ms: MESSAGES.ms }) }],
    ["an empty Thai text", { messages: JSON.stringify({ ...MESSAGES, th: " " }) }],
    ["no reason line", { reason: "" }],
    ["a dam that does not exist", { dam: "no_such_dam" }],
  ];
  for (const [name, over] of cases) {
    it(`refuses ${name}`, async () => {
      await as(db, { uid: w.admin });
      const call = send(over);
      await expectDenied(db, call.sql, call.params);
    });
  }
});

describe("after it has gone out", () => {
  it("everyone can read it, with the dam's figures beside it", async () => {
    await as(db, { uid: w.admin });
    const call = send();
    const { id } = await one<{ id: string }>(call.sql, call.params);
    await as(db, "anon");
    const row = await one<{ details: Record<string, unknown>; tambons: string[] }>(
      `select details, tambons from public.public_alert_status() where alert_id = $1`,
      [id],
    );
    expect(row.details.kind).toBe("dam_release");
    expect(row.details.damCode).toBe("bang_lang");
    expect(row.details.gatesOpenAt).toBeTruthy();
    expect(row.tambons.length).toBeGreaterThan(30);
  });

  it("gives a visitor nothing from the snapshot that was not meant for them", async () => {
    await as(db, { uid: w.admin });
    const call = send();
    const { id } = await one<{ id: string }>(call.sql, call.params);
    await as(db, "anon");
    const { details } = await one<{ details: Record<string, unknown> }>(
      `select details from public.public_alert_status() where alert_id = $1`,
      [id],
    );
    // The admin-only halves of the snapshot stay behind.
    expect(Object.keys(details).sort()).toEqual([
      "arrivalSource",
      "damCode",
      "expectedEndAt",
      "gatesOpenAt",
      "kind",
      "releaseCms",
    ]);
  });

  it("can be withdrawn, and then nobody sees it", async () => {
    await as(db, { uid: w.admin });
    const call = send();
    const { id } = await one<{ id: string }>(call.sql, call.params);
    await one(`select public.admin_cancel_alert($1, 'sent in error')`, [id]);
    await as(db, "anon");
    const left = await rows(db, `select 1 from public.public_alert_status() where alert_id = $1`, [
      id,
    ]);
    expect(left.length).toBe(0);
  });

  it("refuses to withdraw the same one twice, and refuses a stranger", async () => {
    await as(db, { uid: w.admin });
    const call = send();
    const { id } = await one<{ id: string }>(call.sql, call.params);
    await one(`select public.admin_cancel_alert($1, null)`, [id]);
    await expectDenied(db, `select public.admin_cancel_alert($1, null)`, [id]);
    await as(db, { uid: w.requester });
    await expectDenied(db, `select public.admin_cancel_alert($1, null)`, [id]);
  });

  it("writes the sending and the withdrawal to the access log", async () => {
    await as(db, { uid: w.admin });
    const call = send();
    const { id } = await one<{ id: string }>(call.sql, call.params);
    await one(`select public.admin_cancel_alert($1, 'sent in error')`, [id]);
    const log = await rows<{ action: string; actor: string }>(
      db,
      `select action, actor from public.audit_log where entity = 'alerts' and entity_id = $1
        order by ts`,
      [id],
    );
    expect(log.map((r) => r.action)).toEqual(["dam_release_sent", "alert_cancelled"]);
    expect(log.every((r) => r.actor === w.admin)).toBe(true);
  });

  it("closes the war-room row it answers", async () => {
    await asOwner(db);
    const { notice } = await one<{ notice: string }>(
      `insert into public.dam_notices (dam_code, observed_at, grade, reasons, figures)
         values ('bang_lang', now() - interval '2 hours', 'releasing', '{spill_open}', '{}'::jsonb)
         returning id as notice`,
    );
    await as(db, { uid: w.admin });
    const call = send({ notice });
    const { id } = await one<{ id: string }>(call.sql, call.params);
    const row = await one<{ status: string; reviewed_by: string; note: string }>(
      `select status::text, reviewed_by, review_note note from public.dam_notices where id = $1`,
      [notice],
    );
    expect(row.status).toBe("sent");
    expect(row.reviewed_by).toBe(w.admin);
    expect(row.note).toContain(id);
  });

  it("is listed for the admins, with who sent it", async () => {
    await as(db, { uid: w.admin });
    const call = send();
    const { id } = await one<{ id: string }>(call.sql, call.params);
    const row = await one<{ alert_id: string; issued_by: string; tambons: number }>(
      `select alert_id, issued_by, tambons from public.admin_dam_alerts('bang_lang')
        where alert_id = $1`,
      [id],
    );
    expect(row.alert_id).toBe(id);
    expect(row.issued_by).toBeTruthy();
    expect(Number(row.tambons)).toBeGreaterThan(30);
    await as(db, { uid: w.requester });
    await expectDenied(db, `select * from public.admin_dam_alerts(null)`);
  });
});
