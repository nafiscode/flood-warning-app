import { describe, expect, it } from "vitest";
import { NoticeList } from "@/components/notices/NoticeList";
import { ringForAll } from "@/lib/notice-sounds";
import { buildNotices, toAutoAlarm, type AutoAlarm, type NoticeRow } from "@/lib/notices";
import en from "@/messages/en.json";
import { renderWithIntl } from "./render";

/**
 * Admins hear what the automatic alarm does, and may choose to hear every alert, everywhere
 * (owner, 15 Oct 2026).
 */
const NOW = Date.parse("2026-11-20T06:00:00Z");
const base = {
  area: null,
  me: null,
  cases: [],
  now: NOW,
  homeLabel: "Home",
  areaLabel: () => "",
};
const row = {
  id: "a1b2c3d4-0000-4000-8000-000000000001",
  status: "pending",
  level: "warning",
  zone: "Pattani River",
  gauge: "X.40A",
  value: 16.2,
  threshold: 16,
  createdAt: "2026-11-20T05:50:00Z",
  deadline: "2026-11-20T06:10:00Z",
  decidedAt: null,
  decidedBy: null,
  note: null,
  alertId: null,
  drill: null,
};

describe("an automatic alarm in the admin's bell", () => {
  it("is read strictly from the database's row", () => {
    expect(toAutoAlarm(row)?.status).toBe("pending");
    expect(toAutoAlarm({ ...row, status: "weird" })).toBeNull();
    expect(toAutoAlarm({ ...row, level: "watch" })).toBeNull();
  });

  it("is news again each time its state changes, and a waiting draft rings like the alert it would be", () => {
    const pending = toAutoAlarm(row)!;
    const published: AutoAlarm = {
      ...pending,
      status: "auto_published",
      decidedAt: "2026-11-20T05:58:00Z",
      drill: true,
    };
    const items = buildNotices({ ...base, rows: [], autoAlarms: [pending, published] });
    expect(items.map((i) => i.id)).toEqual([
      `auto:${row.id}:auto_published`,
      `auto:${row.id}:pending`,
    ]);
    // The waiting draft rings with the Warning sound, even with nothing else new.
    expect(
      ringForAll(
        items.filter((i) => i.id.endsWith("pending")),
        [],
        [],
      ).sound,
    ).toBe("alertWarning");
    // What has already been decided is quiet news.
    expect(ringForAll(items.slice(0, 1), [], []).sound).toBe("notice");

    const { container } = renderWithIntl(
      <ul>
        <NoticeList items={items} read={[]} locale="en" emptyHint="" />
      </ul>,
      "en",
    );
    expect(container.textContent).toContain(en.notices.auto.title);
    expect(container.textContent).toContain("Pattani River");
    expect(container.textContent).toContain(en.notices.auto.drill);
    expect(container.querySelector('a[href="/en/admin/signals"]')).not.toBeNull();
  });
});

describe("every alert, everywhere, for an admin who ticked it", () => {
  const alert: NoticeRow = {
    kind: "alert",
    id: "b1b2c3d4-0000-4000-8000-000000000002",
    hazard: "flood",
    level: "evacuate",
    reason: "",
    messages: { th: "อพยพ", en: "Evacuate" },
    issuedAt: "2026-11-20T05:00:00Z",
    nextUpdateAt: "2026-11-20T08:00:00Z",
    endedAt: null,
    source: null,
    tambons: ["900101", "900102", "900103"],
  };

  it("says where instead of 'your area', and rings as the real alert", () => {
    const items = buildNotices({ ...base, rows: [alert] });
    const item = items[0]!;
    expect(item.kind === "alert" && item.elsewhere).toBe(3);
    expect(ringForAll(items, [], []).sound).toBe("alertEvacuate");
    const { container } = renderWithIntl(
      <ul>
        <NoticeList items={items} read={[]} locale="en" emptyHint="" />
      </ul>,
      "en",
    );
    expect(container.textContent).toContain("Elsewhere: 3 subdistricts");
  });
});
