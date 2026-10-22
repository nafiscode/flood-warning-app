/**
 * A10: everything waiting for an admin, in one answer for the bell (owner, 22 Oct 2026).
 *
 * What these tests guard:
 *  - the queues are for admins only, like every other count in the console;
 *  - a queue is reported only while something is in it, so the bell has no line saying nought;
 *  - the fixtures' own pending team is counted, which is the queue the owner asked for first;
 *  - nothing personal crosses: a queue name, a count, an id and a time, and no more.
 */
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { as, asOwner, connect, expectDenied, rows } from "./db";
import { buildWorld, type World } from "./fixtures";

let db: Client;
let w: World;

type Row = { queue: string; waiting: number; newest_id: string | null; newest_at: string | null };

const attention = async (uid: string): Promise<Map<string, Row>> => {
  await as(db, { uid });
  const out = await rows<Row>(db, "select * from admin_attention()");
  await asOwner(db);
  return new Map(out.map((r) => [r.queue, r]));
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

describe("what waits for an admin", () => {
  it("is for admins only", async () => {
    for (const caller of ["anon", { uid: w.requester }, { uid: w.yalaRescue.user }] as const) {
      await as(db, caller);
      await expectDenied(db, "select * from admin_attention()", []);
    }
  });

  it("counts the team that registered and is waiting to be verified", async () => {
    // buildWorld registers one pending unit in Yala; it is exactly this queue.
    const queues = await attention(w.admin);
    expect(queues.get("units")?.waiting).toBe(1);
    expect(queues.get("units")?.newest_id).toBeTruthy();
  });

  it("reports nought for a queue with nothing in it, which the app then drops", async () => {
    // The function answers for every queue; leaving the empty ones out is the app's job, so
    // that one failed count can never silently hide a queue that does have something in it.
    const queues = await attention(w.admin);
    expect(queues.get("duplicates")?.waiting).toBe(0);
    expect(queues.get("duplicates")?.newest_id).toBeNull();
  });

  it("notices an alert that is past its next-update time, and not one that is not", async () => {
    // An alert must be issued before its next update is due, so a past update time needs a
    // past issue time with it.
    const insert = async (hours: number) =>
      rows<{ id: string }>(
        db,
        `insert into alerts (level, reason, messages, issued_by, issued_at, next_update_at)
         values ('warning', 'River rising', '{"th": "ระดับน้ำสูงขึ้น"}'::jsonb, $1, now() - interval '2 days',
                 now() + ($2 || ' hours')::interval)
         returning id`,
        [w.admin, String(hours)],
      );
    await insert(6);
    expect((await attention(w.admin)).get("staleAlerts")?.waiting).toBe(0);
    await insert(-1);
    expect((await attention(w.admin)).get("staleAlerts")?.waiting).toBe(1);
  });

  it("forgets an alert that was cancelled, however long ago it was due", async () => {
    await db.query(
      `insert into alerts (level, reason, messages, issued_by, issued_at, next_update_at,
                           cancelled_at)
       values ('warning', 'River rising', '{"th": "ระดับน้ำสูงขึ้น"}'::jsonb, $1, now() - interval '3 days',
               now() - interval '2 days', now())`,
      [w.admin],
    );
    expect((await attention(w.admin)).get("staleAlerts")?.waiting).toBe(0);
  });

  it("hands over counts and times only, never a person or a place", async () => {
    const queues = await attention(w.admin);
    for (const row of queues.values()) {
      expect(Object.keys(row).sort()).toEqual(["newest_at", "newest_id", "queue", "waiting"]);
    }
  });
});
