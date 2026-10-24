/**
 * T1: a team can have several people (design agreed 24 Oct 2026).
 *
 * What these tests guard:
 *  - every team has its registrant as an active owner, including one registered after the change
 *    (the trigger), so nothing that worked before stops working;
 *  - only the owner of a verified team can invite, change roles, approve or remove;
 *  - a code is stored only as a hash, works once, and opens nothing by itself: the person waits
 *    for the owner's yes, and until then reads nothing the team reads;
 *  - an approved dispatcher reads and acts on what the team's coverage allows, nowhere else, and
 *    every phone they reveal is logged under their own account (safety rule 5);
 *  - removing a member, or suspending the team, closes the door at once;
 *  - a field member has no board in this step;
 *  - ten wrong codes in an hour lock the account out, and the failures are counted.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, createUser, expectDenied, rows } from "./db";

/** A new account, made as the database owner (a test may have switched to a caller before). */
const newUser = async (db: Client, name: string) => {
  await asOwner(db);
  return createUser(db, { name });
};
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

type Member = { id: string; role: string; status: string; user_id: string };

const memberRows = async (unit: string) => {
  await asOwner(db);
  return rows<Member>(db, "select * from authority_unit_members where unit_id = $1", [unit]);
};

/** The owner makes a code; returns it. */
const invite = async (role: "dispatcher" | "field" = "dispatcher") => {
  await as(db, { uid: w.yalaRescue.user });
  const [r] = await rows<{ code: string }>(db, "select * from create_unit_invite($1, $2)", [
    w.yalaRescue.id,
    role,
  ]);
  return r!.code;
};

/** Someone redeems a code; returns the rows the function gave back (none = did not work). */
const redeem = async (uid: string, code: string) => {
  await as(db, { uid });
  return rows<{ unit_id: string; member_status: string }>(
    db,
    "select * from redeem_unit_invite($1)",
    [code],
  );
};

/** A new person is invited, redeems, and the owner says yes. */
const joinAs = async (role: "dispatcher" | "field") => {
  const person = await newUser(db, `new ${role}`);
  const code = await invite(role);
  await redeem(person, code);
  const [m] = (await memberRows(w.yalaRescue.id)).filter((x) => x.user_id === person);
  await as(db, { uid: w.yalaRescue.user });
  await db.query("select decide_unit_member($1, true)", [m!.id]);
  return { person, memberId: m!.id };
};

const boardIds = async (uid: string) => {
  await as(db, { uid });
  return (await rows<{ sos_id: string }>(db, "select sos_id from authority_board(72)")).map(
    (r) => r.sos_id,
  );
};

describe("the registrant is the owner", () => {
  it("every unit in the world has an active owner row for its account", async () => {
    for (const u of [w.yalaRescue, w.yalaPlanning, w.yalaPending, w.songkhlaRescue]) {
      const got = await memberRows(u.id);
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({ role: "owner", status: "active", user_id: u.user });
    }
  });

  it("the owner still reads the board, exactly as before", async () => {
    expect(await boardIds(w.yalaRescue.user)).toContain(w.yalaSos);
  });

  it("still works if the owner row were missing: the registrant is the owner by user_id", async () => {
    await asOwner(db);
    await db.query("delete from authority_unit_members where unit_id = $1", [w.yalaRescue.id]);
    expect(await boardIds(w.yalaRescue.user)).toContain(w.yalaSos);
  });
});

describe("inviting", () => {
  it("only the owner of a verified team can make a code", async () => {
    for (const caller of [w.otherUser, w.requester, w.songkhlaRescue.user, w.admin]) {
      await as(db, { uid: caller });
      expect(
        await expectDenied(db, "select * from create_unit_invite($1, 'dispatcher')", [
          w.yalaRescue.id,
        ]),
      ).toBe("42501");
    }
    await as(db, "anon");
    await expectDenied(db, "select * from create_unit_invite($1, 'dispatcher')", [w.yalaRescue.id]);
  });

  it("a team that is not verified cannot invite, and a code cannot make an owner", async () => {
    await as(db, { uid: w.yalaPending.user });
    expect(
      await expectDenied(db, "select * from create_unit_invite($1, 'dispatcher')", [
        w.yalaPending.id,
      ]),
    ).toBe("42501");
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(db, "select * from create_unit_invite($1, 'owner')", [w.yalaRescue.id]);
  });

  it("keeps only a hash of the code", async () => {
    const code = await invite();
    await asOwner(db);
    const stored = await rows<{ code_hash: string }>(
      db,
      "select code_hash from authority_unit_invites where unit_id = $1",
      [w.yalaRescue.id],
    );
    expect(stored).toHaveLength(1);
    expect(stored[0]!.code_hash).not.toContain(code);
    expect(stored[0]!.code_hash).toHaveLength(64);
  });

  it("nobody but the owner reads the invitations or the team", async () => {
    await invite();
    await as(db, { uid: w.otherUser });
    // The table itself is closed to clients; the owner reads it through unit_open_invites().
    expect(await expectDenied(db, "select * from authority_unit_invites")).toBe("42501");
    expect(await expectDenied(db, "select * from unit_open_invites($1)", [w.yalaRescue.id])).toBe(
      "42501",
    );
    expect(await expectDenied(db, "select * from unit_team($1)", [w.yalaRescue.id])).toBe("42501");
    await as(db, { uid: w.yalaRescue.user });
    expect(await rows(db, "select * from unit_open_invites($1)", [w.yalaRescue.id])).toHaveLength(
      1,
    );
  });
});

describe("joining", () => {
  it("a code puts the person in the waiting list and opens nothing", async () => {
    const code = await invite();
    const got = await redeem(w.otherUser, code);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ unit_id: w.yalaRescue.id, member_status: "pending" });
    // Waiting: no board, and the team's SOS stays unreadable.
    await as(db, { uid: w.otherUser });
    await expectDenied(db, "select * from authority_board(72)");
    expect(await rows(db, "select 1 from sos_requests")).toHaveLength(0);
    expect(await expectDenied(db, "select reveal_sos_phone($1)", [w.yalaSos])).toBe("42501");
  });

  it("works once", async () => {
    const code = await invite();
    expect(await redeem(w.otherUser, code)).toHaveLength(1);
    const second = await newUser(db, "second");
    expect(await redeem(second, code)).toHaveLength(0);
  });

  it("a wrong, cancelled or expired code gives nothing and is counted", async () => {
    expect(await redeem(w.otherUser, "ZZZZZZZZZZ")).toHaveLength(0);
    const code = await invite();
    await as(db, { uid: w.yalaRescue.user });
    const [open] = await rows<{ invite_id: string }>(db, "select * from unit_open_invites($1)", [
      w.yalaRescue.id,
    ]);
    await db.query("select revoke_unit_invite($1)", [open!.invite_id]);
    expect(await redeem(w.otherUser, code)).toHaveLength(0);

    const code2 = await invite();
    await asOwner(db);
    await db.query(
      "update authority_unit_invites set expires_at = now() - interval '1 minute' where used_at is null and revoked_at is null",
    );
    expect(await redeem(w.otherUser, code2)).toHaveLength(0);

    await asOwner(db);
    const [n] = await rows<{ n: string }>(
      db,
      "select count(*) n from audit_log where actor = $1 and action = 'unit_invite_failed'",
      [w.otherUser],
    );
    expect(Number(n!.n)).toBe(3);
  });

  it("locks out an account after ten wrong codes in an hour", async () => {
    for (let i = 0; i < 10; i++) await redeem(w.otherUser, `BAD${i}BAD${i}`);
    await as(db, { uid: w.otherUser });
    expect(await expectDenied(db, "select * from redeem_unit_invite('ANYTHING')")).toBe("54000");
    // Even the right code does not get through while locked.
    const code = await invite();
    await as(db, { uid: w.otherUser });
    expect(await expectDenied(db, "select * from redeem_unit_invite($1)", [code])).toBe("54000");
  });

  it("a code for a team that was suspended since does not work", async () => {
    const code = await invite();
    await asOwner(db);
    await db.query("update authority_units set status = 'suspended' where id = $1", [
      w.yalaRescue.id,
    ]);
    expect(await redeem(w.otherUser, code)).toHaveLength(0);
  });

  it("joining twice changes nothing and keeps the second code good", async () => {
    await redeem(w.otherUser, await invite());
    const again = await invite();
    const got = await redeem(w.otherUser, again);
    expect(got).toHaveLength(1);
    expect(got[0]!.member_status).toBe("pending");
    // The code was not used up by the repeat, so someone else can still use it.
    const third = await newUser(db, "third");
    expect(await redeem(third, again)).toHaveLength(1);
  });
});

describe("the owner's decision", () => {
  it("only the owner can say yes or no, and the dispatcher cannot", async () => {
    const code = await invite();
    await redeem(w.otherUser, code);
    const [m] = (await memberRows(w.yalaRescue.id)).filter((x) => x.user_id === w.otherUser);
    for (const caller of [w.otherUser, w.requester, w.yalaPlanning.user]) {
      await as(db, { uid: caller });
      expect(await expectDenied(db, "select decide_unit_member($1, true)", [m!.id])).toBe("42501");
    }
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select decide_unit_member($1, true)", [m!.id]);
    expect((await memberRows(w.yalaRescue.id)).find((x) => x.id === m!.id)!.status).toBe("active");
  });

  it("a no keeps the person out, and the owner cannot be removed", async () => {
    const code = await invite();
    await redeem(w.otherUser, code);
    const [m] = (await memberRows(w.yalaRescue.id)).filter((x) => x.user_id === w.otherUser);
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select decide_unit_member($1, false)", [m!.id]);
    await as(db, { uid: w.otherUser });
    await expectDenied(db, "select * from authority_board(72)");
    const [owner] = (await memberRows(w.yalaRescue.id)).filter((x) => x.role === "owner");
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(db, "select remove_unit_member($1)", [owner!.id]);
  });

  it("every decision is written to the audit log", async () => {
    const { person } = await joinAs("dispatcher");
    await asOwner(db);
    const [n] = await rows<{ n: string }>(
      db,
      "select count(*) n from audit_log where entity_id = $1 and action in ('unit_invite_created', 'unit_invite_redeemed', 'unit_member_approved')",
      [w.yalaRescue.id],
    );
    expect(Number(n!.n)).toBe(3);
    expect(person).toBeTruthy();
  });
});

describe("an approved dispatcher", () => {
  it("reads the team's board and cases, and only in the team's coverage", async () => {
    const { person } = await joinAs("dispatcher");
    const ids = await boardIds(person);
    expect(ids).toContain(w.yalaSos);
    expect(ids).not.toContain(w.songkhlaSos);
    await as(db, { uid: person });
    const seen = await rows<{ id: string }>(db, "select id from sos_requests");
    expect(seen.map((r) => r.id)).toContain(w.yalaSos);
    expect(seen.map((r) => r.id)).not.toContain(w.songkhlaSos);
  });

  it("accepts a case for the team, and a phone they look at is logged under their own account", async () => {
    const { person } = await joinAs("dispatcher");
    await as(db, { uid: person });
    await db.query("select * from authority_accept_sos($1)", [w.yalaSos]);
    const [phone] = await rows<{ phone: string }>(db, "select reveal_sos_phone($1) as phone", [
      w.yalaSos,
    ]);
    expect(phone!.phone).toBe("66811111111");
    await asOwner(db);
    const [log] = await rows<{ actor: string }>(
      db,
      "select actor from audit_log where action = 'reveal_phone' and entity_id = $1",
      [w.yalaSos],
    );
    expect(log!.actor).toBe(person);
    const [claim] = await rows<{ unit_id: string }>(
      db,
      "select unit_id from sos_claims where sos_id = $1 and released_at is null",
      [w.yalaSos],
    );
    expect(claim!.unit_id).toBe(w.yalaRescue.id);
  });

  it("cannot invite, decide, remove, change a role or read the team page", async () => {
    const { person, memberId } = await joinAs("dispatcher");
    await as(db, { uid: person });
    for (const sql of [
      `select * from create_unit_invite('${w.yalaRescue.id}', 'dispatcher')`,
      `select remove_unit_member('${memberId}')`,
      `select set_unit_member_role('${memberId}', 'field')`,
      `select * from unit_team('${w.yalaRescue.id}')`,
      `select authority_set_phone_sharing('${w.yalaRescue.id}', false)`,
    ]) {
      expect(await expectDenied(db, sql)).toBe("42501");
    }
  });

  it("can switch the team on and off duty", async () => {
    const { person } = await joinAs("dispatcher");
    await as(db, { uid: person });
    const [r] = await rows<{ authority_set_duty: boolean }>(
      db,
      "select authority_set_duty($1, false)",
      [w.yalaRescue.id],
    );
    expect(r!.authority_set_duty).toBe(false);
  });

  it("reads only their own member row", async () => {
    const { person } = await joinAs("dispatcher");
    await as(db, { uid: person });
    const mine = await rows<Member>(db, "select * from authority_unit_members");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.user_id).toBe(person);
    const [m] = await rows<{ unit_id: string }>(db, "select * from my_memberships()");
    expect(m!.unit_id).toBe(w.yalaRescue.id);
  });

  it("a member of one team gets nothing from another", async () => {
    const { person } = await joinAs("dispatcher");
    await as(db, { uid: person });
    expect(
      await expectDenied(db, "select * from reveal_poc_phone($1)", [w.songkhlaRescue.id]),
    ).toBe("42501");
  });
});

describe("the door closes", () => {
  it("at once when the owner removes someone", async () => {
    const { person, memberId } = await joinAs("dispatcher");
    expect(await boardIds(person)).toContain(w.yalaSos);
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select remove_unit_member($1)", [memberId]);
    await as(db, { uid: person });
    await expectDenied(db, "select * from authority_board(72)");
    expect(await rows(db, "select 1 from sos_requests")).toHaveLength(0);
  });

  it("a removed person can ask again with a new code, and waits again", async () => {
    const { person, memberId } = await joinAs("dispatcher");
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select remove_unit_member($1)", [memberId]);
    const got = await redeem(person, await invite());
    expect(got[0]!.member_status).toBe("pending");
    await as(db, { uid: person });
    await expectDenied(db, "select * from authority_board(72)");
  });

  it("when the team is suspended, its people lose the board with the owner", async () => {
    const { person } = await joinAs("dispatcher");
    await asOwner(db);
    await db.query("update authority_units set status = 'suspended' where id = $1", [
      w.yalaRescue.id,
    ]);
    await as(db, { uid: person });
    await expectDenied(db, "select * from authority_board(72)");
    await as(db, { uid: w.yalaRescue.user });
    await expectDenied(db, "select * from authority_board(72)");
  });

  it("a field member has no board in this step", async () => {
    const { person } = await joinAs("field");
    await as(db, { uid: person });
    await expectDenied(db, "select * from authority_board(72)");
    expect(await rows(db, "select 1 from sos_requests")).toHaveLength(0);
    await expectDenied(db, "select * from authority_households()");
  });

  it("changing a dispatcher to field takes the board away", async () => {
    const { person, memberId } = await joinAs("dispatcher");
    await as(db, { uid: w.yalaRescue.user });
    await db.query("select set_unit_member_role($1, 'field')", [memberId]);
    await as(db, { uid: person });
    await expectDenied(db, "select * from authority_board(72)");
  });
});

describe("who is told", () => {
  it("an offer rings the owner and the active dispatchers, not the waiting or the field", async () => {
    const dispatcher = await joinAs("dispatcher");
    const field = await joinAs("field");
    const waiting = await newUser(db, "waiting");
    await redeem(waiting, await invite());
    await asOwner(db);
    const told = (
      await rows<{ u: string }>(db, "select unit_notify_users($1) as u", [w.yalaRescue.id])
    ).map((r) => r.u);
    expect(told).toContain(w.yalaRescue.user);
    expect(told).toContain(dispatcher.person);
    expect(told).not.toContain(field.person);
    expect(told).not.toContain(waiting);
  });

  it("clients cannot ask whether a named person is on a named team", async () => {
    await as(db, { uid: w.otherUser });
    expect(
      await expectDenied(db, "select unit_access($1, $2)", [w.yalaRescue.id, w.yalaRescue.user]),
    ).toBe("42501");
  });
});
