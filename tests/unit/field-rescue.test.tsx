import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FieldRescueView, type FieldRescueViewProps } from "@/components/authority/FieldRescue";
import { NoticeList } from "@/components/notices/NoticeList";
import {
  checkFieldForm,
  cleanPhone,
  FIELD_EVIDENCE,
  FIELD_HOLDS,
  fieldJourney,
  fieldNews,
  toFieldResult,
  toMyFieldRescue,
  vulnerableFlags,
  type MyFieldRescue,
} from "@/lib/field-rescue";
import { buildNotices } from "@/lib/notices";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const AT = "2026-11-20T03:00:00.000Z";
const record = (over: Partial<MyFieldRescue> = {}): MyFieldRescue => ({
  id: "f1",
  createdAt: AT,
  status: "counted",
  tambonTh: "สะเตง",
  tambonEn: "Sateng",
  people: 3,
  holds: [],
  points: 8,
  reviewedAt: null,
  reviewNote: null,
  ...over,
});

describe("what a record must have before it is sent", () => {
  const ok = { located: true, phone: "081-234-5678", people: 2, photos: 1 };

  it("wants all of them: a position, how many people, a phone number, a photo", () => {
    expect(checkFieldForm(ok)).toBeNull();
    expect(checkFieldForm({ ...ok, located: false })).toBe("position");
    expect(checkFieldForm({ ...ok, people: 0 })).toBe("people");
    expect(checkFieldForm({ ...ok, people: 1.5 })).toBe("people");
    expect(checkFieldForm({ ...ok, phone: "" })).toBe("phone");
    expect(checkFieldForm({ ...ok, phone: "12" })).toBe("phone");
    expect(checkFieldForm({ ...ok, photos: 0 })).toBe("photo");
  });

  it("keeps a phone number as digits, and refuses what cannot be one", () => {
    expect(cleanPhone("081-234 5678")).toBe("0812345678");
    expect(cleanPhone("+66 81 234 5678")).toBe("+66812345678");
    expect(cleanPhone("call me")).toBeNull();
    expect(cleanPhone(null)).toBeNull();
  });

  it("sends only the kinds of need the app knows", () => {
    expect(vulnerableFlags(["elderly", "bedridden"])).toEqual({ elderly: true, bedridden: true });
    expect(vulnerableFlags([])).toEqual({});
  });
});

describe("rows and answers from the database", () => {
  it("reads a record, keeping only the holds it knows", () => {
    const r = toMyFieldRescue({
      rescue_id: "f1",
      created_at: AT,
      status: "pending",
      tambon_th: "สะเตง",
      tambon_en: "Sateng",
      people_count: 4,
      holds: ["no_flood_evidence", "made_up"],
      points: 0,
    });
    expect(r).toMatchObject({ status: "pending", people: 4, holds: ["no_flood_evidence"] });
    expect(toMyFieldRescue({ rescue_id: "f1", created_at: AT, status: "odd" })).toBeNull();
  });

  it("reads what recording answered", () => {
    expect(
      toFieldResult({ status: "counted", holds: [], evidence: ["flood_report_near"], points: 9 }),
    ).toEqual({ status: "counted", holds: [], evidence: ["flood_report_near"], points: 9 });
    expect(toFieldResult(null)).toBeNull();
  });
});

describe("the journey of a field rescue", () => {
  const keys = (r: MyFieldRescue) => fieldJourney(r).steps.map((s) => `${s.key}:${s.state}`);

  it("is two steps when it counts at once", () => {
    expect(keys(record())).toEqual(["recorded:done", "counted:done"]);
    expect(fieldJourney(record()).open).toBe(false);
  });

  it("waits on the admin when held, then says how it was decided", () => {
    expect(keys(record({ status: "pending", points: 0 }))).toEqual([
      "recorded:done",
      "review:now",
      "approved:todo",
    ]);
    expect(keys(record({ status: "approved", reviewedAt: AT }))).toEqual([
      "recorded:done",
      "review:done",
      "approved:done",
    ]);
    expect(keys(record({ status: "rejected", reviewedAt: AT }))).toEqual([
      "recorded:done",
      "review:done",
      "rejected:stopped",
    ]);
  });

  it("is bell news only once an admin has decided", () => {
    expect(fieldNews(record())).toBeNull();
    expect(fieldNews(record({ status: "pending" }))).toBeNull();
    expect(fieldNews(record({ status: "approved", reviewedAt: AT }))).toEqual({
      id: "field:f1:approved",
      event: "approved",
      at: AT,
    });
  });

  it("reaches the bell as an item of its own, leading to the team's records", () => {
    const items = buildNotices({
      rows: [],
      area: null,
      me: null,
      cases: [],
      field: [record({ status: "rejected", reviewedAt: AT }), record({ id: "f2" })],
      now: Date.parse(AT) + 3_600_000,
      homeLabel: "home",
      areaLabel: () => "area",
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "field", event: "rejected" });
    const { container } = renderWithIntl(
      <ul>
        <NoticeList items={items} read={[]} locale="en" emptyHint="" />
      </ul>,
      "en",
    );
    expect(container.textContent).toContain(en.notices.field.rejected);
    expect(container.querySelector('a[href="/en/authority/field-rescue"]')).not.toBeNull();
  });
});

function view(over: Partial<FieldRescueViewProps> = {}) {
  const onSend = vi.fn();
  const utils = renderWithIntl(
    <FieldRescueView
      located={{ accuracy: 18 }}
      locating={false}
      onLocate={() => {}}
      busy={false}
      error={null}
      result={null}
      rescues={[]}
      onSend={onSend}
      onAnother={() => {}}
      {...over}
    />,
    "en",
  );
  return { ...utils, onSend };
}

describe("the recording screen", () => {
  it("states the owner's four rules before the form", () => {
    const { container } = view();
    for (const rule of Object.values(en.fieldRescue.rules)) {
      expect(container.textContent).toContain(rule);
    }
    // No way to place the position by hand: there is no map and no coordinate field.
    expect(container.querySelector('input[name="lat"], [data-map-ready]')).toBeNull();
  });

  it("does not send without a phone number or a photo, and says which is missing", () => {
    const { container, onSend } = view();
    fireEvent.click(container.querySelector("[data-field-send]")!);
    expect(onSend).not.toHaveBeenCalled();
    expect(container.querySelector("[data-field-error]")!.getAttribute("data-field-error")).toBe(
      "phone",
    );

    fireEvent.change(container.querySelector("#field-phone")!, {
      target: { value: "0812345678" },
    });
    fireEvent.click(container.querySelector("[data-field-send]")!);
    expect(onSend).not.toHaveBeenCalled();
    expect(container.querySelector("[data-field-error]")!.getAttribute("data-field-error")).toBe(
      "photo",
    );
  });

  it("does not send without the phone's own position", () => {
    const { container, onSend } = view({ located: null });
    fireEvent.change(container.querySelector("#field-phone")!, {
      target: { value: "0812345678" },
    });
    fireEvent.click(container.querySelector("[data-field-send]")!);
    expect(onSend).not.toHaveBeenCalled();
    expect(container.querySelector("[data-field-error]")!.textContent).toBe(
      en.fieldRescue.error.position,
    );
    expect(container.querySelector("[data-field-position]")!.textContent).toContain(
      en.fieldRescue.position.failed,
    );
  });

  it("sends everything once all three proofs are there", () => {
    const { container, onSend } = view();
    fireEvent.change(container.querySelector("#field-people")!, { target: { value: "4" } });
    fireEvent.change(container.querySelector("#field-phone")!, {
      target: { value: "0812345678" },
    });
    const photo = new File(["x"], "a.jpg", { type: "image/jpeg" });
    fireEvent.change(container.querySelector("[data-field-photos]")!, {
      target: { files: [photo] },
    });
    fireEvent.click(container.querySelector("[data-field-send]")!);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]![0]).toMatchObject({ people: 4, phone: "0812345678" });
    expect(onSend.mock.calls[0]![0].photos).toHaveLength(1);
  });

  it("says plainly whether it counted, or why an admin must look first", () => {
    const counted = view({
      result: { status: "counted", holds: [], evidence: ["flood_report_near"], points: 9 },
    });
    expect(counted.container.textContent).toContain("Your team earned 9 points.");
    counted.unmount();

    const held = view({
      result: {
        status: "pending",
        holds: ["no_flood_evidence", "repeat_nearby"],
        evidence: [],
        points: 0,
      },
    });
    expect(held.container.querySelector("[data-field-result]")!.textContent).toContain(
      en.fieldRescue.result.pendingBody,
    );
    expect(held.container.querySelectorAll("[data-hold]")).toHaveLength(2);
    // The form is gone: one record, one send.
    expect(held.container.querySelector("[data-field-send]")).toBeNull();
  });

  it("lists the team's records with where each stands and the admin's reason", () => {
    const { container } = view({
      rescues: [
        record(),
        record({
          id: "f2",
          status: "rejected",
          points: 0,
          reviewedAt: AT,
          reviewNote: "photo shows another place",
        }),
      ],
    });
    const cards = [...container.querySelectorAll("[data-field-record]")];
    expect(cards.map((c) => c.getAttribute("data-field-record"))).toEqual(["counted", "rejected"]);
    expect(cards[0]!.textContent).toContain("8 points");
    expect(cards[1]!.textContent).toContain("photo shows another place");
    expect(cards.every((c) => c.querySelector('[data-journey="field"]'))).toBe(true);
  });
});

describe("the words", () => {
  const keys = (o: unknown, path = ""): string[] =>
    o && typeof o === "object"
      ? Object.entries(o).flatMap(([k, v]) => keys(v, path ? `${path}.${k}` : k))
      : [path];

  it("exist in all three languages, key for key", () => {
    expect(keys(ms.fieldRescue)).toEqual(keys(th.fieldRescue));
    expect(keys(en.fieldRescue)).toEqual(keys(th.fieldRescue));
    expect(keys(ms.adminTools.field)).toEqual(keys(th.adminTools.field));
    expect(keys(en.adminTools.field)).toEqual(keys(th.adminTools.field));
    expect(keys(en.journey.field)).toEqual(keys(th.journey.field));
    expect(keys(ms.notices.field)).toEqual(keys(th.notices.field));
  });

  it("have a line for every reason a record can be held and every kind of evidence", () => {
    expect(Object.keys(th.fieldRescue.holds).sort()).toEqual([...FIELD_HOLDS].sort());
    expect(Object.keys(th.adminTools.field.evidenceKind).sort()).toEqual(
      [...FIELD_EVIDENCE].sort(),
    );
  });
});
