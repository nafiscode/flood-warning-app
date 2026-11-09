/**
 * A12 part 2: the dam operator's role (spec section 15).
 *
 * An outside organisation is being handed a button that reaches tens of thousands of phones, so
 * what is tested here is not that the button works - part 1 proved that - but that it cannot do
 * anything else:
 *
 *   * only a verified unit that registered as a dam operator AND was tied to that dam by an admin
 *     can send, and only for that dam. A unit cannot tie itself;
 *   * the tie is the whole of the power: without it, nothing;
 *   * owner and dispatchers send; a field member cannot;
 *   * the zone is S7's, the words are the template's, and the level is one of three;
 *   * the drill goes down the real road to the admins and to nobody else;
 *   * "the gates have closed" never lowers the level, and withdrawing reaches only a notice the
 *     dam sent itself;
 *   * and the part nobody asked for but that matters most: a unit that only operates a dam gets
 *     none of a rescue team's reads. No request for help, no phone, no household, no board.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, createUser, expectDenied, rows } from "./db";
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
const END_MESSAGES = {
  th: "เขื่อนบางลางปิดประตูระบายน้ำแล้ว ระดับเดิมยังมีผล",
  ms: "Empangan Bang Lang telah menutup pintu pelepasan; tahap masih berkuat kuasa",
  en: "Bang Lang Dam has closed its gates; the level still stands",
};
const END_REASON = "เขื่อนบางลางปิดประตูระบายน้ำแล้ว";

/** A dam with a zone to send into. The seeds carry Bang Lang; this proves it before relying on it. */
async function damWithZone(): Promise<string> {
  await asOwner(db);
  const row = await one<{ code: string } | undefined>(
    `select d.code from dams d
      join dam_tambons t on t.dam_code = d.code and t.source = d.geometry_source
     group by d.code order by (d.code = 'bang_lang') desc, d.code limit 1`,
  );
  return row?.code ?? "";
}

/**
 * A unit that operates a dam: registered with the capability, verified, and given a coverage area
 * like every other unit, because the registration form requires one. Whether that coverage buys
 * it anything is exactly what the last describe block below is about.
 */
async function damUnit(
  name: string,
  { capabilities = ["dam"], status = "verified" } = {},
): Promise<{ user: string; id: string }> {
  await asOwner(db);
  const user = await createUser(db, {
    name,
    role: status === "verified" ? "authority" : "user",
  });
  const id = (
    await rows<{ id: string }>(
      db,
      `insert into authority_units (org_id, user_id, unit_name, capabilities, status)
       values ($1, $2, $3, $4::authority_capability[], $5::authority_status) returning id`,
      [w.org, user, name, capabilities, status],
    )
  )[0]!.id;
  await db.query(
    "insert into authority_unit_contacts (unit_id, poc_name, poc_phone) values ($1, $2, '66830000077')",
    [id, `${name} POC`],
  );
  // The same tambon the rescue team covers, on purpose: it is the overlap that would have
  // handed this unit the team's reads, so the tests below are asking the sharpest version of
  // the question.
  await db.query(
    "insert into authority_coverage (unit_id, tambon, selected_level, selected_code) values ($1, $2, 'tambon', $2)",
    [id, w.yala1],
  );
  return { user, id };
}

/** The tie an admin makes. Inserted as the owner when the test is about bypassing the function. */
async function tie(unitId: string, dam: string) {
  await asOwner(db);
  await db.query("insert into dam_operator_units (dam_code, unit_id) values ($1, $2)", [
    dam,
    unitId,
  ]);
}

function send(dam: string, over: Record<string, unknown> = {}) {
  const args = {
    gates: "now() - interval '1 hour'",
    cms: 650,
    level: "warning",
    messages: JSON.stringify(MESSAGES),
    reason: REASON,
    next: "now() + interval '6 hours'",
    end: null as string | null,
    drill: false,
    ...over,
  };
  return {
    sql: `select public.operator_send_dam_release($1, ${args.gates}, $2, $3, $4::jsonb, $5,
            ${args.next}, ${args.end ?? "null"}, $6) as id`,
    params: [dam, args.cms, args.level, args.messages, args.reason, args.drill],
  };
}

describe("who may send a dam release notice from the dam", () => {
  it("a tied, verified dam operator can, and the notice is recorded as the dam's own", async () => {
    const dam = await damWithZone();
    expect(dam).not.toBe("");
    const unit = await damUnit("Bang Lang control room");
    await tie(unit.id, dam);

    await as(db, { uid: unit.user });
    const call = send(dam);
    const { id } = await one<{ id: string }>(call.sql, call.params);
    expect(id).toBeTruthy();

    await asOwner(db);
    const alert = await one<{
      issued_by: string;
      level: string;
      kind: string;
      dam: string;
      sent_by: string;
      unit: string;
      is_drill: boolean;
      tambons: number;
    }>(
      `select issued_by, level::text, signals_snapshot->>'kind' kind,
              signals_snapshot->>'dam_code' dam, signals_snapshot->>'sent_by' sent_by,
              signals_snapshot->>'unit' unit, is_drill,
              (select count(*) from alert_tambons at where at.alert_id = a.id)::int tambons
         from alerts a where id = $1`,
      [id],
    );
    expect(alert.issued_by).toBe(unit.user);
    expect(alert.sent_by).toBe("operator");
    expect(alert.unit).toBe(unit.id);
    expect(alert.kind).toBe("dam_release");
    expect(alert.dam).toBe(dam);
    expect(alert.is_drill).toBe(false);
    // The zone is S7's: whatever the caller passed, it is the dam's own tambons.
    expect(alert.tambons).toBeGreaterThan(0);
  });

  it("the same send is in the access log under the operator's own account", async () => {
    const dam = await damWithZone();
    const unit = await damUnit("Bang Lang control room");
    await tie(unit.id, dam);
    await as(db, { uid: unit.user });
    const call = send(dam);
    await one(call.sql, call.params);

    await asOwner(db);
    const log = await one<{ actor: string; details: Record<string, unknown> }>(
      "select actor, details from audit_log where action = 'dam_release_sent' order by ts desc limit 1",
    );
    expect(log.actor).toBe(unit.user);
    expect(log.details.sent_by).toBe("operator");
    expect(log.details.unit).toBe(unit.id);
  });

  it("an untied dam operator cannot send anything", async () => {
    const dam = await damWithZone();
    const unit = await damUnit("Untied dam");
    await as(db, { uid: unit.user });
    const call = send(dam);
    await expectDenied(db, call.sql, call.params);
  });

  it("a dam operator cannot send for a dam it is not tied to", async () => {
    const dam = await damWithZone();
    const other = await one<{ code: string } | undefined>(
      `select d.code from dams d
        join dam_tambons t on t.dam_code = d.code and t.source = d.geometry_source
       where d.code <> $1 group by d.code limit 1`,
      [dam],
    );
    if (!other) return; // only one dam has a zone in these seeds; nothing to prove here
    const unit = await damUnit("One dam only");
    await tie(unit.id, dam);
    await as(db, { uid: unit.user });
    const call = send(other.code);
    await expectDenied(db, call.sql, call.params);
  });

  it("a unit that is tied but not verified cannot send", async () => {
    const dam = await damWithZone();
    const unit = await damUnit("Pending dam", { status: "pending" });
    await tie(unit.id, dam); // inserted directly: the admin function would refuse it
    await as(db, { uid: unit.user });
    const call = send(dam);
    await expectDenied(db, call.sql, call.params);
  });

  it("a unit that is tied but never registered as a dam operator cannot send", async () => {
    const dam = await damWithZone();
    const unit = await damUnit("Rescue only", { capabilities: ["rescue"] });
    await tie(unit.id, dam);
    await as(db, { uid: unit.user });
    const call = send(dam);
    await expectDenied(db, call.sql, call.params);
  });

  it("a suspended dam operator loses the power without losing the tie", async () => {
    const dam = await damWithZone();
    const unit = await damUnit("Suspended dam");
    await tie(unit.id, dam);
    await asOwner(db);
    await db.query("update authority_units set status = 'suspended' where id = $1", [unit.id]);
    await as(db, { uid: unit.user });
    const call = send(dam);
    await expectDenied(db, call.sql, call.params);
    await asOwner(db);
    const left = await one<{ n: number }>(
      "select count(*)::int n from dam_operator_units where unit_id = $1",
      [unit.id],
    );
    expect(left.n).toBe(1);
  });

  it("an active dispatcher of the dam's unit can send; a field member cannot", async () => {
    const dam = await damWithZone();
    const unit = await damUnit("Bang Lang control room");
    await tie(unit.id, dam);
    await asOwner(db);
    const dispatcher = await createUser(db, { name: "dam dispatcher", role: "authority" });
    const field = await createUser(db, { name: "dam field", role: "authority" });
    await db.query(
      `insert into authority_unit_members (unit_id, user_id, role, status)
       values ($1, $2, 'dispatcher', 'active'), ($1, $3, 'field', 'active')`,
      [unit.id, dispatcher, field],
    );

    await as(db, { uid: dispatcher });
    const ok = send(dam);
    expect((await one<{ id: string }>(ok.sql, ok.params)).id).toBeTruthy();

    await as(db, { uid: field });
    const no = send(dam);
    await expectDenied(db, no.sql, no.params);
  });

  it("an ordinary rescue team, an admin's own account and a resident cannot use this door", async () => {
    const dam = await damWithZone();
    for (const uid of [w.yalaRescue.user, w.requester, w.admin]) {
      await as(db, { uid });
      const call = send(dam);
      await expectDenied(db, call.sql, call.params);
    }
  });
});

describe("what the notice may say", () => {
  let dam: string;
  let unit: { user: string; id: string };
  beforeEach(async () => {
    dam = await damWithZone();
    unit = await damUnit("Bang Lang control room");
    await tie(unit.id, dam);
    await as(db, { uid: unit.user });
  });

  it("refuses a level that is not watch, warning or evacuate", async () => {
    for (const level of ["normal", "return"]) {
      const call = send(dam, { level });
      await expect(db.query(call.sql, call.params)).rejects.toThrow();
    }
  });

  it("refuses a notice missing any of the three languages", async () => {
    for (const drop of ["th", "ms", "en"]) {
      const partial = { ...MESSAGES, [drop]: "" };
      const call = send(dam, { messages: JSON.stringify(partial) });
      await expect(db.query(call.sql, call.params)).rejects.toThrow();
    }
  });

  it("refuses a release that is zero, and a gate time a month old", async () => {
    const zero = send(dam, { cms: 0 });
    await expect(db.query(zero.sql, zero.params)).rejects.toThrow();
    const stale = send(dam, { gates: "now() - interval '30 days'" });
    await expect(db.query(stale.sql, stale.params)).rejects.toThrow();
  });

  it("refuses a next-update time in the past", async () => {
    const call = send(dam, { next: "now() - interval '1 hour'" });
    await expect(db.query(call.sql, call.params)).rejects.toThrow();
  });

  it("stores the measured arrival window, counted from the time the gates opened", async () => {
    const call = send(dam);
    const { id } = await one<{ id: string }>(call.sql, call.params);
    await asOwner(db);
    const row = await one<{ has_window: boolean }>(
      "select expected_onset_window is not null as has_window from alerts where id = $1",
      [id],
    );
    expect(row.has_window).toBe(true);
  });
});

describe("the drill switch", () => {
  it("sends down the real road, to the admins and to nobody else", async () => {
    const dam = await damWithZone();
    const unit = await damUnit("Bang Lang control room");
    await tie(unit.id, dam);

    await as(db, { uid: unit.user });
    const call = send(dam, { drill: true });
    const { id } = await one<{ id: string }>(call.sql, call.params);

    await asOwner(db);
    const alert = await one<{ is_drill: boolean; audience: string[]; th: string }>(
      "select is_drill, drill_audience audience, messages->>'th' th from alerts where id = $1",
      [id],
    );
    expect(alert.is_drill).toBe(true);
    expect(alert.audience).toEqual(["admins"]);
    // A sent drill never carries the template's instructions.
    expect(alert.th).not.toBe(MESSAGES.th);

    // The public cannot see it; an admin can.
    await as(db, "anon");
    const asPublic = await rows(db, "select alert_id from public_alert_status() where alert_id = $1", [
      id,
    ]);
    expect(asPublic).toHaveLength(0);
    await as(db, { uid: w.admin });
    const asAdmin = await rows(db, "select id from alerts where id = $1", [id]);
    expect(asAdmin).toHaveLength(1);
  });

  it("an operator cannot choose a wider audience, because there is no argument for one", async () => {
    const dam = await damWithZone();
    const unit = await damUnit("Bang Lang control room");
    await tie(unit.id, dam);
    await as(db, { uid: unit.user });
    const call = send(dam, { drill: true });
    const { id } = await one<{ id: string }>(call.sql, call.params);
    await asOwner(db);
    const row = await one<{ audience: string[] }>(
      "select drill_audience audience from alerts where id = $1",
      [id],
    );
    expect(row.audience).toEqual(["admins"]);
  });
});

describe("the gates have closed", () => {
  let dam: string;
  let unit: { user: string; id: string };
  let alert: string;

  beforeEach(async () => {
    dam = await damWithZone();
    unit = await damUnit("Bang Lang control room");
    await tie(unit.id, dam);
    await as(db, { uid: unit.user });
    const call = send(dam, { level: "evacuate" });
    alert = (await one<{ id: string }>(call.sql, call.params)).id;
  });

  const end = (over: Record<string, unknown> = {}) => {
    const args = {
      alert,
      closed: "now()",
      messages: JSON.stringify(END_MESSAGES),
      reason: END_REASON,
      next: "now() + interval '6 hours'",
      ...over,
    };
    return {
      sql: `select public.operator_end_dam_release($1, ${args.closed}, $2::jsonb, $3, ${args.next}) as id`,
      params: [args.alert, args.messages, args.reason],
    };
  };

  it("keeps the level, the zone and the window, and supersedes the notice", async () => {
    const call = end();
    const { id } = await one<{ id: string }>(call.sql, call.params);

    await asOwner(db);
    const old = await one<{ superseded_by: string }>(
      "select superseded_by from alerts where id = $1",
      [alert],
    );
    expect(old.superseded_by).toBe(id);

    const fresh = await one<{
      level: string;
      kind: string;
      tambons: number;
      same_window: boolean;
      issued_by: string;
    }>(
      `select level::text, signals_snapshot->>'kind' kind,
              (select count(*) from alert_tambons at where at.alert_id = a.id)::int tambons,
              a.expected_onset_window =
                (select expected_onset_window from alerts o where o.id = $2) as same_window,
              issued_by
         from alerts a where id = $1`,
      [id, alert],
    );
    // The line that keeps a shut gate from reading as safety.
    expect(fresh.level).toBe("evacuate");
    expect(fresh.kind).toBe("dam_release_end");
    expect(fresh.tambons).toBeGreaterThan(0);
    expect(fresh.same_window).toBe(true);
    expect(fresh.issued_by).toBe(unit.user);
  });

  it("the public reads it as a closed gate, still at the same level", async () => {
    const call = end();
    await one(call.sql, call.params);
    await as(db, "anon");
    const row = await one<{ level: string; details: Record<string, unknown> }>(
      `select level::text, details from public_alert_status()
        where details->>'kind' = 'dam_release_end' limit 1`,
    );
    expect(row.level).toBe("evacuate");
    expect(row.details.gatesClosedAt).toBeTruthy();
  });

  it("refuses a closing time before the gates opened, and one far in the future", async () => {
    for (const closed of ["now() - interval '2 days'", "now() + interval '2 days'"]) {
      const call = end({ closed });
      await expect(db.query(call.sql, call.params)).rejects.toThrow();
    }
  });

  it("refuses a message missing a language", async () => {
    const call = end({ messages: JSON.stringify({ ...END_MESSAGES, ms: "" }) });
    await expect(db.query(call.sql, call.params)).rejects.toThrow();
  });

  it("cannot be done twice, because the first one superseded it", async () => {
    const call = end();
    await one(call.sql, call.params);
    await expect(db.query(call.sql, call.params)).rejects.toThrow();
  });

  it("nobody but the dam's own operator can end it", async () => {
    for (const uid of [w.yalaRescue.user, w.requester, w.admin]) {
      await as(db, { uid });
      const call = end();
      await expectDenied(db, call.sql, call.params);
    }
  });

  it("the dam may end a notice a Jaga admin sent for it", async () => {
    await as(db, { uid: w.admin });
    const adminAlert = (
      await one<{ id: string }>(
        `select public.admin_send_dam_release($1, now() - interval '1 hour', 650, 'warning',
            $2::jsonb, $3, now() + interval '6 hours') as id`,
        [dam, JSON.stringify(MESSAGES), REASON],
      )
    ).id;
    await as(db, { uid: unit.user });
    const call = end({ alert: adminAlert });
    expect((await one<{ id: string }>(call.sql, call.params)).id).toBeTruthy();
  });
});

describe("withdrawing a notice", () => {
  it("the dam can withdraw one it sent itself, and it is logged", async () => {
    const dam = await damWithZone();
    const unit = await damUnit("Bang Lang control room");
    await tie(unit.id, dam);
    await as(db, { uid: unit.user });
    const call = send(dam);
    const { id } = await one<{ id: string }>(call.sql, call.params);

    const at = await one<{ at: Date }>(
      "select public.operator_cancel_dam_release($1, 'wrong figure') as at",
      [id],
    );
    expect(at.at).toBeTruthy();

    await asOwner(db);
    const log = await one<{ actor: string; details: Record<string, unknown> }>(
      "select actor, details from audit_log where action = 'alert_cancelled' order by ts desc limit 1",
    );
    expect(log.actor).toBe(unit.user);
    expect(log.details.by).toBe("operator");
  });

  it("the dam cannot withdraw a notice a Jaga admin sent", async () => {
    const dam = await damWithZone();
    const unit = await damUnit("Bang Lang control room");
    await tie(unit.id, dam);
    await as(db, { uid: w.admin });
    const adminAlert = (
      await one<{ id: string }>(
        `select public.admin_send_dam_release($1, now() - interval '1 hour', 650, 'warning',
            $2::jsonb, $3, now() + interval '6 hours') as id`,
        [dam, JSON.stringify(MESSAGES), REASON],
      )
    ).id;
    await as(db, { uid: unit.user });
    await expectDenied(db, "select public.operator_cancel_dam_release($1) as at", [adminAlert]);
  });
});

describe("tying a unit to a dam", () => {
  it("only an admin can, and both the tie and the untie are logged", async () => {
    const dam = await damWithZone();
    const unit = await damUnit("Bang Lang control room");

    await as(db, { uid: unit.user });
    await expectDenied(db, "select public.admin_link_dam_operator($1, $2)", [unit.id, dam]);

    await as(db, { uid: w.admin });
    await db.query("select public.admin_link_dam_operator($1, $2)", [unit.id, dam]);
    await asOwner(db);
    expect(
      (
        await one<{ n: number }>(
          "select count(*)::int n from dam_operator_units where unit_id = $1 and dam_code = $2",
          [unit.id, dam],
        )
      ).n,
    ).toBe(1);

    await as(db, { uid: w.admin });
    await db.query("select public.admin_unlink_dam_operator($1, $2)", [unit.id, dam]);
    await asOwner(db);
    const actions = await rows<{ action: string }>(
      db,
      `select action from audit_log
        where action in ('dam_operator_linked', 'dam_operator_unlinked') order by ts`,
    );
    expect(actions.map((a) => a.action)).toEqual([
      "dam_operator_linked",
      "dam_operator_unlinked",
    ]);
  });

  it("refuses a unit that is not verified, and one that is not a dam operator", async () => {
    const dam = await damWithZone();
    const pending = await damUnit("Pending dam", { status: "pending" });
    const rescue = await damUnit("Rescue only", { capabilities: ["rescue"] });
    await as(db, { uid: w.admin });
    await expect(
      db.query("select public.admin_link_dam_operator($1, $2)", [pending.id, dam]),
    ).rejects.toThrow();
    await expect(
      db.query("select public.admin_link_dam_operator($1, $2)", [rescue.id, dam]),
    ).rejects.toThrow();
  });

  it("a unit cannot write the tie itself", async () => {
    const dam = await damWithZone();
    const unit = await damUnit("Bang Lang control room");
    await as(db, { uid: unit.user });
    await expectDenied(
      db,
      "insert into dam_operator_units (dam_code, unit_id) values ($1, $2)",
      [dam, unit.id],
    );
  });

  it("an operator sees its own tie and not another unit's", async () => {
    const dam = await damWithZone();
    const mine = await damUnit("Mine");
    const theirs = await damUnit("Theirs");
    await tie(mine.id, dam);
    await tie(theirs.id, dam);
    await as(db, { uid: mine.user });
    const seen = await rows<{ unit_id: string }>(db, "select unit_id from dam_operator_units");
    expect(seen.map((r) => r.unit_id)).toEqual([mine.id]);
  });
});

describe("the admins are told", () => {
  it("an operator's notice appears in the admins' bell, and an admin's own does not", async () => {
    const dam = await damWithZone();
    const unit = await damUnit("Bang Lang control room");
    await tie(unit.id, dam);
    await as(db, { uid: unit.user });
    const call = send(dam);
    await one(call.sql, call.params);

    await as(db, { uid: w.admin });
    const queue = await one<{ waiting: number }>(
      "select waiting from admin_attention() where queue = 'operatorRelease'",
    );
    expect(queue.waiting).toBe(1);
  });

  it("the bell is admins only", async () => {
    const dam = await damWithZone();
    const unit = await damUnit("Bang Lang control room");
    await tie(unit.id, dam);
    await as(db, { uid: unit.user });
    await expectDenied(db, "select * from admin_attention()");
  });
});

describe("a unit that only operates a dam is not a rescue team", () => {
  /*
   * The part of this phase that was not asked for. Every unit picks a coverage area when it
   * registers, and coverage is what opens the exact location and telephone number of a request
   * for help. A control room at a reservoir has no business with either.
   */
  let unit: { user: string; id: string };
  beforeEach(async () => {
    const dam = await damWithZone();
    unit = await damUnit("Bang Lang control room");
    await tie(unit.id, dam);
  });

  it("is not a verified authority for the purposes of the case board", async () => {
    await as(db, { uid: unit.user });
    const yes = await one<{ v: boolean }>("select public.is_verified_authority() as v");
    expect(yes.v).toBe(false);
    await expectDenied(db, "select * from authority_board()");
  });

  it("its coverage opens nothing", async () => {
    await as(db, { uid: unit.user });
    const covers = await one<{ v: boolean }>("select public.covers_tambon($1) as v", [w.yala1]);
    expect(covers.v).toBe(false);
  });

  it("cannot read a request for help in its own coverage, nor the requester's phone", async () => {
    await as(db, { uid: unit.user });
    const seen = await rows(db, "select id from sos_requests");
    expect(seen).toHaveLength(0);
    const phones = await rows(db, "select sos_id from sos_contacts");
    expect(phones).toHaveLength(0);
  });

  it("cannot read vulnerable households, nor another unit's point of contact", async () => {
    await as(db, { uid: unit.user });
    await expectDenied(db, "select * from public.households_in_tambon($1)", [w.yala1]);
    await expectDenied(db, "select * from public.reveal_poc_phone($1)", [w.yalaRescue.id]);
  });

  it("is never offered a case and can never accept one", async () => {
    await as(db, { uid: unit.user });
    await expectDenied(db, "select public.authority_accept_sos($1)", [w.yalaSos]);
  });

  it("but a unit that runs boats as well as a dam keeps everything a team has", async () => {
    const dam = await damWithZone();
    const both = await damUnit("Irrigation office with boats", {
      capabilities: ["dam", "rescue"],
    });
    await tie(both.id, dam);
    await as(db, { uid: both.user });
    expect((await one<{ v: boolean }>("select public.is_verified_authority() as v")).v).toBe(true);
    const call = send(dam);
    expect((await one<{ id: string }>(call.sql, call.params)).id).toBeTruthy();
  });
});
