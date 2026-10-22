import { describe, expect, it } from "vitest";
import { ringForAll } from "@/lib/notice-sounds";
import {
  ADMIN_QUEUES,
  ADMIN_QUEUE_HREF,
  buildNotices,
  toAdminAttention,
  type AdminAttention,
  type NoticeItem,
} from "@/lib/notices";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

/**
 * Everything waiting for an admin, in the bell (A10, the owner on 22 Oct). The admin home has
 * counted three of these on its menu since it was built; the bell knew about two.
 */
const build = (attention: AdminAttention[]): NoticeItem[] =>
  buildNotices({
    rows: [],
    area: null,
    me: null,
    cases: [],
    attention,
    now: Date.parse("2026-10-22T10:00:00Z"),
    homeLabel: "home",
    areaLabel: () => "area",
  });

const waiting = (over: Partial<AdminAttention> = {}): AdminAttention => ({
  queue: "units",
  count: 3,
  newestId: "u1",
  newestAt: "2026-10-22T09:00:00Z",
  ...over,
});

describe("what the database hands over", () => {
  it("keeps a queue that has something in it", () => {
    expect(
      toAdminAttention({ queue: "units", waiting: 2, newest_id: "u1", newest_at: "2026-10-22T09:00:00Z" }),
    ).toEqual({ queue: "units", count: 2, newestId: "u1", newestAt: "2026-10-22T09:00:00.000Z" });
  });

  it("drops an empty queue, and anything it does not know", () => {
    // An empty queue is not a line saying nought: it is no line at all.
    expect(toAdminAttention({ queue: "units", waiting: 0 })).toBeNull();
    expect(toAdminAttention({ queue: "invented", waiting: 4 })).toBeNull();
    expect(toAdminAttention({ queue: "units", waiting: "many" })).toBeNull();
  });

  it("stands a queue with no newest record, as the unconfirmed one gives", () => {
    const row = toAdminAttention({ queue: "unconfirmed", waiting: 1, newest_id: null });
    expect(row?.newestId).toBeNull();
  });
});

describe("the line in the bell", () => {
  it("is one per queue, carrying its count, newest queue first", () => {
    const items = build([
      waiting({ newestAt: "2026-10-22T08:00:00Z" }),
      waiting({ queue: "reports", count: 1, newestId: "r9", newestAt: "2026-10-22T09:30:00Z" }),
    ]);
    expect(items).toHaveLength(2);
    // The bell is sorted newest first, so the queue something joined most recently leads.
    expect(items.map((i) => (i.kind === "adminQueue" ? [i.queue, i.count] : null))).toEqual([
      ["reports", 1],
      ["units", 3],
    ]);
  });

  it("is keyed on the newest record, so a seen queue goes quiet until something newer joins", () => {
    const [first] = build([waiting()]);
    const [later] = build([waiting({ newestId: "u2", count: 4 })]);
    expect(first!.id).toBe("adminq:units:u1");
    expect(later!.id).not.toBe(first!.id);
  });

  it("is not held to the fourteen days the rest of the bell is", () => {
    // A team that registered a month ago is still waiting, and still has to be seen.
    const old = build([waiting({ newestAt: "2026-08-01T00:00:00Z" })]);
    expect(old).toHaveLength(1);
  });

  it("goes when the queue is empty", () => {
    expect(build([waiting({ count: 0 })])).toHaveLength(0);
    expect(build([])).toHaveLength(0);
  });
});

describe("a queue never makes a sound", () => {
  it("stays silent on its own, however many are waiting", () => {
    // The owner's choice of 22 Oct: a backlog has no moment at which it happens, and a sound at
    // 2am for a flood report is how an admin comes to ignore the bell before the season.
    const items = build([waiting(), waiting({ queue: "staleAlerts", newestId: "a1" })]);
    expect(ringForAll(items, [], []).sound).toBeNull();
  });

  it("does not stop anything else ringing", () => {
    const items: NoticeItem[] = [
      ...build([waiting()]),
      {
        kind: "announcement",
        id: "ann:1",
        at: "2026-10-22T09:30:00Z",
        places: [],
        messages: { th: "x" },
      },
    ];
    const rung = ringForAll(items, [], []);
    expect(rung.sound).toBe("announcement");
    // And the queue is not marked as having rung, since it never will.
    expect(rung.ids).toEqual(["ann:1"]);
  });
});

describe("where a tap goes", () => {
  it("every queue has somewhere to clear it (the owner, 22 Oct)", () => {
    for (const queue of ADMIN_QUEUES) {
      expect(ADMIN_QUEUE_HREF[queue]).toMatch(/^\/admin\//);
    }
  });

  it("has a title and a body for every queue in all three languages", () => {
    for (const messages of [th, ms, en]) {
      const copy = messages.notices.queue as Record<string, unknown>;
      expect(copy.act).toBeTruthy();
      for (const queue of ADMIN_QUEUES) {
        const words = copy[queue] as { title?: string; body?: string } | undefined;
        expect(words?.title).toBeTruthy();
        // The body carries the count: a line that cannot say how many is not worth a line.
        expect(words?.body).toContain("{count");
      }
    }
  });
});
