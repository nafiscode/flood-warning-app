import { describe, expect, it } from "vitest";
import { Impact } from "@/components/admin/Impact";
import { FieldRescueView } from "@/components/authority/FieldRescue";
import { NoticeList } from "@/components/notices/NoticeList";
import { outcomeOf } from "@/lib/field-queue";
import { FIELD_HOLDS } from "@/lib/field-rescue";
import { EXAMPLE_IMPACT } from "@/lib/impact-examples";
import { buildNotices } from "@/lib/notices";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const RESULT = { status: "pending", holds: ["sent_later"], evidence: [], points: 0 };

describe("what the phone does with the server's answer to a kept record", () => {
  it("lets go of a record that arrived", () => {
    expect(outcomeOf(200, { result: RESULT })).toMatchObject({
      kind: "sent",
      result: { status: "pending", holds: ["sent_later"] },
    });
  });

  it("keeps it when there was no answer, the server fell over, or the session ran out", () => {
    expect(outcomeOf(0, null).kind).toBe("later");
    expect(outcomeOf(503, { error: "unavailable" }).kind).toBe("later");
    expect(outcomeOf(401, { error: "sign_in" }).kind).toBe("later");
  });

  it("lets go of one the server refuses for good, with the reason", () => {
    expect(outcomeOf(400, { error: "outside" })).toEqual({ kind: "refused", error: "outside" });
    // An earlier try did arrive: the record is already there.
    expect(outcomeOf(400, { error: "duplicate" })).toEqual({ kind: "refused", error: "duplicate" });
  });
});

describe("the recording screen without a signal", () => {
  const base = {
    located: { accuracy: 20 },
    locating: false,
    onLocate: () => {},
    busy: false,
    error: null,
    result: null,
    rescues: [],
    onSend: () => {},
    onAnother: () => {},
  };

  it("says the record was kept on the phone and will wait for an admin", () => {
    const { container } = renderWithIntl(<FieldRescueView {...base} saved waiting={1} />, "en");
    const saved = container.querySelector('[data-field-result="saved"]')!;
    expect(saved.textContent).toContain(en.fieldRescue.later.saved);
    expect(saved.textContent).toContain("always waits for an admin");
    // One record, one send: the form is gone until they ask for another.
    expect(container.querySelector("[data-field-send]")).toBeNull();
  });

  it("shows how many are still on the phone, with a way to try now", () => {
    let tried = 0;
    const { container } = renderWithIntl(
      <FieldRescueView {...base} waiting={2} onFlush={() => (tried += 1)} />,
      "en",
    );
    const waiting = container.querySelector("[data-field-waiting]")!;
    expect(waiting.getAttribute("data-field-waiting")).toBe("2");
    expect(waiting.textContent).toContain("2 records on this device not sent yet");
    waiting.querySelector("button")!.click();
    expect(tried).toBe(1);
  });

  it("shows nothing about waiting when nothing waits", () => {
    const { container } = renderWithIntl(<FieldRescueView {...base} />, "en");
    expect(container.querySelector("[data-field-waiting]")).toBeNull();
  });
});

describe("the admins' bell", () => {
  const build = (fieldWaiting: { count: number; newestId: string; newestAt: string } | null) =>
    buildNotices({
      rows: [],
      area: null,
      me: null,
      cases: [],
      fieldWaiting,
      now: Date.parse("2026-11-20T06:00:00Z"),
      homeLabel: "home",
      areaLabel: () => "area",
    });

  it("has one item while records wait, new again when a newer one arrives", () => {
    const first = build({ count: 2, newestId: "a", newestAt: "2026-11-20T05:00:00Z" });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ kind: "fieldWaiting", id: "fieldwait:a", count: 2 });
    const next = build({ count: 3, newestId: "b", newestAt: "2026-11-20T05:30:00Z" });
    expect(next[0]!.id).toBe("fieldwait:b");
    expect(build(null)).toEqual([]);
    expect(build({ count: 0, newestId: "a", newestAt: "2026-11-20T05:00:00Z" })).toEqual([]);
  });

  it("stays in the bell however long the oldest has waited", () => {
    const old = build({ count: 1, newestId: "a", newestAt: "2026-10-01T05:00:00Z" });
    expect(old).toHaveLength(1);
  });

  it("says how many, and leads to the review page", () => {
    const items = build({ count: 2, newestId: "a", newestAt: "2026-11-20T05:00:00Z" });
    const { container } = renderWithIntl(
      <ul>
        <NoticeList items={items} read={[]} locale="en" emptyHint="" />
      </ul>,
      "en",
    );
    expect(container.textContent).toContain("2 field rescues are waiting for you to check");
    expect(container.querySelector('a[href="/en/admin/field-rescues"]')).not.toBeNull();
  });
});

describe("the impact page", () => {
  it("shows rescues teams found themselves on a line of their own, never added to the requests", () => {
    const { container } = renderWithIntl(<Impact season={EXAMPLE_IMPACT} locale="en" />, "en");
    const block = container.querySelector("[data-impact-field]")!;
    const field = EXAMPLE_IMPACT.field!;
    expect(block.textContent).toContain(`${field.counted} counted`);
    expect(block.textContent).toContain(en.impact.field.note);
    expect(block.textContent).toContain(`${field.waiting} waiting for an admin`);
    // The headline figures are the requests Jaga carried, and do not grow by these.
    expect(EXAMPLE_IMPACT.totals.confirmedRescues).toBe(268);
    expect(EXAMPLE_IMPACT.outcomes.reduce((sum, o) => sum + o.cases, 0)).toBe(
      EXAMPLE_IMPACT.totals.requestsCarried,
    );
  });

  it("leaves the block out when a season has no such records", () => {
    const { container } = renderWithIntl(
      <Impact season={{ ...EXAMPLE_IMPACT, field: undefined }} locale="en" />,
      "en",
    );
    expect(container.querySelector("[data-impact-field]")).toBeNull();
  });
});

describe("the words", () => {
  const keys = (o: unknown, path = ""): string[] =>
    o && typeof o === "object"
      ? Object.entries(o).flatMap(([k, v]) => keys(v, path ? `${path}.${k}` : k))
      : [path];

  it("exist in all three languages", () => {
    for (const pick of [
      (m: typeof th) => m.fieldRescue.later,
      (m: typeof th) => m.adminTools.field.push,
      (m: typeof th) => m.notices.fieldWaiting,
      (m: typeof th) => m.impact.field,
    ]) {
      expect(keys(pick(ms as typeof th))).toEqual(keys(pick(th)));
      expect(keys(pick(en as unknown as typeof th))).toEqual(keys(pick(th)));
    }
    expect(Object.keys(th.fieldRescue.holds).sort()).toEqual([...FIELD_HOLDS].sort());
  });

  it("name the team and the tambon in the admins' notification, and nothing else", () => {
    for (const m of [th, ms, en]) {
      const body = m.adminTools.field.push.body;
      expect(body.match(/\{[a-z]+\}/g)?.sort()).toEqual(["{place}", "{unit}"]);
    }
  });
});
