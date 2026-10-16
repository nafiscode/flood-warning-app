/**
 * A10: an admin turns a registration down, with a reason the team is told (owner, 16 Oct 2026).
 *
 * What these tests guard:
 *  - only an admin can turn a registration down, and only one that is still waiting;
 *  - a reason is required, because the team is shown it;
 *  - the reason is written to the audit log, which stays admins-only;
 *  - the team reads the reason on its own registration through `my_unit_reviews()` and sees
 *    nobody else's, and reads nothing once the unit is verified after all;
 *  - the decision reaches LINE like the other three, carrying the reason.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

const TOKEN = "test-gate-token-0123456789abcdef0123456789";
const TEAM = `U${"e".repeat(32)}`;
const REASON = "This looks like a test registration, not a response unit.";

const statusOf = async (unit: string) =>
  (
    await rows<{ status: string }>(db, "select status from authority_units where id = $1", [unit])
  )[0]?.status;

const myReviews = async (uid: string) => {
  await as(db, { uid });
  const got = await rows<{ unit_id: string; reason: string }>(
    db,
    "select * from my_unit_reviews()",
  );
  await asOwner(db);
  return got;
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
});
afterEach(async () => {
  await db.query("rollback");
});

describe("turning a registration down", () => {
  it("only an admin may do it, and only with a reason", async () => {
    const unit = w.yalaPending.id;
    for (const caller of ["anon", { uid: w.yalaPending.user }, { uid: w.requester }] as const) {
      await as(db, caller);
      expect(
        await expectDenied(db, "select reject_authority_unit($1, $2)", [unit, REASON]),
        JSON.stringify(caller),
      ).toBe("42501");
    }
    await as(db, { uid: w.admin });
    for (const empty of ["", "  ", "no"]) {
      expect(await expectDenied(db, "select reject_authority_unit($1, $2)", [unit, empty])).toBe(
        "23514",
      );
    }
    await asOwner(db);
    expect(await statusOf(unit)).toBe("pending");
  });

  it("marks it rejected, writes the reason to the audit log, and leaves the row in place", async () => {
    const unit = w.yalaPending.id;
    await as(db, { uid: w.admin });
    await db.query("select reject_authority_unit($1, $2)", [unit, ` ${REASON} `]);
    await asOwner(db);
    expect(await statusOf(unit)).toBe("rejected");
    // The registration is kept, not deleted: the contact and the coverage are still there.
    expect(
      await rows(db, "select 1 from authority_unit_contacts where unit_id = $1", [unit]),
    ).toHaveLength(1);
    const log = await rows<{ actor: string; details: { reason: string } }>(
      db,
      "select actor, details from audit_log where action = 'reject_authority' and entity_id = $1",
      [unit],
    );
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor: w.admin, details: { reason: REASON } });
    // It stays a plain user: turning a registration down grants nothing.
    expect(
      await rows<{ role: string }>(db, "select role from profiles where user_id = $1", [
        w.yalaPending.user,
      ]),
    ).toEqual([{ role: "user" }]);
  });

  it("refuses a registration that is no longer waiting; a verified team is suspended instead", async () => {
    const unit = w.yalaRescue.id;
    await as(db, { uid: w.admin });
    expect(await expectDenied(db, "select reject_authority_unit($1, $2)", [unit, REASON])).toBe(
      "23514",
    );
    // And a second no on the same registration does nothing.
    await db.query("select reject_authority_unit($1, $2)", [w.yalaPending.id, REASON]);
    expect(
      await expectDenied(db, "select reject_authority_unit($1, $2)", [w.yalaPending.id, REASON]),
    ).toBe("23514");
    expect(
      await expectDenied(db, "select reject_authority_unit($1, $2)", [
        "00000000-0000-4000-8000-000000000000",
        REASON,
      ]),
    ).toBe("P0002");
  });
});

describe("the team reads why", () => {
  it("reads the reason on its own registration, and nobody else's", async () => {
    const unit = w.yalaPending.id;
    await as(db, { uid: w.admin });
    await db.query("select reject_authority_unit($1, $2)", [unit, REASON]);
    await asOwner(db);

    expect(await myReviews(w.yalaPending.user)).toMatchObject([{ unit_id: unit, reason: REASON }]);
    // Another signed-in person, and a verified team that may read every unit row, read nothing.
    expect(await myReviews(w.requester)).toEqual([]);
    expect(await myReviews(w.yalaRescue.user)).toEqual([]);
    await as(db, "anon");
    expect(await expectDenied(db, "select * from my_unit_reviews()")).toBe("42501");
    await asOwner(db);

    // The words live in the audit log, which nobody but an admin may read.
    await as(db, { uid: w.yalaPending.user });
    expect(await rows(db, "select 1 from audit_log")).toHaveLength(0);
    await asOwner(db);

    // Verified after all: there is nothing left to read.
    await as(db, { uid: w.admin });
    await db.query("select verify_authority_unit($1, true)", [unit]);
    await asOwner(db);
    expect(await statusOf(unit)).toBe("verified");
    expect(await myReviews(w.yalaPending.user)).toEqual([]);
  });
});

describe("the decision reaches LINE", () => {
  it("is handed out once, to the account that registered, with the reason", async () => {
    await db.query(
      `insert into push_gate (id, token) values (true, $1)
       on conflict (id) do update set token = excluded.token`,
      [TOKEN],
    );
    await db.query("update profiles set line_user_id = null");
    await db.query("delete from line_follows");
    await db.query("update profiles set line_user_id = $2 where user_id = $1", [
      w.yalaPending.user,
      TEAM,
    ]);
    const due = async () => {
      await as(db, "anon");
      const got = await rows<{ kind: string; line_user_id: string; ref: string; data: unknown }>(
        db,
        "select * from line_decisions_due($1)",
        [TOKEN],
      );
      await asOwner(db);
      return got;
    };
    // Whatever the dev database still owes from real use is handed out first.
    await due();

    await as(db, { uid: w.admin });
    await db.query("select reject_authority_unit($1, $2)", [w.yalaPending.id, REASON]);
    const told = await due();
    expect(told.map((r) => [r.kind, r.line_user_id, r.ref])).toEqual([
      ["unit_rejected", TEAM, w.yalaPending.id],
    ]);
    expect(told[0]!.data).toEqual({ unit: "Yala pending", reason: REASON });
    expect(await due()).toEqual([]);
  });
});
