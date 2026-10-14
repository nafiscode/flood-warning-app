/**
 * A7, LINE: who an alert is sent to through LINE, and who may ask.
 *
 * What these tests are really guarding:
 *  - LINE bills per person, so an alert goes only to people whose home or watched place (with
 *    notifications on) is in its area, who signed in with LINE, and who have not blocked the
 *    account - and a drill goes to nobody;
 *  - LINE ids are read by an admin only, and it is logged; follows and status questions are
 *    accepted only from Jaga's own server (the gate token);
 *  - the quota written down is LINE's own figure, and the admins are warned once at 70% and
 *    once at 90%.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

const TOKEN = "test-gate-token-0123456789abcdef0123456789";
const HOME = `U${"a".repeat(32)}`;
const WATCHER = `U${"b".repeat(32)}`;

async function alertFor(tambons: string[], drill = false): Promise<string> {
  await asOwner(db);
  const id = (
    await rows<{ id: string }>(
      db,
      `insert into alerts (level, reason, messages, issued_by, next_update_at, is_drill)
       values ('warning', 'River rising', '{"th": "น้ำกำลังขึ้น"}'::jsonb, $1, now() + interval '6 hours', $2)
       returning id`,
      [w.admin, drill],
    )
  )[0]!.id;
  for (const t of tambons) {
    await db.query("insert into alert_tambons (alert_id, tambon) values ($1, $2)", [id, t]);
  }
  return id;
}
const targets = async (alert: string) => {
  await as(db, { uid: w.admin });
  const got = await rows<{ line_user_id: string }>(db, "select * from line_targets_for_alert($1)", [
    alert,
  ]);
  await asOwner(db);
  return got.map((r) => r.line_user_id).sort();
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
  await asOwner(db);
  await db.query(
    `insert into push_gate (id, token) values (true, $1)
     on conflict (id) do update set token = excluded.token`,
    [TOKEN],
  );
  // Nobody else's LINE id may be in the way of a count (the dev database has real accounts).
  await db.query("update profiles set line_user_id = null");
  await db.query("delete from line_follows");
  // The dev database holds the owner's own test alerts; only this file's count here.
  await db.query("delete from alerts");
  await db.query("delete from line_quota_usage");
  // One person whose home is in yala1, one who only watches a place there.
  // The home tambon follows the home point (a trigger keeps them in step), so the point is set.
  await db.query(
    `update profiles set line_user_id = $2, home_point = extensions.st_geomfromtext($3, 4326)
      where user_id = $1`,
    [w.requester, HOME, w.yalaPoint],
  );
  await db.query("update profiles set line_user_id = $2, home_tambon = null where user_id = $1", [
    w.otherUser,
    WATCHER,
  ]);
  await db.query("delete from saved_places where user_id = $1", [w.otherUser]);
  await db.query(
    `insert into saved_places (user_id, label, point, tambon, notify)
     values ($1, 'Mum', extensions.st_geomfromtext($2, 4326), $3, true)`,
    [w.otherUser, w.yalaPoint, w.yala1],
  );
});
afterEach(async () => {
  await db.query("rollback");
});

describe("who an alert reaches through LINE", () => {
  it("the people whose home or watched place is in its area, and nobody elsewhere", async () => {
    expect(await targets(await alertFor([w.yala1]))).toEqual([HOME, WATCHER]);
    expect(await targets(await alertFor([w.songkhla]))).toEqual([]);
  });

  it("not a watched place with notifications off, and not someone who blocked the account", async () => {
    await db.query("update saved_places set notify = false where user_id = $1", [w.otherUser]);
    const alert = await alertFor([w.yala1]);
    expect(await targets(alert)).toEqual([HOME]);
    await as(db, "anon");
    await db.query("select line_follow_event($1, $2, false)", [TOKEN, HOME]);
    expect(await targets(alert)).toEqual([]);
    // They add the account again.
    await as(db, "anon");
    await db.query("select line_follow_event($1, $2, true)", [TOKEN, HOME]);
    expect(await targets(alert)).toEqual([HOME]);
  });

  it("a drill goes to nobody", async () => {
    expect(await targets(await alertFor([w.yala1], true))).toEqual([]);
  });

  it("only an admin can read the ids or the reach, and the read is logged", async () => {
    const alert = await alertFor([w.yala1]);
    for (const caller of ["anon", { uid: w.requester }, { uid: w.yalaRescue.user }] as const) {
      await as(db, caller);
      await expectDenied(db, "select * from line_targets_for_alert($1)", [alert]);
      await expectDenied(db, "select * from line_reach($1)", [[w.yala1]]);
      await expectDenied(db, "select line_record_alert($1, 1, 0, 1, 500)", [alert]);
      await expectDenied(db, "select * from line_follows");
    }
    await targets(alert);
    const log = await rows(
      db,
      "select 1 from audit_log where action = 'line_targets' and entity_id = $1 and actor = $2",
      [alert, w.admin],
    );
    expect(log).toHaveLength(1);
    await as(db, { uid: w.admin });
    const reach = await rows<{ recipients: number }>(db, "select * from line_reach($1)", [
      [w.yala1],
    ]);
    expect(reach[0]!.recipients).toBe(2);
  });
});

describe("what only Jaga's server may do", () => {
  it("a follow, a block or a status question needs the gate token", async () => {
    for (const caller of ["anon", { uid: w.requester }, { uid: w.admin }] as const) {
      await as(db, caller);
      await expectDenied(db, "select line_follow_event($1, $2, false)", ["wrong-token", HOME]);
      await expectDenied(db, "select * from line_status_for($1, $2)", ["wrong-token", HOME]);
    }
  });

  it("the status is the alerts in force for that person's own places, never a drill", async () => {
    await alertFor([w.yala1]);
    await alertFor([w.yala1], true);
    await alertFor([w.songkhla]);
    await as(db, "anon");
    const mine = await rows<{ known: boolean; has_places: boolean; alerts: unknown[] }>(
      db,
      "select * from line_status_for($1, $2)",
      [TOKEN, HOME],
    );
    expect(mine[0]).toMatchObject({ known: true, has_places: true });
    expect(mine[0]!.alerts).toHaveLength(1);
    const stranger = await rows<{ known: boolean }>(db, "select * from line_status_for($1, $2)", [
      TOKEN,
      `U${"c".repeat(32)}`,
    ]);
    expect(stranger[0]!.known).toBe(false);
  });
});

describe("the month's quota", () => {
  it("is LINE's own figure, and the admins are warned once at 70% and once at 90%", async () => {
    const alert = await alertFor([w.yala1]);
    const record = async (used: number) => {
      await as(db, { uid: w.admin });
      const out = await rows<{ mark: number | null }>(
        db,
        "select line_record_alert($1, 2, 0, $2, 500) as mark",
        [alert, used],
      );
      await asOwner(db);
      return out[0]!.mark;
    };
    expect(await record(100)).toBeNull();
    expect(await record(350)).toBe(70);
    expect(await record(360)).toBeNull();
    expect(await record(460)).toBe(90);
    expect(await record(470)).toBeNull();
    const month = await rows<{ messages_used: number; monthly_limit: number }>(
      db,
      "select messages_used, monthly_limit from line_quota_usage",
    );
    expect(month).toEqual([{ messages_used: 470, monthly_limit: 500 }]);
    const sent = await rows<{ n: string }>(
      db,
      "select count(*) as n from alert_deliveries where alert_id = $1 and channel = 'line'",
      [alert],
    );
    expect(Number(sent[0]!.n)).toBe(5);
  });
});

describe("requests for help in LINE", () => {
  const TEAM = `U${"d".repeat(32)}`;
  const due = async () => {
    await as(db, "anon");
    const all = await rows<{
      kind: string;
      line_user_id: string;
      sos_id: string;
      data: Record<string, unknown>;
    }>(db, "select * from line_due($1)", [TOKEN]);
    await asOwner(db);
    return all.filter((r) => r.sos_id === w.yalaSos);
  };
  /** The team reports it done (the photo check is the board's business, tested elsewhere). */
  const reportDone = async () => {
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select * from authority_accept_sos($1)", [w.yalaSos]);
    await asOwner(db);
    await db.query(
      "update sos_claims set completed_at = now() where sos_id = $1 and released_at is null",
      [w.yalaSos],
    );
    await db.query("update sos_requests set status = 'rescued' where id = $1", [w.yalaSos]);
  };
  const answer = async (who: string, rescued: boolean) => {
    await as(db, "anon");
    const out = await rows<{ outcome: string }>(
      db,
      "select line_case_answer($1, $2, $3, $4) as outcome",
      [TOKEN, who, w.yalaSos, rescued],
    );
    await asOwner(db);
    return out[0]!.outcome;
  };

  beforeEach(async () => {
    await db.query("update profiles set line_user_id = $2 where user_id = $1", [
      w.yalaRescue.user,
      TEAM,
    ]);
  });

  it("only Jaga's server can ask what is owed or answer for a sender", async () => {
    for (const caller of ["anon", { uid: w.requester }, { uid: w.admin }] as const) {
      await as(db, caller);
      await expectDenied(db, "select * from line_due($1)", ["wrong-token"]);
      await expectDenied(db, "select line_case_answer($1, $2, $3, true)", [
        "wrong-token",
        HOME,
        w.yalaSos,
      ]);
    }
  });

  it("the offer goes to the LINE of the team whose turn it is, once, with a tambon and nothing about the person", async () => {
    const first = await due();
    expect(first.map((r) => [r.kind, r.line_user_id])).toEqual([["offer", TEAM]]);
    expect(Object.keys(first[0]!.data).sort()).toEqual([
      "expires_at",
      "request",
      "tambon_en",
      "tambon_th",
    ]);
    expect(await due()).toEqual([]);
  });

  it("once the team reports it done, the sender is asked in LINE, once", async () => {
    await due();
    await reportDone();
    const asked = await due();
    expect(asked.map((r) => [r.kind, r.line_user_id])).toEqual([["rescued", HOME]]);
    expect(asked[0]!.data.unit).toBe("Yala rescue");
    expect(await due()).toEqual([]);
  });

  it("only the sender's own LINE can answer; yes closes the case as the sender would", async () => {
    await reportDone();
    expect(await answer(TEAM, true)).toBe("not_yours");
    expect(await answer(HOME, true)).toBe("confirmed");
    const s = await rows<{ closed: boolean }>(
      db,
      "select closed_at is not null as closed from sos_requests where id = $1",
      [w.yalaSos],
    );
    expect(s[0]!.closed).toBe(true);
    const confirmed = await rows<{ method: string; confirmed_by: string }>(
      db,
      "select method, confirmed_by from rescue_confirmations where sos_id = $1",
      [w.yalaSos],
    );
    expect(confirmed).toEqual([{ method: "requester", confirmed_by: w.requester }]);
    // Pressed again later: nothing left to answer.
    expect(await answer(HOME, true)).toBe("closed");
  });

  it("no sends the case back to looking for a team, as the app's own button does", async () => {
    await reportDone();
    expect(await answer(HOME, false)).toBe("disputed");
    const s = await rows<{ status: string }>(db, "select status from sos_requests where id = $1", [
      w.yalaSos,
    ]);
    expect(s[0]!.status).toBe("received");
    const log = await rows(
      db,
      "select 1 from audit_log where action = 'rescue_disputed_line' and entity_id = $1",
      [w.yalaSos],
    );
    expect(log).toHaveLength(1);
  });

  it("the month's figures are for admins only", async () => {
    for (const caller of ["anon", { uid: w.requester }] as const) {
      await as(db, caller);
      await expectDenied(db, "select * from line_quota_now()");
    }
    await as(db, { uid: w.admin });
    await rows(db, "select * from line_quota_now()");
  });
});
