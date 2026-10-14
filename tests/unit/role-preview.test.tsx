import { describe, expect, it } from "vitest";
import { DamReleaseForm, type DamForRelease } from "@/components/admin/DamReleaseForm";
import { ADMIN_ITEMS, itemsOf } from "@/lib/admin-menu";
import { EXAMPLE_AUTHORITY_BOARD } from "@/lib/authority-examples";
import { shouldAlarm } from "@/lib/dispatch";
import { unitJourney } from "@/lib/journey";
import {
  examplePendingUnit,
  exampleSupplyBoard,
  isPreviewRole,
  PREVIEW_ROLES,
  residentScenario,
} from "@/lib/role-preview";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

describe("the roles an admin can view the app as", () => {
  it("are the ones the owner chose, each with a page in the admin menu", () => {
    expect([...PREVIEW_ROLES]).toEqual([
      "visitor",
      "resident",
      "rescue",
      "supplies",
      "pending",
      "operator",
    ]);
    expect(itemsOf("preview", false).map((i) => i.href)).toEqual(
      PREVIEW_ROLES.map((r) => `/admin/preview/${r}`),
    );
    // Not only for the super admin: every admin may look.
    expect(ADMIN_ITEMS.filter((i) => i.group === "preview").some((i) => i.superOnly)).toBe(false);
  });

  it("accept only a known role, and fall back to a resident with watched places", () => {
    expect(isPreviewRole("rescue")).toBe(true);
    expect(isPreviewRole("admin")).toBe(false);
    expect(isPreviewRole(undefined)).toBe(false);
    expect(residentScenario("warning")).toBe("warning");
    expect(residentScenario("nonsense")).toBe("watched");
  });

  it("give a food and water team only supply requests, with one offered to it and no alarm", () => {
    const board = exampleSupplyBoard();
    expect(board.cases.length).toBeGreaterThan(0);
    expect(board.cases.every((c) => c.kind === "supplies")).toBe(true);
    expect(board.cases.some((c) => c.offeredIsMine)).toBe(true);
    // The rescue alarm never rings for supplies (lib/dispatch.ts).
    expect(shouldAlarm(board.cases, Date.parse(board.readAt))).toBe(false);
    expect(board.units[0]!.name).not.toBe(EXAMPLE_AUTHORITY_BOARD.units[0]!.name);
    // The rescue team's own board is untouched.
    expect(EXAMPLE_AUTHORITY_BOARD.cases.some((c) => c.kind === "rescue")).toBe(true);
  });

  it("show a team waiting for verification at the admin's check", () => {
    const journey = unitJourney(examplePendingUnit(Date.parse("2026-10-14T05:00:00Z")));
    expect(journey.steps.map((s) => [s.key, s.state])).toEqual([
      ["sent", "done"],
      ["review", "now"],
      ["verified", "todo"],
    ]);
  });

  it("have their words in all three languages", () => {
    const shape = (o: unknown): string[] =>
      o && typeof o === "object"
        ? Object.entries(o).flatMap(([k, v]) => shape(v).map((s) => (s ? `${k}.${s}` : k)))
        : [""];
    for (const m of [ms, en]) {
      expect(shape(m.rolePreview)).toEqual(shape(th.rolePreview));
      expect(shape(m.admin.nav.preview)).toEqual(shape(th.admin.nav.preview));
    }
    for (const m of [th, ms, en]) {
      for (const r of PREVIEW_ROLES) {
        expect(m.rolePreview.role[r]).toBeTruthy();
        expect(m.rolePreview[r].note).toBeTruthy();
      }
      expect(m.rolePreview.banner).toContain("{role}");
    }
  });
});

describe("the dam operator's screen", () => {
  const dam: DamForRelease = {
    code: "bang_lang",
    name: { th: "เขื่อนบางลาง", en: "Bang Lang Dam" },
    river: { th: "แม่น้ำปัตตานี", en: "Pattani River" },
    operator: "EGAT",
    tambons: 2,
    arrivals: [
      {
        tambon: "950101",
        via: "main",
        kmFromDam: 18,
        warnFromH: 2.5,
        earliestH: 3,
        latestH: 4,
        peakEarliestH: 0,
        peakLatestH: 0,
        source: "",
      },
    ],
    outflowCms: 120,
    noticeId: null,
  };
  const draw = (operatorSend?: string) =>
    renderWithIntl(
      <DamReleaseForm
        dams={[dam]}
        send={() => {}}
        nowValue="2026-11-20T08:00"
        nextUpdateValue="2026-11-20T14:00"
        operatorSend={operatorSend}
      />,
      "en",
    ).container;

  it("asks an operator only for the gates, the release and the end, and keeps the template", () => {
    const c = draw("Send the release notice");
    expect(c.querySelector("[data-dam-release-form]")!.getAttribute("data-operator")).toBe("true");
    // Their own dam, the decided level and the next update travel without a control to change.
    expect((c.querySelector('input[type=hidden][name="dam"]') as HTMLInputElement).value).toBe(
      "bang_lang",
    );
    expect((c.querySelector('input[type=hidden][name="level"]') as HTMLInputElement).value).toBe(
      "warning",
    );
    expect(c.querySelectorAll('[name="level"]')).toHaveLength(1);
    expect(c.querySelectorAll('[name="dam"]')).toHaveLength(1);
    expect(c.querySelectorAll('[name="nextUpdate"]')).toHaveLength(1);
    expect(c.querySelector("#gatesOpenAt")).not.toBeNull();
    expect(c.querySelector("#releaseCms")).not.toBeNull();
    expect(c.querySelector("#expectedEnd")).not.toBeNull();
    // The notice is the reviewed template, filled in.
    expect(c.querySelector("[data-dam-release-preview]")!.textContent).toContain("Bang Lang Dam");
    expect(c.querySelector('button[type="submit"]')!.textContent).toBe("Send the release notice");
  });

  it("is unchanged for an admin", () => {
    const c = draw();
    expect(c.querySelector("[data-dam-release-form]")!.hasAttribute("data-operator")).toBe(false);
    expect(c.querySelectorAll('input[type=radio][name="level"]').length).toBe(3);
    expect(c.querySelector('select[name="dam"]')).not.toBeNull();
    expect(c.querySelector('button[type="submit"]')!.textContent).toBe(en.admin.damRelease.send);
  });
});
