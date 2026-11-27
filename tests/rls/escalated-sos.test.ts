/**
 * An SOS nobody has taken for 30 minutes opens to every rescue team (owner, 27 Nov 2026; it
 * amends safety rule 5 for this one case). What is guarded here is how narrow the opening is:
 * who may read, which cases, what they carry, that the number is only ever given through a logged
 * reveal, that nothing that existed before has widened, and that every way a case stops being
 * unanswered closes the opening again. Each test runs in a transaction that is rolled back.
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
  // The fixture's cases are flagged as suspected nuisance sends; these tests start from a real one.
  await db.query("update sos_review set suspected_spam = false where sos_id = $1", [w.yalaSos]);
});
afterEach(async () => {
  await db.query("rollback");
});

/** Make the Yala case as old as it would be after `minutes` without an answer. */
const age = async (minutes: number) => {
  await asOwner(db);
  await db.query(
    "update sos_requests set created_at = now() - make_interval(mins => $2) where id = $1",
    [w.yalaSos, minutes],
  );
};

type Escalated = { sos_id: string; lat: number; lon: number; tambon: string } & Record<
  string,
  unknown
>;

const listFor = async (uid: string) => {
  await as(db, { uid });
  return rows<Escalated>(db, "select * from authority_escalated_cases()");
};
const sees = async (uid: string) => (await listFor(uid)).some((r) => r.sos_id === w.yalaSos);

const auditBy = async (action: string, actor: string) => {
  await asOwner(db);
  const r = await rows<{ n: string }>(
    db,
    "select count(*) as n from audit_log where action = $1 and actor = $2",
    [action, actor],
  );
  return Number(r[0]!.n);
};

describe("when a case opens to other teams", () => {
  it("is closed to a team outside the tambon until 30 minutes have passed", async () => {
    await age(29);
    expect(await sees(w.songkhlaRescue.user)).toBe(false);
    await age(31);
    expect(await sees(w.songkhlaRescue.user)).toBe(true);
  });

  it("follows the setting", async () => {
    await asOwner(db);
    await db.query(
      "update system_settings set value = '{\"minutes\": 10}'::jsonb where key = 'sos_escalate_minutes'",
    );
    await age(11);
    expect(await sees(w.songkhlaRescue.user)).toBe(true);
    await age(9);
    expect(await sees(w.songkhlaRescue.user)).toBe(false);
  });

  it("closes again the moment any way of being answered or finished happens", async () => {
    await age(60);
    expect(await sees(w.songkhlaRescue.user)).toBe(true);
    for (const [label, change] of [
      ["a unit accepts", null],
      ["the sender closes it", "status = 'safe_cancelled', closed_at = now()"],
      ["it is rescued", "status = 'rescued', closed_at = now()"],
      ["it is a request for supplies", "kind = 'supplies'"],
      ["it is merged into another", `duplicate_of = '${w.songkhlaSos}'`],
    ] as const) {
      await db.query("savepoint s");
      await asOwner(db);
      if (change) {
        await db.query(`update sos_requests set ${change} where id = $1`, [w.yalaSos]);
      } else {
        await db.query("insert into sos_claims (sos_id, unit_id) values ($1, $2)", [
          w.yalaSos,
          w.yalaRescue.id,
        ]);
      }
      expect(await sees(w.songkhlaRescue.user), label).toBe(false);
      await asOwner(db);
      await db.query("rollback to savepoint s");
    }
  });

  it("closes for a suspected nuisance send, and for a case nobody has heard from in 72 hours", async () => {
    await age(60);
    await asOwner(db);
    await db.query("update sos_review set suspected_spam = true where sos_id = $1", [w.yalaSos]);
    expect(await sees(w.songkhlaRescue.user)).toBe(false);
    await asOwner(db);
    await db.query("update sos_review set suspected_spam = false where sos_id = $1", [w.yalaSos]);
    await age(80 * 60);
    expect(await sees(w.songkhlaRescue.user)).toBe(false);
  });
});

describe("who may read it", () => {
  it("opens to the owner of a verified rescue team and to its active dispatcher", async () => {
    await age(45);
    expect(await sees(w.songkhlaRescue.user)).toBe(true);
    await asOwner(db);
    const dispatcher = await createUser(db, { name: "dispatcher", role: "authority" });
    await db.query(
      "insert into authority_unit_members (unit_id, user_id, role, status, decided_at) values ($1, $2, 'dispatcher', 'active', now())",
      [w.songkhlaRescue.id, dispatcher],
    );
    expect(await sees(dispatcher)).toBe(true);
  });

  it("stays closed to everyone else, on the list and on the number", async () => {
    await age(45);
    const fieldMember = await createUser(db, { name: "field member", role: "authority" });
    const damUser = await createUser(db, { name: "dam operator", role: "authority" });
    await asOwner(db);
    await db.query(
      "insert into authority_unit_members (unit_id, user_id, role, status, decided_at) values ($1, $2, 'field', 'active', now())",
      [w.songkhlaRescue.id, fieldMember],
    );
    const dam = (
      await rows<{ id: string }>(
        db,
        `insert into authority_units (org_id, user_id, unit_name, capabilities, status)
         values ($1, $2, 'Dam only', '{dam}'::authority_capability[], 'verified') returning id`,
        [w.org, damUser],
      )
    )[0]!.id;
    expect(dam).toBeTruthy();

    const closed = [
      w.requester, // an ordinary user, and the sender
      w.otherUser,
      fieldMember, // a field member reads only what is assigned to them
      damUser, // a dam operator is not a team in the field
      w.yalaPlanning.user, // planning holds no rescue capability
      w.yalaPending.user, // not verified yet
    ];
    for (const uid of closed) {
      await as(db, { uid });
      expect(await expectDenied(db, "select * from authority_escalated_cases()"), uid).toBe(
        "42501",
      );
      expect(
        await expectDenied(db, "select reveal_escalated_sos_phone($1)", [w.yalaSos]),
        uid,
      ).toBe("42501");
    }
    await as(db, "anon");
    expect(await expectDenied(db, "select * from authority_escalated_cases()")).toBe("42501");
    expect(await expectDenied(db, "select reveal_escalated_sos_phone($1)", [w.yalaSos])).toBe(
      "42501",
    );
  });

  it("leaves out a case inside the caller's own coverage: that is already on their board", async () => {
    await age(45);
    expect(await sees(w.yalaRescue.user)).toBe(false);
  });
});

describe("what it carries", () => {
  it("gives the point and the details, and never a phone number, a name, an account or a file", async () => {
    await age(45);
    const [r] = (await listFor(w.songkhlaRescue.user)).filter((x) => x.sos_id === w.yalaSos);
    expect(r).toBeDefined();
    expect(typeof r!.lat).toBe("number");
    expect(typeof r!.lon).toBe("number");
    expect(r!.tambon).toBe(w.yala1);
    expect(r!.has_phone).toBe(true);
    expect(Object.keys(r!).sort()).toEqual(
      [
        "accuracy_m",
        "created_at",
        "depth_ref",
        "district_th",
        "has_phone",
        "injuries",
        "lat",
        "location_text",
        "lon",
        "note",
        "on_behalf",
        "people_count",
        "province_th",
        "sos_id",
        "tambon",
        "tambon_en",
        "tambon_th",
        "vulnerable_flags",
        "waiting_minutes",
      ].sort(),
    );
    expect(JSON.stringify(r)).not.toContain("66811111111");
    expect(r!.waiting_minutes).toBeGreaterThanOrEqual(45);
  });

  it("logs the reading of the exact points", async () => {
    await age(45);
    await listFor(w.songkhlaRescue.user);
    expect(await auditBy("read_escalated_sos", w.songkhlaRescue.user)).toBe(1);
  });
});

describe("the number", () => {
  it("is given only through the logged reveal, once the case is open to other teams", async () => {
    await age(10);
    await as(db, { uid: w.songkhlaRescue.user });
    expect(await expectDenied(db, "select reveal_escalated_sos_phone($1)", [w.yalaSos])).toBe(
      "42501",
    );
    await age(45);
    await as(db, { uid: w.songkhlaRescue.user });
    const got = await rows<{ p: string | null }>(db, "select reveal_escalated_sos_phone($1) as p", [
      w.yalaSos,
    ]);
    expect(got[0]!.p).toBe("66811111111");
    expect(await auditBy("reveal_phone_escalated", w.songkhlaRescue.user)).toBe(1);
    // The log names the case and the caller's own team, and no number.
    await asOwner(db);
    const log = await rows<{ entity_id: string; details: Record<string, unknown> }>(
      db,
      "select entity_id, details from audit_log where action = 'reveal_phone_escalated' and actor = $1",
      [w.songkhlaRescue.user],
    );
    expect(log[0]!.entity_id).toBe(w.yalaSos);
    expect(log[0]!.details.units).toEqual([w.songkhlaRescue.id]);
    expect(JSON.stringify(log[0]!.details)).not.toContain("66811111111");
  });

  it("is refused again when the case is answered", async () => {
    await age(45);
    await asOwner(db);
    await db.query("insert into sos_claims (sos_id, unit_id) values ($1, $2)", [
      w.yalaSos,
      w.yalaRescue.id,
    ]);
    await as(db, { uid: w.songkhlaRescue.user });
    expect(await expectDenied(db, "select reveal_escalated_sos_phone($1)", [w.yalaSos])).toBe(
      "42501",
    );
  });
});

describe("nothing that existed before has widened", () => {
  it("still refuses the old reveal, the table and the board to a team outside the tambon", async () => {
    await age(60);
    await as(db, { uid: w.songkhlaRescue.user });
    expect(await expectDenied(db, "select reveal_sos_phone($1)", [w.yalaSos])).toBe("42501");
    const direct = await rows(db, "select id from sos_requests where id = $1", [w.yalaSos]);
    expect(direct).toHaveLength(0);
    const board = await rows<{ sos_id: string }>(db, "select * from authority_board(72)");
    expect(board.some((c) => c.sos_id === w.yalaSos)).toBe(false);
  });
});
