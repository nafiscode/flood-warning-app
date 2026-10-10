/**
 * The bell: what a person missed (the owner's request, 10 Oct). What matters here is that
 * nothing that concerned them is dropped, that a lifted alert is news of its own and keeps its
 * level, and that every item has an id stable enough for "already read" to mean something.
 */
import { describe, expect, it } from "vitest";
import type { Area } from "@/lib/area";
import type { MyPlaces } from "@/lib/me";
import {
  badgeText,
  buildNotices,
  keepRead,
  myTambons,
  toNoticeRow,
  unreadCount,
  WINDOW_DAYS,
  type NoticeRow,
} from "@/lib/notices";
import type { SosTimeline } from "@/lib/sos";

const NOW = Date.parse("2026-11-20T10:00:00+07:00");
const daysAgo = (days: number) => new Date(NOW - days * 86400_000).toISOString();

const area = (code: string, nameTh: string): Area => ({
  code,
  nameTh,
  nameEn: nameTh,
  districtTh: "เมืองปัตตานี",
  districtEn: "Mueang Pattani",
  provinceTh: "ปัตตานี",
  provinceEn: "Pattani",
  lat: 6.87,
  lon: 101.25,
  from: "list",
});

const me: MyPlaces = {
  signedIn: true,
  home: area("940101", "สะบารัง"),
  places: [
    {
      id: "p1",
      label: "บ้านแม่",
      area: area("940502", "ตะโละไกรทอง"),
      contactName: null,
      contactPhone: null,
    },
    { id: "p2", label: "ร้าน", area: null, contactName: null, contactPhone: null },
  ],
};

const alertRow = (over: Partial<NoticeRow> = {}): NoticeRow => ({
  kind: "alert",
  id: "11111111-1111-4111-8111-111111111111",
  hazard: "flood",
  level: "warning",
  reason: "ฝนสะสม 150 มม.",
  messages: { th: "น้ำอาจท่วมภายใน 24 ชั่วโมง", en: "Flooding is likely within 24 hours" },
  issuedAt: daysAgo(1),
  nextUpdateAt: daysAgo(0),
  endedAt: null,
  source: "ThaiWater",
  tambons: ["940101"],
  ...over,
});

const build = (rows: NoticeRow[], cases: Parameters<typeof buildNotices>[0]["cases"] = []) =>
  buildNotices({
    rows,
    area: area("940101", "สะบารัง"),
    me,
    cases,
    now: NOW,
    homeLabel: "บ้านของฉัน",
    areaLabel: (one) => one.nameTh,
  });

describe("reading one row of the feed", () => {
  it("keeps a whole alert", () => {
    const row = toNoticeRow({
      kind: "alert",
      id: "a",
      hazard_type: "flood",
      level: "evacuate",
      reason: "r",
      messages: { th: "ไปที่ปลอดภัยตอนนี้", bad: 3 },
      issued_at: "2026-11-19T03:00:00Z",
      next_update_at: "2026-11-19T09:00:00Z",
      ended_at: null,
      source: "",
      tambons: ["940101"],
    });
    expect(row).toMatchObject({ kind: "alert", level: "evacuate", source: null });
    // A value that is not text is left out rather than shown as "[object Object]".
    expect(row!.messages).toEqual({ th: "ไปที่ปลอดภัยตอนนี้" });
  });

  it("drops anything it could not show properly (safety rule 3)", () => {
    const base = {
      kind: "alert",
      id: "a",
      level: "warning",
      messages: { th: "x" },
      issued_at: "2026-11-19T03:00:00Z",
      tambons: [],
    };
    expect(toNoticeRow({ ...base, level: "orange" })).toBeNull();
    expect(toNoticeRow({ ...base, messages: { en: "only English" } })).toBeNull();
    expect(toNoticeRow({ ...base, issued_at: "not a time" })).toBeNull();
    // An announcement has no level, and that is not a fault.
    expect(toNoticeRow({ ...base, kind: "announcement", level: null })).not.toBeNull();
  });
});

describe("the places a person cares about", () => {
  it("is their area, their home and every watched place, once each", () => {
    expect(myTambons(area("940101", "สะบารัง"), me)).toEqual(["940101", "940502"]);
    expect(myTambons(null, me)).toEqual(["940101", "940502"]);
    expect(myTambons(area("950101", "สะเตง"), { signedIn: false })).toEqual(["950101"]);
    expect(myTambons(null, null)).toEqual([]);
  });
});

describe("building the list", () => {
  it("names the person's own places, not tambon codes", () => {
    const [item] = build([alertRow({ tambons: ["940101", "940502"] })]);
    expect(item!.places.map((p) => p.label)).toEqual(["บ้านของฉัน", "บ้านแม่"]);
  });

  it("falls back to the chosen area's name for someone without an account", () => {
    const items = buildNotices({
      rows: [alertRow()],
      area: area("940101", "สะบารัง"),
      me: { signedIn: false },
      cases: [],
      now: NOW,
      homeLabel: "บ้านของฉัน",
      areaLabel: (one) => one.nameTh,
    });
    expect(items[0]!.places).toEqual([{ label: "สะบารัง", tambon: "940101" }]);
  });

  it("forgets nothing inside the window and nothing older", () => {
    const items = build([
      alertRow({ id: "old", issuedAt: daysAgo(WINDOW_DAYS + 1) }),
      alertRow({ id: "new", issuedAt: daysAgo(WINDOW_DAYS - 1) }),
    ]);
    expect(items.map((i) => i.id)).toEqual(["alert:new"]);
  });

  it("a lifted alert is news of its own and keeps its level", () => {
    const items = build([alertRow({ issuedAt: daysAgo(3), endedAt: daysAgo(1) })]);
    expect(items.map((i) => i.kind)).toEqual(["alertEnded", "alert"]);
    // Never downgraded, never hidden: the badge stays Warning on both (safety rule 3).
    expect(items.every((i) => "level" in i && i.level === "warning")).toBe(true);
  });

  it("an old alert lifted yesterday shows only as lifted", () => {
    const items = build([alertRow({ issuedAt: daysAgo(WINDOW_DAYS + 6), endedAt: daysAgo(1) })]);
    expect(items.map((i) => i.kind)).toEqual(["alertEnded"]);
  });

  it("an announcement is never an alert: no level, and its own kind", () => {
    const items = build([
      {
        kind: "announcement",
        id: "22222222-2222-4222-8222-222222222222",
        hazard: null,
        level: null,
        reason: "",
        messages: { th: "แผนที่จะปิดปรับปรุงคืนนี้" },
        issuedAt: daysAgo(2),
        nextUpdateAt: null,
        endedAt: null,
        source: null,
        tambons: [],
      },
    ]);
    expect(items[0]).toMatchObject({ kind: "announcement" });
    expect("level" in items[0]!).toBe(false);
  });

  it("shows the steps of their own SOS, and not the ones that are not news", () => {
    const timeline: SosTimeline = {
      status: "en_route",
      createdAt: daysAgo(2),
      closedAt: null,
      hazardType: "flood",
      lat: 6.87,
      lon: 101.25,
      hasPhone: true,
      unitName: "กู้ภัยปัตตานี",
      orgName: null,
      photos: 0,
      hasVoice: false,
      events: [
        { event: "received", at: daysAgo(2), note: null, unit: null },
        { event: "details_added", at: daysAgo(2), note: null, unit: null },
        { event: "accepted", at: daysAgo(1), note: null, unit: "กู้ภัยปัตตานี" },
        { event: "en_route", at: daysAgo(0.5), note: null, unit: "กู้ภัยปัตตานี" },
      ],
    };
    const items = build([], [{ id: "33333333-3333-4333-8333-333333333333", timeline }]);
    expect(items.map((i) => (i.kind === "sos" ? i.event : i.kind))).toEqual([
      "en_route",
      "accepted",
    ]);
    // The time is part of the id: a case handed back and accepted again is news a second time.
    expect(items[1]!.id).toContain("accepted");
    expect(items[1]!.id).toContain(new Date(daysAgo(1)).toISOString());
  });

  it("a case the phone could not read adds nothing and breaks nothing", () => {
    expect(build([], [{ id: "x", timeline: null }])).toEqual([]);
  });

  it("newest first", () => {
    const items = build([
      alertRow({ id: "a", issuedAt: daysAgo(5) }),
      alertRow({ id: "b", issuedAt: daysAgo(2) }),
      alertRow({ id: "c", issuedAt: daysAgo(9) }),
    ]);
    expect(items.map((i) => i.id)).toEqual(["alert:b", "alert:a", "alert:c"]);
  });
});

describe("what has been read", () => {
  const items = build([
    alertRow({ id: "a", issuedAt: daysAgo(1) }),
    alertRow({ id: "b", issuedAt: daysAgo(2) }),
  ]);

  it("counts what is left", () => {
    expect(unreadCount(items, [])).toBe(2);
    expect(unreadCount(items, ["alert:a"])).toBe(1);
    expect(unreadCount(items, ["alert:a", "alert:b"])).toBe(0);
  });

  it("the badge stops at 9+, and says nothing at zero", () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(-1)).toBeNull();
    expect(badgeText(9)).toBe("9");
    expect(badgeText(40)).toBe("9+");
  });

  it("drops ids that have fallen out of the window, so the phone's list stays small", () => {
    expect(keepRead(["alert:a", "alert:gone", "alert:a"], items)).toEqual(["alert:a"]);
  });
});
