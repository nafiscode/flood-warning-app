/**
 * A5: the dispatch (spec 5.2 and 5.3).
 *
 * What these tests are really guarding:
 *  - a case starts looking for a team by itself, and a dispatch that cannot be built never costs
 *    the request (safety rule 1);
 *  - being offered a case is not what permits accepting it: any covering unit may accept at any
 *    time, including one the relay has already passed;
 *  - only one team can hold a case, whoever taps first;
 *  - the requester's one look at a responder's phone is fenced in and written to audit_log
 *    (safety rule 5, as amended on 9 Oct).
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

type Offer = { unit_id: string; tier: string; queue_pos: number; response: string | null };
type Holder = {
  dispatch_unit: string | null;
  dispatch_tier: string | null;
  expires_at: Date | null;
  exhausted: boolean;
};

const offers = (sosId: string) =>
  rows<Offer>(
    db,
    "select unit_id, tier, queue_pos, response from sos_offers where sos_id = $1 order by round, queue_pos",
    [sosId],
  );

// No rows at all means the relay was never built for this case: say so as null.
const holder = async (sosId: string): Promise<Holder | null> =>
  (await rows<Holder>(db, "select * from sos_offer_now($1)", [sosId]))[0] ?? null;

/** A second verified rescue unit in the same tambon, so there is a queue to walk. */
async function secondRescueUnit(name = "Yala rescue two") {
  await asOwner(db);
  const user = await createUser(db, { name, role: "authority" });
  const id = (
    await rows<{ id: string }>(
      db,
      `insert into authority_units (org_id, user_id, unit_name, capabilities, status)
       values ($1, $2, $3, '{rescue}'::authority_capability[], 'verified') returning id`,
      [w.org, user, name],
    )
  )[0]!.id;
  await db.query(
    "insert into authority_unit_contacts (unit_id, poc_name, poc_phone) values ($1, $2, '66830000009')",
    [id, `${name} POC`],
  );
  await db.query(
    "insert into authority_coverage (unit_id, tambon, selected_level, selected_code) values ($1, $2, 'tambon', $2)",
    [id, w.yala1],
  );
  return { user, id };
}

/** Pretend the relay started this many seconds ago, so a window can run out inside a test. */
async function relayStartedSecondsAgo(sosId: string, seconds: number) {
  await asOwner(db);
  await db.query(
    "update sos_requests set dispatch_started_at = now() - make_interval(secs => $2) where id = $1",
    [sosId, seconds],
  );
}

describe("the queue a new case builds", () => {
  it("asks the verified rescue units covering the tambon, and nobody else", async () => {
    const queue = await offers(w.yalaSos);
    expect(queue.map((o) => o.unit_id)).toEqual([w.yalaRescue.id]);
    // A planning-only unit and a unit still waiting for verification are never asked.
    expect(queue.map((o) => o.unit_id)).not.toContain(w.yalaPlanning.id);
    expect(queue.map((o) => o.unit_id)).not.toContain(w.yalaPending.id);
    // Nor is a unit in another province.
    expect(queue.map((o) => o.unit_id)).not.toContain(w.songkhlaRescue.id);
  });

  it("puts rescue before coordination", async () => {
    await asOwner(db);
    const coord = await createUser(db, { name: "Yala coordination", role: "authority" });
    const id = (
      await rows<{ id: string }>(
        db,
        `insert into authority_units (org_id, user_id, unit_name, capabilities, status)
         values ($1, $2, 'Yala coordination', '{coordination}'::authority_capability[], 'verified')
         returning id`,
        [w.org, coord],
      )
    )[0]!.id;
    await db.query(
      "insert into authority_coverage (unit_id, tambon, selected_level, selected_code) values ($1, $2, 'tambon', $2)",
      [id, w.yala1],
    );
    const sos = await newCaseInYala();
    const queue = await offers(sos);
    expect(queue.map((o) => o.tier)).toEqual(["rescue", "coordination"]);
    expect(queue[0]!.unit_id).toBe(w.yalaRescue.id);
  });

  it("still stores the request when there is no team to ask at all", async () => {
    // Safety rule 1: a request nobody covers is still a request, and the admins' monitor has it.
    await asOwner(db);
    const empty = (
      await rows<{ id: string }>(
        db,
        `insert into sos_requests (point, tambon) values
           ((select extensions.st_pointonsurface(geom) from tambons where code = $1), $1)
         returning id`,
        [w.yala2],
      )
    )[0]!.id;
    expect(empty).toBeTruthy();
    expect(await offers(empty)).toHaveLength(0);
    const now = await holder(empty);
    // No queue means nothing to walk: the case belongs to the admins from the first second.
    expect(now).toBeNull();
  });
});

async function newCaseInYala(): Promise<string> {
  await asOwner(db);
  return (
    await rows<{ id: string }>(
      db,
      `insert into sos_requests (point, tambon, people_count) values
         ((select extensions.st_pointonsurface(geom) from tambons where code = $1), $1, 2)
       returning id`,
      [w.yala1],
    )
  )[0]!.id;
}

describe("who is being asked, worked out from the clock", () => {
  it("names the first unit while its window is open", async () => {
    const now = await holder(w.yalaSos);
    expect(now?.dispatch_unit).toBe(w.yalaRescue.id);
    expect(now?.exhausted).toBe(false);
    expect(now?.expires_at).toBeInstanceOf(Date);
  });

  it("moves on to the next unit once the window has run out", async () => {
    const second = await secondRescueUnit();
    const sos = await newCaseInYala();
    const queue = await offers(sos);
    expect(queue).toHaveLength(2);

    // 70 seconds in, the first unit's 60-second window is over.
    await relayStartedSecondsAgo(sos, 70);
    const now = await holder(sos);
    expect(now?.dispatch_unit).toBe(queue[1]!.unit_id);
    expect([w.yalaRescue.id, second.id]).toContain(now?.dispatch_unit);
  });

  it("runs out, and then the case belongs to the admins", async () => {
    await relayStartedSecondsAgo(w.yalaSos, 60 * 60);
    const now = await holder(w.yalaSos);
    expect(now?.exhausted).toBe(true);
    expect(now?.dispatch_unit).toBeNull();
  });

  it("moves on the moment a unit declines, without burning the rest of the window", async () => {
    const second = await secondRescueUnit();
    const sos = await newCaseInYala();
    const [first] = await offers(sos);
    const firstUser = first!.unit_id === second.id ? second.user : w.yalaRescue.user;

    await as(db, { uid: firstUser });
    await db.query("select authority_decline_sos($1, 'too far, no boat')", [sos]);

    await asOwner(db);
    const now = await holder(sos);
    expect(now?.dispatch_unit).not.toBe(first!.unit_id);
    expect(now?.exhausted).toBe(false);
  });
});

describe("accepting", () => {
  type Accept = { claim: string; by_unit: string; by_unit_name: string; taken: boolean };

  it("takes the case, sets it to assigned and writes the timeline", async () => {
    await as(db, { uid: w.yalaRescue.user });
    const got = await one<Accept>("select * from authority_accept_sos($1)", [w.yalaSos]);
    expect(got.taken).toBe(false);
    expect(got.by_unit).toBe(w.yalaRescue.id);

    await asOwner(db);
    const s = await one<{ status: string }>("select status from sos_requests where id = $1", [
      w.yalaSos,
    ]);
    expect(s.status).toBe("assigned");
    const events = await rows<{ event: string }>(
      db,
      "select event from sos_events where sos_id = $1 order by created_at",
      [w.yalaSos],
    );
    expect(events.map((e) => e.event)).toContain("accepted");
    const queue = await offers(w.yalaSos);
    expect(queue[0]!.response).toBe("accepted");
  });

  it("gives the case to whoever is first, and tells the second it is taken", async () => {
    const second = await secondRescueUnit();
    await as(db, { uid: w.yalaRescue.user });
    const first = await one<Accept>("select * from authority_accept_sos($1)", [w.yalaSos]);
    expect(first.taken).toBe(false);

    await as(db, { uid: second.user });
    const late = await one<Accept>("select * from authority_accept_sos($1)", [w.yalaSos]);
    expect(late.taken).toBe(true);
    expect(late.by_unit).toBe(w.yalaRescue.id);

    await asOwner(db);
    const claims = await rows(
      db,
      "select id from sos_claims where sos_id = $1 and released_at is null",
      [w.yalaSos],
    );
    expect(claims).toHaveLength(1);
  });

  it("lets a unit the relay has already passed accept anyway", async () => {
    // The whole queue has run out; the case is with the admins. A covering team may still take it.
    await relayStartedSecondsAgo(w.yalaSos, 60 * 60);
    await as(db, { uid: w.yalaRescue.user });
    const got = await one<Accept>("select * from authority_accept_sos($1)", [w.yalaSos]);
    expect(got.taken).toBe(false);
    expect(got.by_unit).toBe(w.yalaRescue.id);
  });

  it("refuses a unit that does not cover the case", async () => {
    await as(db, { uid: w.songkhlaRescue.user });
    await expectDenied(db, "select * from authority_accept_sos($1)", [w.yalaSos]);
  });

  it("refuses a unit that is not verified", async () => {
    await as(db, { uid: w.yalaPending.user });
    await expectDenied(db, "select * from authority_accept_sos($1)", [w.yalaSos]);
  });
});

describe("the arrival estimate", () => {
  it("is given by the team holding the case, and nobody else", async () => {
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select * from authority_accept_sos($1)", [w.yalaSos]);
    await db.query("select authority_set_eta($1, 'to30')", [w.yalaSos]);

    await asOwner(db);
    const claim = await one<{ eta_band: string; eta_given_at: Date }>(
      "select eta_band, eta_given_at from sos_claims where sos_id = $1 and released_at is null",
      [w.yalaSos],
    );
    expect(claim.eta_band).toBe("to30");
    expect(claim.eta_given_at).toBeInstanceOf(Date);

    const second = await secondRescueUnit();
    await as(db, { uid: second.user });
    await expectDenied(db, "select authority_set_eta($1, 'under15')", [w.yalaSos]);
  });

  it("is never asked for before the case is accepted", async () => {
    // Nothing stands between a team and the case it is taking.
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(db, "select authority_set_eta($1, 'under15')", [w.yalaSos]);
  });
});

describe("giving a case back", () => {
  it("needs a reason", async () => {
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select * from authority_accept_sos($1)", [w.yalaSos]);
    await expectDenied(db, "select authority_release_sos($1, '  ')", [w.yalaSos]);
  });

  it("puts the case back to looking, in a new round without that team", async () => {
    const second = await secondRescueUnit();
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select * from authority_accept_sos($1)", [w.yalaSos]);
    await db.query("select authority_release_sos($1, 'our boat is out')", [w.yalaSos]);

    await asOwner(db);
    const s = await one<{ status: string }>("select status from sos_requests where id = $1", [
      w.yalaSos,
    ]);
    expect(s.status).toBe("received");
    const round2 = (await offers(w.yalaSos)).filter((o) => o.queue_pos >= 1);
    const second_round = await rows<Offer>(
      db,
      "select unit_id, tier, queue_pos, response from sos_offers where sos_id = $1 and round = 2",
      [w.yalaSos],
    );
    expect(round2.length).toBeGreaterThan(1);
    expect(second_round.map((o) => o.unit_id)).toEqual([second.id]);
    expect(second_round.map((o) => o.unit_id)).not.toContain(w.yalaRescue.id);
  });
});

describe("the board", () => {
  type Row = {
    sos_id: string;
    has_phone: boolean;
    offered_is_mine: boolean;
    claimed_is_mine: boolean;
    waiting_minutes: number;
    suspected_spam: boolean;
  };

  it("shows a unit the cases in its own coverage and no others", async () => {
    await as(db, { uid: w.yalaRescue.user });
    const board = await rows<Row>(db, "select * from authority_board(72)");
    expect(board.map((r) => r.sos_id)).toContain(w.yalaSos);
    expect(board.map((r) => r.sos_id)).not.toContain(w.songkhlaSos);
  });

  it("says there is a phone without giving it", async () => {
    await as(db, { uid: w.yalaRescue.user });
    const board = await rows<Record<string, unknown>>(db, "select * from authority_board(72)");
    const row = board.find((r) => r.sos_id === w.yalaSos)!;
    expect(row.has_phone).toBe(true);
    // No column of the board may carry a number.
    expect(JSON.stringify(row)).not.toContain("66811111111");
  });

  it("marks the case it is being offered, and the one it holds", async () => {
    await as(db, { uid: w.yalaRescue.user });
    let row = (await rows<Row>(db, "select * from authority_board(72)")).find(
      (r) => r.sos_id === w.yalaSos,
    )!;
    expect(row.offered_is_mine).toBe(true);
    expect(row.claimed_is_mine).toBe(false);

    await db.query("select * from authority_accept_sos($1)", [w.yalaSos]);
    row = (await rows<Row>(db, "select * from authority_board(72)")).find(
      (r) => r.sos_id === w.yalaSos,
    )!;
    expect(row.claimed_is_mine).toBe(true);
  });

  it("never hides a case flagged as suspected spam", async () => {
    await as(db, { uid: w.yalaRescue.user });
    const row = (await rows<Row>(db, "select * from authority_board(72)")).find(
      (r) => r.sos_id === w.yalaSos,
    )!;
    expect(row.suspected_spam).toBe(true);
  });

  it("is closed to everyone who is not a verified authority", async () => {
    await as(db, { uid: w.requester });
    await expectDenied(db, "select * from authority_board(72)");
    await as(db, "anon");
    await expectDenied(db, "select * from authority_board(72)");
  });
});

describe("what the person who asked for help sees", () => {
  type Responder = {
    unit_id: string | null;
    unit_name: string | null;
    org_name: string | null;
    eta_band: string | null;
    searching: boolean;
    exhausted: boolean;
    phone_available: boolean;
  };

  it("says a team is still being looked for before anyone accepts", async () => {
    await as(db, { uid: w.requester });
    const r = await one<Responder>("select * from sos_responder($1, null)", [w.yalaSos]);
    expect(r.searching).toBe(true);
    expect(r.unit_id).toBeNull();
    expect(r.exhausted).toBe(false);
  });

  it("names the team that accepted, with its estimate", async () => {
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select * from authority_accept_sos($1)", [w.yalaSos]);
    await db.query("select authority_set_eta($1, 'under15')", [w.yalaSos]);

    await as(db, { uid: w.requester });
    const r = await one<Responder>("select * from sos_responder($1, null)", [w.yalaSos]);
    expect(r.searching).toBe(false);
    expect(r.unit_id).toBe(w.yalaRescue.id);
    expect(r.unit_name).toBe("Yala rescue");
    expect(r.eta_band).toBe("under15");
    expect(r.phone_available).toBe(true);
  });

  it("is not readable by somebody else's account", async () => {
    await as(db, { uid: w.otherUser });
    await expectDenied(db, "select * from sos_responder($1, null)", [w.yalaSos]);
  });
});

describe("the one phone number a requester may see", () => {
  type Reveal = { phone: string; is_poc: boolean; unit_name: string };

  const accept = async () => {
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select * from authority_accept_sos($1)", [w.yalaSos]);
  };

  it("gives the POC of the team that is coming, and logs it", async () => {
    await accept();
    await as(db, { uid: w.requester });
    const r = await one<Reveal>("select * from reveal_responder_phone($1, null)", [w.yalaSos]);
    expect(r.phone).toBe("66830000001");
    expect(r.is_poc).toBe(true);

    await asOwner(db);
    const log = await rows<{ action: string }>(
      db,
      "select action from audit_log where entity_id = $1 and action = 'reveal_responder_phone'",
      [w.yalaSos],
    );
    expect(log).toHaveLength(1);
  });

  it("gives the organisation's number instead when the team turned sharing off", async () => {
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select authority_set_phone_sharing($1, false)", [w.yalaRescue.id]);
    await db.query("select * from authority_accept_sos($1)", [w.yalaSos]);

    await as(db, { uid: w.requester });
    const r = await one<Reveal>("select * from reveal_responder_phone($1, null)", [w.yalaSos]);
    expect(r.phone).toBe("073000000");
    expect(r.is_poc).toBe(false);
  });

  it("gives nothing before a team has accepted", async () => {
    await as(db, { uid: w.requester });
    await expectDenied(db, "select * from reveal_responder_phone($1, null)", [w.yalaSos]);
  });

  it("is closed to anyone but the person who sent the request", async () => {
    await accept();
    await as(db, { uid: w.otherUser });
    await expectDenied(db, "select * from reveal_responder_phone($1, null)", [w.yalaSos]);
    await as(db, "anon");
    await expectDenied(db, "select * from reveal_responder_phone($1, null)", [w.yalaSos]);
  });

  it("closes with the case", async () => {
    await accept();
    await asOwner(db);
    await db.query("update sos_requests set status = 'rescued', closed_at = now() where id = $1", [
      w.yalaSos,
    ]);
    await as(db, { uid: w.requester });
    await expectDenied(db, "select * from reveal_responder_phone($1, null)", [w.yalaSos]);
  });
});

describe("a unit's own switches", () => {
  it("lets a verified unit go off duty, and nobody else touch it", async () => {
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select authority_set_duty($1, false)", [w.yalaRescue.id]);
    await asOwner(db);
    const u = await one<{ on_duty: boolean }>("select on_duty from authority_units where id = $1", [
      w.yalaRescue.id,
    ]);
    expect(u.on_duty).toBe(false);

    await as(db, { uid: w.otherUser });
    await expectDenied(db, "select authority_set_duty($1, true)", [w.yalaRescue.id]);
  });

  it("offers an off-duty unit last, never not at all", async () => {
    const second = await secondRescueUnit();
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select authority_set_duty($1, false)", [w.yalaRescue.id]);

    const sos = await newCaseInYala();
    const queue = await offers(sos);
    expect(queue.map((o) => o.unit_id)).toEqual([second.id, w.yalaRescue.id]);
  });
});
