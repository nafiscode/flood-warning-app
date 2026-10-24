/**
 * T2: a claimed case can be handed to named people on the team (design agreed 24 Oct 2026).
 *
 * What these tests guard (safety rule 5, as the owner reworded it on 24 Oct):
 *  - only the owner and dispatchers of the team that holds a case can hand it out, and only to
 *    someone on that team; a crew member can also take an open case their team holds;
 *  - an assigned crew member reads the exact point of THAT case and its phone number (logged under
 *    their own account), reports en route / on site / rescued and attaches the photos;
 *  - they read nothing else: no board, no other case, no household, no case table rows;
 *  - the access ends when they are taken off, step off, the team gives the case back, or the case
 *    is reported rescued;
 *  - a team that does not hold the case, and people who are not on the team, get nothing.
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
  await asOwner(db);
});
afterEach(async () => {
  await db.query("rollback");
});

const newUser = async (name: string) => {
  await asOwner(db);
  return createUser(db, { name });
};

/** A new person joins the Yala rescue team in a role, approved by its owner. */
async function joinAs(role: "dispatcher" | "field") {
  const person = await newUser(`new ${role}`);
  await as(db, { uid: w.yalaRescue.user });
  const [inv] = await rows<{ code: string }>(db, "select * from create_unit_invite($1, $2)", [
    w.yalaRescue.id,
    role,
  ]);
  await as(db, { uid: person });
  await db.query("select * from redeem_unit_invite($1)", [inv!.code]);
  await asOwner(db);
  const [m] = await rows<{ id: string }>(
    db,
    "select id from authority_unit_members where unit_id = $1 and user_id = $2",
    [w.yalaRescue.id, person],
  );
  await as(db, { uid: w.yalaRescue.user });
  await db.query("select decide_unit_member($1, true)", [m!.id]);
  return person;
}

/** The team accepts the Yala case: it is now held by Yala rescue. */
async function accept() {
  await as(db, { uid: w.yalaRescue.user });
  await db.query("select * from authority_accept_sos($1)", [w.yalaSos]);
}

async function assign(user: string, caller = w.yalaRescue.user) {
  await as(db, { uid: caller });
  const [r] = await rows<{ assign_case: string | null }>(db, "select assign_case($1, $2)", [
    w.yalaSos,
    user,
  ]);
  return r!.assign_case;
}

const myCases = async (uid: string) => {
  await as(db, { uid });
  return rows<Record<string, unknown>>(db, "select * from my_assigned_cases()");
};

async function proof(name = "a.jpg") {
  await asOwner(db);
  const path = `${w.yalaSos}/proof/${name}`;
  await db.query("insert into storage.objects (bucket_id, name) values ('sos-media', $1)", [path]);
  return path;
}

describe("handing a case out", () => {
  it("the owner and a dispatcher can; a field member, a stranger and another team cannot", async () => {
    const field = await joinAs("field");
    const field2 = await joinAs("field");
    const dispatcher = await joinAs("dispatcher");
    await accept();
    expect(await assign(field)).toBeTruthy();
    expect(await assign(field2, dispatcher)).toBeTruthy();
    for (const caller of [field, w.otherUser, w.songkhlaRescue.user, w.requester]) {
      await as(db, { uid: caller });
      expect(await expectDenied(db, "select assign_case($1, $2)", [w.yalaSos, dispatcher])).toBe(
        "42501",
      );
    }
  });

  it("only to someone on the team, and only a case the team holds", async () => {
    await accept();
    await as(db, { uid: w.yalaRescue.user });
    expect(await expectDenied(db, "select assign_case($1, $2)", [w.yalaSos, w.otherUser])).toBe(
      "23514",
    );
    // Not held by anyone yet: nothing to hand out.
    await asOwner(db);
    await db.query("update sos_claims set released_at = now() where sos_id = $1", [w.yalaSos]);
    const field = await joinAs("field");
    expect(await assign(field).catch(() => "denied")).toBe("denied");
  });

  it("is idempotent, and the audit log says who handed it to whom", async () => {
    const field = await joinAs("field");
    await accept();
    expect(await assign(field)).toBeTruthy();
    expect(await assign(field)).toBeNull();
    await asOwner(db);
    const [n] = await rows<{ n: string }>(
      db,
      "select count(*) n from audit_log where action = 'case_assigned' and entity_id = $1 and actor = $2",
      [w.yalaSos, w.yalaRescue.user],
    );
    expect(Number(n!.n)).toBe(1);
  });

  it("a crew member takes an open case their team holds; another team's member cannot", async () => {
    const field = await joinAs("field");
    await accept();
    await as(db, { uid: field });
    const open = await rows<Record<string, unknown>>(db, "select * from my_team_open_cases()");
    expect(open).toHaveLength(1);
    // Tambon level only: no point, no phone.
    expect(Object.keys(open[0]!)).not.toContain("lat");
    expect(Object.keys(open[0]!)).not.toContain("has_phone");
    await db.query("select take_case($1)", [w.yalaSos]);
    expect(await myCases(field)).toHaveLength(1);
    await as(db, { uid: field });
    expect(await rows(db, "select * from my_team_open_cases()")).toHaveLength(0);

    await as(db, { uid: w.songkhlaRescue.user });
    expect(await expectDenied(db, "select take_case($1)", [w.yalaSos])).toBe("42501");
    await as(db, { uid: w.otherUser });
    expect(await expectDenied(db, "select take_case($1)", [w.yalaSos])).toBe("42501");
  });

  it("only the owner and dispatchers see the crew", async () => {
    const field = await joinAs("field");
    await accept();
    await assign(field);
    await as(db, { uid: w.yalaRescue.user });
    expect(await rows(db, "select * from unit_crew($1)", [w.yalaRescue.id])).toHaveLength(2);
    expect(await rows(db, "select * from unit_assignments($1)", [w.yalaRescue.id])).toHaveLength(1);
    await as(db, { uid: field });
    expect(await expectDenied(db, "select * from unit_crew($1)", [w.yalaRescue.id])).toBe("42501");
    expect(await expectDenied(db, "select * from unit_assignments($1)", [w.yalaRescue.id])).toBe(
      "42501",
    );
  });
});

describe("an assigned crew member", () => {
  it("reads the exact point of the case and nothing else", async () => {
    const field = await joinAs("field");
    await accept();
    await assign(field);
    const got = await myCases(field);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ sos_id: w.yalaSos, has_phone: true });
    expect(typeof got[0]!.lat).toBe("number");
    expect(typeof got[0]!.lon).toBe("number");
    // No phone number travels in the list: that is a logged tap.
    expect(JSON.stringify(got[0])).not.toContain("66811111111");

    await as(db, { uid: field });
    await expectDenied(db, "select * from authority_board(72)");
    await expectDenied(db, "select * from authority_households()");
    expect(await rows(db, "select 1 from sos_requests")).toHaveLength(0);
    expect(await rows(db, "select 1 from sos_contacts")).toHaveLength(0);
    expect(await rows(db, "select 1 from households")).toHaveLength(0);
  });

  it("an unassigned member of the same team reads nothing of the case", async () => {
    const assigned = await joinAs("field");
    const other = await joinAs("field");
    await accept();
    await assign(assigned);
    expect(await myCases(other)).toHaveLength(0);
    await as(db, { uid: other });
    expect(await expectDenied(db, "select reveal_sos_phone($1)", [w.yalaSos])).toBe("42501");
    expect(
      await expectDenied(db, "select authority_advance_sos($1, 'en_route')", [w.yalaSos]),
    ).toBe("42501");
  });

  it("looks at the phone number, and the look is logged under their own account", async () => {
    const field = await joinAs("field");
    await accept();
    await assign(field);
    await as(db, { uid: field });
    const [r] = await rows<{ phone: string }>(db, "select reveal_sos_phone($1) as phone", [
      w.yalaSos,
    ]);
    expect(r!.phone).toBe("66811111111");
    await asOwner(db);
    const [log] = await rows<{ actor: string }>(
      db,
      "select actor from audit_log where action = 'reveal_phone' and entity_id = $1",
      [w.yalaSos],
    );
    expect(log!.actor).toBe(field);
    // Not the number of any other case.
    await as(db, { uid: field });
    expect(await expectDenied(db, "select reveal_sos_phone($1)", [w.songkhlaSos])).toBe("42501");
  });

  it("reports on the way, arrived and rescued, with photos they may upload", async () => {
    const field = await joinAs("field");
    await accept();
    await assign(field);
    const path = await proof();
    await as(db, { uid: field });
    expect(
      (
        await rows<{ ok: boolean }>(db, "select sos_media_writable($1) as ok", [
          `${w.yalaSos}/proof/b.jpg`,
        ])
      )[0]!.ok,
    ).toBe(true);
    await db.query("select authority_advance_sos($1, 'en_route')", [w.yalaSos]);
    await db.query("select authority_advance_sos($1, 'on_site')", [w.yalaSos]);
    await db.query("select authority_complete_sos($1, $2, 'all four out')", [w.yalaSos, [path]]);
    await asOwner(db);
    const [s] = await rows<{ status: string }>(
      db,
      "select status from sos_requests where id = $1",
      [w.yalaSos],
    );
    expect(s!.status).toBe("rescued");
    // Who did it is on the timeline.
    const events = await rows<{ event: string; actor_id: string }>(
      db,
      "select event, actor_id from sos_events where sos_id = $1 and event in ('en_route', 'on_site', 'rescued_by_team')",
      [w.yalaSos],
    );
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.actor_id === field)).toBe(true);
  });

  it("another case's folder stays closed to them", async () => {
    const field = await joinAs("field");
    await accept();
    await assign(field);
    await as(db, { uid: field });
    expect(
      (
        await rows<{ ok: boolean }>(db, "select sos_media_writable($1) as ok", [
          `${w.songkhlaSos}/proof/b.jpg`,
        ])
      )[0]!.ok,
    ).toBe(false);
  });
});

describe("the access ends", () => {
  it("when the owner takes them off", async () => {
    const field = await joinAs("field");
    await accept();
    await assign(field);
    await asOwner(db);
    const [a] = await rows<{ id: string }>(
      db,
      "select id from case_assignments where user_id = $1",
      [field],
    );
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select release_assignment($1)", [a!.id]);
    expect(await myCases(field)).toHaveLength(0);
    await as(db, { uid: field });
    expect(await expectDenied(db, "select reveal_sos_phone($1)", [w.yalaSos])).toBe("42501");
  });

  it("when they step off themselves, and nobody else can release it", async () => {
    const field = await joinAs("field");
    const other = await joinAs("field");
    await accept();
    await assign(field);
    await asOwner(db);
    const [a] = await rows<{ id: string }>(
      db,
      "select id from case_assignments where user_id = $1",
      [field],
    );
    await as(db, { uid: other });
    expect(await expectDenied(db, "select release_assignment($1)", [a!.id])).toBe("42501");
    await as(db, { uid: field });
    await db.query("select release_assignment($1)", [a!.id]);
    expect(await myCases(field)).toHaveLength(0);
  });

  it("when the team gives the case back", async () => {
    const field = await joinAs("field");
    await accept();
    await assign(field);
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select authority_release_sos($1, 'our boat is out')", [w.yalaSos]);
    expect(await myCases(field)).toHaveLength(0);
    await as(db, { uid: field });
    expect(await expectDenied(db, "select reveal_sos_phone($1)", [w.yalaSos])).toBe("42501");
  });

  it("when the case is reported rescued", async () => {
    const field = await joinAs("field");
    await accept();
    await assign(field);
    const path = await proof();
    await as(db, { uid: field });
    await db.query("select authority_complete_sos($1, $2, null)", [w.yalaSos, [path]]);
    expect(await myCases(field)).toHaveLength(0);
    await as(db, { uid: field });
    expect(await expectDenied(db, "select reveal_sos_phone($1)", [w.yalaSos])).toBe("42501");
  });

  it("when they are removed from the team", async () => {
    const field = await joinAs("field");
    await accept();
    await assign(field);
    await asOwner(db);
    const [m] = await rows<{ id: string }>(
      db,
      "select id from authority_unit_members where user_id = $1",
      [field],
    );
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select remove_unit_member($1)", [m!.id]);
    expect(await myCases(field)).toHaveLength(0);
  });

  it("when the team is suspended", async () => {
    const field = await joinAs("field");
    await accept();
    await assign(field);
    await asOwner(db);
    await db.query("update authority_units set status = 'suspended' where id = $1", [
      w.yalaRescue.id,
    ]);
    expect(await myCases(field)).toHaveLength(0);
  });
});

describe("the phone of a person handed a case", () => {
  const TOKEN = "test-gate-token-0123456789abcdef0123456789";
  const KEYS = JSON.stringify({ p256dh: "BPublicKeyOfThisBrowser", auth: "secret16" });
  const FIELD_PHONE = "https://fcm.googleapis.com/fcm/send/field-phone";
  const OTHER_PHONE = "https://fcm.googleapis.com/fcm/send/other-phone";

  type Due = { kind: string; endpoint: string; sos_id: string; data: Record<string, unknown> };
  const assignedFor = async () => {
    await as(db, "anon");
    const all = await rows<Due>(db, "select * from push_due($1)", [TOKEN]);
    await asOwner(db);
    return all.filter((r) => r.sos_id === w.yalaSos && r.kind === "assigned");
  };

  async function subscribe(uid: string, endpoint: string) {
    await as(db, { uid });
    await db.query("select push_subscribe($1, $2::jsonb, '{}', 'th')", [endpoint, KEYS]);
    await asOwner(db);
  }

  beforeEach(async () => {
    await asOwner(db);
    await db.query(
      `insert into push_gate (id, token) values (true, $1)
       on conflict (id) do update set token = excluded.token`,
      [TOKEN],
    );
  });

  it("is told once, with a tambon and a kind of request and nothing more", async () => {
    const field = await joinAs("field");
    const other = await joinAs("field");
    await subscribe(field, FIELD_PHONE);
    await subscribe(other, OTHER_PHONE);
    await accept();
    await assign(field);
    const first = await assignedFor();
    expect(first.map((r) => r.endpoint)).toEqual([FIELD_PHONE]);
    expect(Object.keys(first[0]!.data).sort()).toEqual(["request", "tambon_en", "tambon_th"]);
    expect(await assignedFor()).toHaveLength(0);
  });

  it("is not told about a case they took themselves", async () => {
    const field = await joinAs("field");
    await subscribe(field, FIELD_PHONE);
    await accept();
    await as(db, { uid: field });
    await db.query("select take_case($1)", [w.yalaSos]);
    expect(await assignedFor()).toHaveLength(0);
  });
});
