import { describe, expect, it } from "vitest";
import { NoticeList } from "@/components/notices/NoticeList";
import { decisionLineMessage, LINE_LABEL_MAX, type DecisionWords } from "@/lib/line";
import { buildNotices, toReportDecision, toUnitEdit } from "@/lib/notices";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

/**
 * An admin's decision on something a person was waiting for (owner, 15 Oct 2026): a team's
 * registration, a team's field-rescue record, a flood report. In LINE as in the bell.
 */
const SITE = "https://jagaapp.org";
const words = (lang: typeof th) => lang.notices as unknown as DecisionWords;

describe("an admin's decision as a LINE message", () => {
  it("tells a team it was verified, by name, with one button onto its console", () => {
    const m = decisionLineMessage(
      { kind: "unit_verified", locale: "th", ref: "u1", data: { unit: "กู้ภัยบานา" } },
      words(th),
      th.line,
      SITE,
    ) as { altText: string; template: { text: string; actions: { label: string; uri: string }[] } };
    expect(m.template.text).toContain("กู้ภัยบานา");
    expect(m.template.text).toContain(th.notices.unit.title);
    expect(m.template.actions).toEqual([
      { type: "uri", label: th.line.open, uri: `${SITE}/authority` },
    ]);
  });

  it("tells a team it was turned down, with the admin's reason, inside LINE's 160", () => {
    const long = "ลงทะเบียนเพื่อทดลองใช้งาน ไม่พบหน่วยงานจริงในพื้นที่ที่เลือก ".repeat(4);
    for (const reason of ["ดูเหมือนเป็นการทดลองใช้", long]) {
      const m = decisionLineMessage(
        { kind: "unit_rejected", locale: "th", ref: "u1", data: { unit: "กู้ภัยบานา", reason } },
        words(th),
        th.line,
        SITE,
      ) as { template: { text: string; actions: { uri: string }[] } };
      expect(m.template.text).toContain("กู้ภัยบานา");
      expect([...m.template.text].length).toBeLessThanOrEqual(160);
      // The whole of it is in Jaga, one button away.
      expect(m.template.actions[0]!.uri).toBe(`${SITE}/requests`);
    }
    // A reason is required in the database, but a message is never left with an empty "Reason:".
    const bare = decisionLineMessage(
      { kind: "unit_rejected", locale: "en", ref: "u1", data: { unit: "Bana rescue" } },
      words(en as unknown as typeof th),
      en.line,
      SITE,
    ) as { template: { text: string } };
    expect(bare.template.text).not.toContain(en.notices.unit.reason.replace("{reason}", ""));
  });

  it("names the tambon of a report in the reader's language, and links in that language", () => {
    const m = decisionLineMessage(
      {
        kind: "report_hidden",
        locale: "en",
        ref: "r1",
        data: { tambon_th: "บานา", tambon_en: "Bana" },
      },
      words(en as unknown as typeof th),
      en.line,
      SITE,
    ) as { template: { text: string; actions: { uri: string }[] } };
    expect(m.template.text).toContain("Bana");
    expect(m.template.text).not.toContain("บานา");
    expect(m.template.actions[0]!.uri).toBe(`${SITE}/en/requests`);
  });

  it("knows every kind, stays inside LINE's limits, and refuses a kind it does not know", () => {
    for (const lang of [th, ms, en] as unknown as (typeof th)[]) {
      expect([...lang.line.open].length).toBeLessThanOrEqual(LINE_LABEL_MAX);
      for (const kind of [
        "unit_verified",
        "unit_rejected",
        "unit_suspended",
        "unit_edited",
        "field_approved",
        "field_rejected",
        "report_approved",
        "report_hidden",
      ]) {
        const m = decisionLineMessage(
          { kind, locale: "ms", ref: "x", data: { unit: "Unit", tambon_en: "Bana" } },
          words(lang),
          lang.line,
          SITE,
        ) as { template: { text: string } } | null;
        expect(m, kind).not.toBeNull();
        expect([...m!.template.text].length).toBeLessThanOrEqual(160);
        expect(m!.template.text).not.toMatch(/\{(name|tambon|reason)\}/);
      }
    }
    expect(
      decisionLineMessage(
        { kind: "other", locale: "th", ref: "x", data: {} },
        words(th),
        th.line,
        SITE,
      ),
    ).toBeNull();
  });
});

describe("a registration turned down, in the bell", () => {
  const NOW = Date.parse("2026-11-20T06:00:00Z");

  it("says it was not approved, gives the admin's reason, and says what to do next", () => {
    const items = buildNotices({
      rows: [],
      area: null,
      me: null,
      cases: [],
      units: [
        {
          id: "u1",
          name: "Bana test team",
          status: "rejected",
          createdAt: "2026-11-19T05:00:00Z",
          verifiedAt: null,
          updatedAt: "2026-11-20T05:00:00Z",
          reviewNote: "This looks like a test registration.",
        },
      ],
      now: NOW,
      homeLabel: "Home",
      areaLabel: () => "",
    });
    expect(items.map((i) => i.kind)).toEqual(["unit"]);

    const { container } = renderWithIntl(
      <ul>
        <NoticeList items={items} read={[]} locale="en" emptyHint="" />
      </ul>,
      "en",
    );
    expect(container.textContent).toContain(en.notices.unit.title);
    expect(container.textContent).toContain("Bana test team");
    expect(container.textContent).toContain("This looks like a test registration.");
    expect(container.textContent).toContain(en.notices.unit.rejectedNote);
    expect(container.querySelector('a[href="/en/requests"]')).not.toBeNull();
  });

  it("a verified team hears no reason and no next step", () => {
    const items = buildNotices({
      rows: [],
      area: null,
      me: null,
      cases: [],
      units: [
        {
          id: "u2",
          name: "Bana rescue",
          status: "verified",
          createdAt: "2026-11-19T05:00:00Z",
          verifiedAt: "2026-11-20T05:00:00Z",
          updatedAt: "2026-11-20T05:00:00Z",
        },
      ],
      now: NOW,
      homeLabel: "Home",
      areaLabel: () => "",
    });
    const { container } = renderWithIntl(
      <ul>
        <NoticeList items={items} read={[]} locale="en" emptyHint="" />
      </ul>,
      "en",
    );
    expect(container.textContent).not.toContain(en.notices.unit.rejectedNote);
  });
});

describe("a report's decision in the bell", () => {
  const NOW = Date.parse("2026-11-20T06:00:00Z");
  const row = {
    report_id: "6d0c2d6e-0000-4000-8000-000000000001",
    status: "hidden",
    decided_at: "2026-11-20T05:00:00Z",
    tambon_th: "บานา",
    tambon_en: "Bana",
  };

  it("is read strictly from the database's row", () => {
    expect(toReportDecision(row)).toEqual({
      reportId: row.report_id,
      status: "hidden",
      decidedAt: "2026-11-20T05:00:00.000Z",
      tambonTh: "บานา",
      tambonEn: "Bana",
    });
    expect(toReportDecision({ ...row, status: "pending" })).toBeNull();
    expect(toReportDecision({ ...row, decided_at: "nope" })).toBeNull();
  });

  it("is a bell item of its own, new again if the decision changes, and says where", () => {
    const decision = toReportDecision(row)!;
    const items = buildNotices({
      rows: [],
      area: null,
      me: null,
      cases: [],
      reports: [decision, { ...decision, status: "approved", decidedAt: "2026-11-19T05:00:00Z" }],
      now: NOW,
      homeLabel: "Home",
      areaLabel: () => "",
    });
    expect(items.map((i) => i.kind)).toEqual(["report", "report"]);
    expect(new Set(items.map((i) => i.id)).size).toBe(2);

    const { container } = renderWithIntl(
      <ul>
        <NoticeList items={items.slice(0, 1)} read={[]} locale="en" emptyHint="" />
      </ul>,
      "en",
    );
    expect(container.textContent).toContain(en.notices.report.title);
    expect(container.textContent).toContain("Bana");
    expect(container.querySelector('a[href="/en/requests"]')).not.toBeNull();
  });
});

/**
 * An admin corrected a team and left "tell the team" ticked (owner, 26 Nov 2026). The team is told
 * WHICH part changed, in LINE and in the bell, and never what it was changed to.
 */
describe("a correction to a team, told to the team", () => {
  const NOW = Date.parse("2026-11-26T06:00:00Z");
  const row = {
    audit_id: 812,
    unit_id: "6d0c2d6e-0000-4000-8000-0000000000aa",
    unit_name: "Bana rescue",
    part: "contact",
    edited_at: "2026-11-26T05:00:00Z",
  };
  const PARTS = [
    ["details", "editedDetails"],
    ["contact", "editedContact"],
    ["scope", "editedScope"],
  ] as const;

  it("is read strictly from the database's row, and the id is the audit row's", () => {
    expect(toUnitEdit(row)).toEqual({
      id: "812",
      unitId: row.unit_id,
      unitName: "Bana rescue",
      part: "contact",
      editedAt: "2026-11-26T05:00:00.000Z",
    });
    expect(toUnitEdit({ ...row, part: "status" })).toBeNull();
    expect(toUnitEdit({ ...row, edited_at: "nope" })).toBeNull();
    expect(toUnitEdit({ ...row, audit_id: undefined })).toBeNull();
    expect(toUnitEdit({ ...row, unit_name: 7 })).toBeNull();
  });

  it("says which part changed in LINE, in every language, inside LINE's 160, and links to Jaga", () => {
    for (const lang of [th, ms, en] as unknown as (typeof th)[]) {
      const said = new Set<string>();
      for (const [part, key] of PARTS) {
        const m = decisionLineMessage(
          { kind: "unit_edited", locale: "th", ref: "u1", data: { unit: "Bana rescue", part } },
          words(lang),
          lang.line,
          SITE,
        ) as { template: { text: string; actions: { uri: string }[] } };
        expect(m.template.text).toContain("Bana rescue");
        expect(m.template.text).toContain(lang.notices.unit[key].replace("{name}", "Bana rescue"));
        expect([...m.template.text].length).toBeLessThanOrEqual(160);
        expect(m.template.actions[0]!.uri).toBe(`${SITE}/requests`);
        said.add(m.template.text);
      }
      // Three parts, three different sentences: the team can tell what was touched.
      expect(said.size).toBe(3);
    }
  });

  it("is a bell item per correction, each its own news, naming the team and no value", () => {
    const edits = PARTS.map(([part], i) => ({
      id: String(900 + i),
      unitId: row.unit_id,
      unitName: "Bana rescue",
      part,
      editedAt: `2026-11-26T0${1 + i}:00:00.000Z`,
    }));
    const items = buildNotices({
      rows: [],
      area: null,
      me: null,
      cases: [],
      unitEdits: [...edits, { ...edits[0]!, id: "old", editedAt: "2026-10-01T00:00:00.000Z" }],
      now: NOW,
      homeLabel: "Home",
      areaLabel: () => "",
    });
    // The one from October is outside the bell's fourteen days.
    expect(items.map((i) => i.kind)).toEqual(["unit", "unit", "unit"]);
    expect(new Set(items.map((i) => i.id)).size).toBe(3);
    expect(items.map((i) => (i.kind === "unit" ? i.event : null)).sort()).toEqual([
      "editedContact",
      "editedDetails",
      "editedScope",
    ]);

    const { container } = renderWithIntl(
      <ul>
        <NoticeList items={items} read={[]} locale="en" emptyHint="" />
      </ul>,
      "en",
    );
    for (const [, key] of PARTS) {
      expect(container.textContent).toContain(
        en.notices.unit[key].replace("{name}", "Bana rescue"),
      );
    }
    // A correction is not a rejection: no reason, no "register again" note.
    expect(container.textContent).not.toContain(en.notices.unit.rejectedNote);
    expect(container.querySelector('a[href="/en/requests"]')).not.toBeNull();
  });
});
