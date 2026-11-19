import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DamReleaseForm, type DamForRelease } from "@/components/admin/DamReleaseForm";
import { MyCases } from "@/components/authority/MyCases";
import { TeamMembers } from "@/components/authority/TeamMembers";
import { ADMIN_ITEMS, itemsOf } from "@/lib/admin-menu";
import { EXAMPLE_AUTHORITY_BOARD } from "@/lib/authority-examples";
import { shouldAlarm, teamKind } from "@/lib/dispatch";
import { unitJourney } from "@/lib/journey";
import {
  exampleCrewWork,
  examplePendingUnit,
  exampleRescueBoard,
  exampleSupplyBoard,
  exampleTeam,
  isPreviewRole,
  PREVIEW_ROLES,
  residentScenario,
} from "@/lib/role-preview";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

// The team page refreshes itself through the app router, which a unit test has not mounted.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("the roles an admin can view the app as", () => {
  it("are the ones the owner chose, each with a page in the admin menu", () => {
    expect([...PREVIEW_ROLES]).toEqual([
      "visitor",
      "resident",
      "rescue",
      "supplies",
      "crew",
      "pending",
      "operator",
    ]);
    expect(itemsOf("preview", false).map((i) => i.href)).toEqual(
      PREVIEW_ROLES.map((r) => `/admin/preview/${r}`),
    );
    // Not only for the super admin: every admin may look.
    expect(ADMIN_ITEMS.filter((i) => i.group === "preview").some((i) => i.only)).toBe(false);
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

describe("the team views added on 24 Oct 2026", () => {
  it("a food and water team's example board is a food-and-water team, so its record says deliveries", () => {
    expect(exampleSupplyBoard().units.every((u) => teamKind(u.capabilities) === "supplies")).toBe(
      true,
    );
    expect(exampleRescueBoard().units.every((u) => teamKind(u.capabilities) === "rescue")).toBe(
      true,
    );
  });

  it("a crew member's example is one case handed to them and one their team still holds", () => {
    const work = exampleCrewWork(Date.parse("2026-10-24T03:00:00Z"));
    expect(work.cases).toHaveLength(1);
    expect(work.open).toHaveLength(1);
    // The exact point is there, because it is theirs to navigate to; a phone number is not.
    expect(JSON.stringify(work)).not.toMatch(/\+?66\d{8,9}|0[689]\d{8}/);
  });

  it("the crew screen in a preview answers itself and sends nothing", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { container } = renderWithIntl(
      <MyCases initial={exampleCrewWork(Date.parse("2026-10-24T03:00:00Z"))} preview />,
      "en",
    );
    expect(container.querySelector("[data-my-case]")).not.toBeNull();
    fireEvent.click(container.querySelector('[data-advance="en_route"]')!);
    expect(container.querySelector('[data-advance="on_site"]')).not.toBeNull();
    fireEvent.click(container.querySelector("[data-take]")!);
    expect(container.querySelectorAll("[data-my-case]")).toHaveLength(2);
    fireEvent.click(container.querySelector("[data-show-phone]")!);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("the team page in a preview makes only a sample code and sends nothing", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const { container } = renderWithIntl(
      <TeamMembers teams={exampleTeam(Date.parse("2026-10-24T03:00:00Z"))} preview />,
      "en",
    );
    expect(container.querySelector("[data-team-waiting]")).not.toBeNull();
    fireEvent.click(container.querySelector('[data-invite="true"]')!);
    expect(container.querySelector("[data-invite-code]")!.textContent).toBe("7F3A9-C21B4");
    fireEvent.click(container.querySelector("[data-member-yes]")!);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
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
  /*
   * A second reservoir, for the one thing a count of dams changes: the chooser. The irrigation
   * office holds four of the six, so the chooser is not only an admin's control.
   */
  const second: DamForRelease = {
    ...dam,
    code: "pattani_weir",
    name: { th: "ฝายปัตตานี", en: "Pattani Weir" },
    noticeId: null,
  };
  const draw = (
    more: { variant?: "admin" | "operator"; operatorSend?: string; dams?: DamForRelease[] } = {},
  ) =>
    renderWithIntl(
      <DamReleaseForm
        dams={more.dams ?? [dam]}
        send={() => {}}
        nowValue="2026-11-20T08:00"
        nextUpdateValue="2026-11-20T14:00"
        variant={more.variant}
        operatorSend={more.operatorSend}
      />,
      "en",
    ).container;

  /*
   * The owner chose on 9 Nov that an operator gets the same four figures and the same three
   * levels an admin has, so that there is one rule to teach. What their screen changes is the
   * last line of the notice, the button, and the dams the chooser offers.
   */
  it("asks an operator for the figures and the level, and keeps the template", () => {
    const c = draw({ variant: "operator", operatorSend: "Send the release notice" });
    expect(c.querySelector("[data-dam-release-form]")!.getAttribute("data-operator")).toBe("true");
    // One dam is named, not offered in a chooser with a single entry; it travels as it is.
    expect((c.querySelector('input[type=hidden][name="dam"]') as HTMLInputElement).value).toBe(
      "bang_lang",
    );
    expect(c.querySelector('select[name="dam"]')).toBeNull();
    expect(c.querySelectorAll('input[type=radio][name="level"]')).toHaveLength(3);
    expect(c.querySelectorAll('[name="nextUpdate"]')).toHaveLength(1);
    expect(c.querySelector("#gatesOpenAt")).not.toBeNull();
    expect(c.querySelector("#releaseCms")).not.toBeNull();
    expect(c.querySelector("#expectedEnd")).not.toBeNull();
    // The notice is the reviewed template, filled in.
    expect(c.querySelector("[data-dam-release-preview]")!.textContent).toContain("Bang Lang Dam");
    expect(c.querySelector('button[type="submit"]')!.textContent).toBe("Send the release notice");
  });

  it("offers the chooser to whoever holds more than one reservoir", () => {
    const one = draw({ dams: [dam] });
    expect(one.querySelector('select[name="dam"]')).toBeNull();
    for (const variant of ["admin", "operator"] as const) {
      const c = draw({ variant, dams: [dam, second] });
      const select = c.querySelector('select[name="dam"]')!;
      expect(select).not.toBeNull();
      expect([...select.querySelectorAll("option")].map((o) => o.getAttribute("value"))).toEqual([
        "bang_lang",
        "pattani_weir",
      ]);
    }
  });

  it("is unchanged for an admin", () => {
    const c = draw();
    expect(c.querySelector("[data-dam-release-form]")!.hasAttribute("data-operator")).toBe(false);
    expect(c.querySelectorAll('input[type=radio][name="level"]').length).toBe(3);
    expect(c.querySelector('button[type="submit"]')!.textContent).toBe(en.admin.damRelease.send);
  });
});
