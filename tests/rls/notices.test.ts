/**
 * The bell (A7): the feed anyone may read, the announcements only an admin may write, and the
 * per-account list of what has been read. Each test runs in its own transaction and is rolled
 * back.
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

type Notice = {
  kind: string;
  id: string;
  level: string | null;
  ended_at: string | null;
  tambons: string[];
};

const feed = (tambons: string[]) => rows<Notice>(db, "select * from public_notices($1)", [tambons]);

/** An alert for one tambon, issued however many days ago, optionally already cancelled. */
async function alertFor(
  tambon: string,
  opts: { days?: number; level?: string; cancelledDays?: number } = {},
): Promise<string> {
  await asOwner(db);
  const days = opts.days ?? 1;
  const [row] = await rows<{ id: string }>(
    db,
    `insert into alerts (level, reason, messages, issued_by, issued_at, next_update_at, cancelled_at)
     values ($1, 'test', '{"th": "ข้อความทดสอบ"}'::jsonb, $2,
             now() - make_interval(days => $3), now() + interval '6 hours',
             case when $4::int is null then null else now() - make_interval(days => $4::int) end)
     returning id`,
    [opts.level ?? "warning", w.admin, days, opts.cancelledDays ?? null],
  );
  await db.query("insert into alert_tambons (alert_id, tambon) values ($1, $2)", [row!.id, tambon]);
  return row!.id;
}

describe("the feed", () => {
  it("a visitor reads the alerts of the places they ask about, and no others", async () => {
    const mine = await alertFor(w.yala1);
    await alertFor(w.songkhla);
    await as(db, "anon");
    const list = await feed([w.yala1]);
    expect(list.map((n) => n.id)).toEqual([mine]);
    expect(list[0]!.kind).toBe("alert");
    expect(list[0]!.level).toBe("warning");
  });

  it("an alert already lifted is still in the list, with the time it ended", async () => {
    await alertFor(w.yala1, { days: 3, cancelledDays: 1 });
    await as(db, "anon");
    const [notice] = await feed([w.yala1]);
    expect(notice!.ended_at).not.toBeNull();
    // It keeps its level: a lifted warning is never shown as Normal (safety rule 3).
    expect(notice!.level).toBe("warning");
  });

  it("nothing older than fourteen days, unless it ended inside them", async () => {
    await alertFor(w.yala1, { days: 20 });
    await as(db, "anon");
    expect(await feed([w.yala1])).toEqual([]);
    await alertFor(w.yala1, { days: 20, cancelledDays: 2 });
    await as(db, "anon");
    expect((await feed([w.yala1])).length).toBe(1);
  });

  it("junk and a long list of codes are cut, not refused", async () => {
    await alertFor(w.yala1);
    await as(db, "anon");
    expect((await feed(["not-a-code", "", w.yala1])).length).toBe(1);
    const many = Array.from({ length: 300 }, (_, i) => String(900000 + i));
    expect(await feed(many)).toEqual([]);
    expect(await feed([])).toEqual([]);
  });
});

describe("announcements", () => {
  const announce = (tambons: string[] | null = null) =>
    rows<{ admin_announce: string }>(db, "select admin_announce($1::jsonb, $2, null)", [
      JSON.stringify({ th: "แผนที่จะปิดปรับปรุงคืนนี้" }),
      tambons,
    ]);

  it("only an admin writes one", async () => {
    await as(db, { uid: w.requester });
    expect(
      await expectDenied(db, 'select admin_announce(\'{"th": "x"}\'::jsonb, null, null)'),
    ).toBe("42501");
    await expectDenied(
      db,
      `insert into announcements (messages, created_by) values ('{"th":"x"}'::jsonb, $1)`,
      [w.requester],
    );
    await as(db, { uid: w.admin });
    expect((await announce())[0]!.admin_announce).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("one for everyone reaches every area; one for a tambon reaches only that one", async () => {
    await as(db, { uid: w.admin });
    await announce();
    await announce([w.yala2]);
    await as(db, "anon");
    expect((await feed([w.yala1])).map((n) => n.kind)).toEqual(["announcement"]);
    expect((await feed([w.yala2])).length).toBe(2);
    // It is never an alert: no level, so nothing can draw it as one (safety rules 2 and 10).
    expect((await feed([w.yala1]))[0]!.level).toBeNull();
  });

  it("a cancelled one disappears for everyone", async () => {
    await as(db, { uid: w.admin });
    const id = (await announce())[0]!.admin_announce;
    await db.query("select admin_announce_cancel($1)", [id]);
    await as(db, "anon");
    expect(await feed([w.yala1])).toEqual([]);
    await as(db, { uid: w.requester });
    expect(await expectDenied(db, "select admin_announce_cancel($1)", [id])).toBe("42501");
  });

  it("Thai is required", async () => {
    await as(db, { uid: w.admin });
    expect(
      await expectDenied(
        db,
        'select admin_announce(\'{"en": "only English"}\'::jsonb, null, null)',
      ),
    ).toBe("23514");
  });
});

describe("what a person has read", () => {
  const sync = (ids: string[]) =>
    rows<{ notices_sync: string }>(db, "select * from notices_sync($1)", [ids]);

  it("merges the phone's list with the account's, and gives back the whole of it", async () => {
    await as(db, { uid: w.requester });
    expect((await sync(["alert:a"])).map((r) => r.notices_sync)).toEqual(["alert:a"]);
    const second = (await sync(["alert:b"])).map((r) => r.notices_sync).sort();
    expect(second).toEqual(["alert:a", "alert:b"]);
    // Twice is the same as once.
    expect((await sync(["alert:b"])).length).toBe(2);
  });

  it("is only ever their own", async () => {
    await as(db, { uid: w.requester });
    await sync(["alert:a"]);
    await as(db, { uid: w.otherUser });
    expect(await sync([])).toEqual([]);
    expect(await rows(db, "select * from notice_reads")).toEqual([]);
    await expectDenied(db, "insert into notice_reads (user_id, notice_id) values ($1, 'x')", [
      w.requester,
    ]);
  });

  it("a visitor is told nothing and writes nothing", async () => {
    await as(db, "anon");
    expect(await expectDenied(db, "select * from notices_sync(array['alert:a'])")).toBe("42501");
  });

  it("rows older than sixty days are dropped on the way through", async () => {
    await as(db, { uid: w.requester });
    await sync(["alert:old"]);
    await asOwner(db);
    await db.query("update notice_reads set read_at = now() - interval '61 days'");
    await as(db, { uid: w.requester });
    expect((await sync(["alert:new"])).map((r) => r.notices_sync)).toEqual(["alert:new"]);
  });
});
