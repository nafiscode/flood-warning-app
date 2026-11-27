/**
 * Clearing the SOS cases nobody took in three days (owner, 27 Nov 2026). What is checked: that
 * only an admin can ask or clear; that "three days" counts from the last word of the SENDER (a
 * repeat send merged in keeps a case alive); that a case a unit holds, a fresh case and a closed
 * case are never cleared; that a clearing closes the case without deleting it, writes the
 * reason into its history and into audit_log; and that it can be reopened. Each test runs in its
 * own transaction on the dev database and is rolled back.
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

/** Make a case look as old as it would after `hours` without a word. */
const age = async (id: string, hours: number) => {
  await asOwner(db);
  await db.query(
    "update sos_requests set created_at = now() - make_interval(hours => $2) where id = $1",
    [id, hours],
  );
};

const staleIds = async () => {
  await as(db, { uid: w.admin });
  return (
    await rows<{ admin_sos_stale_ids: string }>(db, "select * from admin_sos_stale_ids()")
  ).map((r) => r.admin_sos_stale_ids);
};

const status = async (id: string) => {
  await asOwner(db);
  return (
    await rows<{ status: string; closed_at: string | null }>(
      db,
      "select status, closed_at from sos_requests where id = $1",
      [id],
    )
  )[0]!;
};

const events = async (id: string) => {
  await asOwner(db);
  return (
    await rows<{ event: string; note: string | null }>(
      db,
      "select event, note from sos_events where sos_id = $1 order by id",
      [id],
    )
  ).map((r) => r.event);
};

describe("which cases count as three days old", () => {
  it("lists an open case nobody holds once the sender has been silent for 72 hours", async () => {
    expect(await staleIds()).not.toContain(w.yalaSos);
    await age(w.yalaSos, 71);
    expect(await staleIds()).not.toContain(w.yalaSos);
    await age(w.yalaSos, 73);
    expect(await staleIds()).toContain(w.yalaSos);
  });

  it("keeps a case alive while its sender is still adding to it", async () => {
    await age(w.yalaSos, 100);
    await asOwner(db);
    await db.query("insert into sos_events (sos_id, event) values ($1, 'merged_update')", [
      w.yalaSos,
    ]);
    expect(await staleIds()).not.toContain(w.yalaSos);
    // An admin's note is not the sender speaking: it does not keep the case alive.
    await asOwner(db);
    await db.query(
      "update sos_events set created_at = now() - interval '90 hours' where sos_id = $1 and event = 'merged_update'",
      [w.yalaSos],
    );
    await db.query("insert into sos_events (sos_id, event) values ($1, 'admin_note')", [w.yalaSos]);
    expect(await staleIds()).toContain(w.yalaSos);
  });

  it("never lists a case a unit holds, or one that is closed", async () => {
    await age(w.yalaSos, 100);
    await age(w.songkhlaSos, 100);
    await asOwner(db);
    await db.query("insert into sos_claims (sos_id, unit_id) values ($1, $2)", [
      w.yalaSos,
      w.yalaRescue.id,
    ]);
    await db.query("update sos_requests set status = 'rescued', closed_at = now() where id = $1", [
      w.songkhlaSos,
    ]);
    const ids = await staleIds();
    expect(ids).not.toContain(w.yalaSos);
    expect(ids).not.toContain(w.songkhlaSos);
  });
});

describe("clearing one case", () => {
  it("closes it as dismissed, keeps it, and writes the reason into its history and the audit log", async () => {
    await age(w.yalaSos, 80);
    await as(db, { uid: w.admin });
    await db.query("select admin_sos_clear_stale($1, 'nobody heard from them for three days')", [
      w.yalaSos,
    ]);
    const after = await status(w.yalaSos);
    expect(after.status).toBe("dismissed");
    expect(after.closed_at).not.toBe(null);
    expect(await events(w.yalaSos)).toContain("cleared_obsolete");
    await asOwner(db);
    const note = await rows<{ note: string }>(
      db,
      "select note from sos_events where sos_id = $1 and event = 'cleared_obsolete'",
      [w.yalaSos],
    );
    expect(note[0]!.note).toBe("nobody heard from them for three days");
    const log = await rows<{ n: string }>(
      db,
      "select count(*) as n from audit_log where action = 'clear_stale_sos' and entity_id = $1 and actor = $2",
      [w.yalaSos, w.admin],
    );
    expect(Number(log[0]!.n)).toBe(1);
    // The case is still a row on the board's history window, not deleted.
    await as(db, { uid: w.admin });
    const board = await rows<{ sos_id: string; status: string }>(
      db,
      "select sos_id, status from admin_sos_board(720)",
    );
    expect(board.find((c) => c.sos_id === w.yalaSos)?.status).toBe("dismissed");
  });

  it("needs a reason", async () => {
    await age(w.yalaSos, 80);
    await as(db, { uid: w.admin });
    expect(await expectDenied(db, "select admin_sos_clear_stale($1, '   ')", [w.yalaSos])).toBe(
      "23514",
    );
    expect((await status(w.yalaSos)).status).toBe("received");
  });

  it("refuses a case heard from within 72 hours, a held case and a closed one", async () => {
    await as(db, { uid: w.admin });
    expect(
      await expectDenied(db, "select admin_sos_clear_stale($1, 'too early')", [w.yalaSos]),
    ).toBe("23514");

    await age(w.yalaSos, 80);
    await asOwner(db);
    await db.query("insert into sos_claims (sos_id, unit_id) values ($1, $2)", [
      w.yalaSos,
      w.yalaRescue.id,
    ]);
    await as(db, { uid: w.admin });
    expect(await expectDenied(db, "select admin_sos_clear_stale($1, 'held')", [w.yalaSos])).toBe(
      "23514",
    );

    await age(w.songkhlaSos, 80);
    await asOwner(db);
    await db.query("update sos_requests set status = 'rescued', closed_at = now() where id = $1", [
      w.songkhlaSos,
    ]);
    await as(db, { uid: w.admin });
    expect(
      await expectDenied(db, "select admin_sos_clear_stale($1, 'closed')", [w.songkhlaSos]),
    ).toBe("23514");
    expect((await status(w.yalaSos)).status).toBe("received");
  });
});

describe("clearing the whole fold", () => {
  it("clears every stale case it can and leaves the others alone", async () => {
    await age(w.yalaSos, 80);
    // The Songkhla case is fresh and stays.
    await as(db, { uid: w.admin });
    const n = (
      await rows<{ n: number }>(db, "select admin_sos_clear_stale_all('end of the week') as n")
    )[0]!.n;
    expect(n).toBeGreaterThanOrEqual(1);
    expect((await status(w.yalaSos)).status).toBe("dismissed");
    expect((await status(w.songkhlaSos)).status).toBe("received");
    expect(await staleIds()).toEqual([]);
  });

  it("needs a reason", async () => {
    await as(db, { uid: w.admin });
    expect(await expectDenied(db, "select admin_sos_clear_stale_all('')")).toBe("23514");
  });
});

describe("reopening", () => {
  it("brings a cleared case back, and only a cleared one", async () => {
    await age(w.yalaSos, 80);
    await as(db, { uid: w.admin });
    await db.query("select admin_sos_clear_stale($1, 'obsolete')", [w.yalaSos]);
    await db.query("select admin_sos_reopen($1)", [w.yalaSos]);
    const back = await status(w.yalaSos);
    expect(back.status).toBe("received");
    expect(back.closed_at).toBe(null);
    expect(await events(w.yalaSos)).toContain("reopened_by_admin");

    // Reopened once, it cannot be "reopened" again, and a case closed any other way is refused.
    await as(db, { uid: w.admin });
    expect(await expectDenied(db, "select admin_sos_reopen($1)", [w.yalaSos])).toBe("23514");
    await asOwner(db);
    await db.query("update sos_requests set status = 'rescued', closed_at = now() where id = $1", [
      w.songkhlaSos,
    ]);
    await as(db, { uid: w.admin });
    expect(await expectDenied(db, "select admin_sos_reopen($1)", [w.songkhlaSos])).toBe("23514");
  });
});

describe("who may do this", () => {
  it("is for admins only", async () => {
    await age(w.yalaSos, 80);
    const calls = [
      "select * from admin_sos_stale_ids()",
      `select admin_sos_clear_stale('${w.yalaSos}', 'no')`,
      "select admin_sos_clear_stale_all('no')",
      `select admin_sos_reopen('${w.yalaSos}')`,
    ];
    for (const caller of [w.requester, w.otherUser, w.yalaRescue.user, "anon" as const]) {
      for (const sql of calls) {
        await as(db, caller === "anon" ? "anon" : { uid: caller as string });
        const code = await expectDenied(db, sql);
        expect(["42501"], `${String(caller)}: ${sql}`).toContain(code);
      }
    }
    expect((await status(w.yalaSos)).status).toBe("received");
  });
});
