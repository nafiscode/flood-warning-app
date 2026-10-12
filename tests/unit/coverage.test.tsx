import { act, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UnconfirmedRescues } from "@/components/admin/UnconfirmedRescues";
import { BoardView } from "@/components/authority/BoardView";
import { CASE_MARKS, MAP_STATE, caseFeatures } from "@/components/authority/marks";
import { CaseMapView, CoverageView, PointsView } from "@/components/authority/Views";
import {
  EXAMPLE_AUTHORITY_BOARD,
  EXAMPLE_COVERAGE,
  EXAMPLE_NOW,
  EXAMPLE_POINTS,
  exampleUnits,
} from "@/lib/authority-examples";
import {
  coverageTotals,
  gapsByProvince,
  isGap,
  livePoints,
  myPoints,
  pointsByProvince,
  type UnconfirmedRescue,
} from "@/lib/coverage";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const refresh = vi.fn();
// Only the router's refresh is replaced; the rest of the module stays real, because next-intl's
// own links import from it.
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh }),
}));

describe("the responsibility map's arithmetic", () => {
  it("calls a tambon a gap when no rescue team covers it, coordinators or not", () => {
    const byCode = (code: string) => EXAMPLE_COVERAGE.find((r) => r.tambon === code)!;
    expect(isGap(byCode("940105"))).toBe(true);
    // A coordinator alone does not pull anyone out of the water.
    expect(isGap(byCode("940103"))).toBe(true);
    expect(isGap(byCode("940102"))).toBe(false);
  });

  it("counts the covered tambons, the gaps and the caller's own", () => {
    expect(coverageTotals(EXAMPLE_COVERAGE)).toEqual({ tambons: 6, covered: 4, gaps: 2, mine: 2 });
  });

  it("lists the gaps province by province, and leaves out a province without any", () => {
    const groups = gapsByProvince([
      ...EXAMPLE_COVERAGE,
      { ...EXAMPLE_COVERAGE[0]!, tambon: "950101", province: "95" },
    ]);
    expect(groups.map((g) => g.province)).toEqual(["94"]);
    expect(groups[0]!.rows.map((r) => r.tambon)).toEqual(["940103", "940105"]);
  });

  it("orders the points inside a province, and adds up the caller's own", () => {
    const groups = pointsByProvince(EXAMPLE_POINTS);
    expect(groups.map((g) => g.province)).toEqual(["94", "95"]);
    expect(groups[0]!.rows.map((r) => r.points)).toEqual([214, 167]);
    expect(myPoints(EXAMPLE_POINTS)).toEqual({ points: 167, cases: 9 });
  });
});

describe("the cases on a map", () => {
  it("gives every case a mark, and the same one for every case no team holds", () => {
    const features = caseFeatures(EXAMPLE_AUTHORITY_BOARD.cases).features;
    expect(features).toHaveLength(EXAMPLE_AUTHORITY_BOARD.cases.length);
    expect(MAP_STATE.offered_to_me).toBe(MAP_STATE.unanswered);
    expect(MAP_STATE.searching).toBe(MAP_STATE.unanswered);
    // Nothing but the id and the state travels to the map: no note, no place name, no phone.
    expect(Object.keys(features[0]!.properties!).sort()).toEqual(["id", "state"]);
  });

  it("says every mark in words, and asks for a tap when no case is chosen", () => {
    renderWithIntl(<CaseMapView map={<div data-fake-map />} picked={null} />);
    for (const m of CASE_MARKS) {
      expect(document.body.textContent).toContain(th.authority.map.case[m.key]);
    }
    expect(document.body.textContent).toContain(th.authority.map.pickCase);
  });
});

describe("the responsibility map as a team reads it", () => {
  const draw = (picked: string | null = null) => {
    const onPick = vi.fn();
    renderWithIntl(
      <CoverageView
        map={<div data-fake-map />}
        coverage={EXAMPLE_COVERAGE}
        picked={picked ? { tambon: picked, units: exampleUnits(picked) } : null}
        onPick={onPick}
      />,
    );
    return onPick;
  };

  it("writes the gaps out as a list, not only as a colour on the map", () => {
    const onPick = draw();
    expect(
      document.querySelector("[data-coverage-totals]")?.getAttribute("data-coverage-totals"),
    ).toBe("2");
    const gaps = [...document.querySelectorAll("[data-gap]")];
    expect(gaps.map((g) => g.getAttribute("data-gap"))).toEqual(["940103", "940105"]);
    expect(gaps[0]!.textContent).toContain(th.authority.coverage.coordinatorOnly);
    expect(gaps[1]!.textContent).not.toContain(th.authority.coverage.coordinatorOnly);
    fireEvent.click(gaps[1]!);
    expect(onPick).toHaveBeenCalledWith("940105");
  });

  it("names the teams in a tambon, marks the caller's own, and shows no phone number", () => {
    draw("940104");
    const picked = document.querySelector('[data-coverage-picked="940104"]')!;
    expect(picked.textContent).toContain("บานา");
    expect(picked.textContent).toContain(th.authority.coverage.yours);
    expect(picked.textContent).toContain(th.warRoom.capability.rescue);
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/0\d{8,9}/);
  });

  it("says so when no verified team covers the tambon that was tapped", () => {
    draw("940105");
    expect(document.body.textContent).toContain(th.authority.coverage.noUnits);
  });

  it("uses no alert colour for a gap: a missing team is not an alert level", () => {
    draw();
    expect(document.body.innerHTML).not.toMatch(/alert-(watch|warning|evacuate|normal)|bg-sos/);
  });
});

describe("another team's contact, for coordination", () => {
  const draw = (contacts: Parameters<typeof CoverageView>[0]["contacts"] = {}) => {
    const onContact = vi.fn();
    renderWithIntl(
      <CoverageView
        map={<div data-fake-map />}
        coverage={EXAMPLE_COVERAGE}
        picked={{ tambon: "940111", units: exampleUnits("940111") }}
        onPick={() => {}}
        contacts={contacts}
        onContact={onContact}
      />,
    );
    return onContact;
  };
  const OTHER = "00000000-0000-4000-8000-0000000000c3";

  it("is asked for by a tap, never for the caller's own team, and no number is shown before", () => {
    const onContact = draw();
    const buttons = [...document.querySelectorAll("[data-unit-contact]")];
    // Puyut in the example: the caller's own team and one coordinator.
    expect(buttons.map((b) => b.getAttribute("data-unit-contact"))).toEqual([OTHER]);
    expect(document.querySelector('a[href^="tel:"]')).toBeNull();
    fireEvent.click(buttons[0]!);
    expect(onContact).toHaveBeenCalledWith(OTHER);
  });

  it("shows the name and the number once asked for, and says the look is logged", () => {
    draw({ [OTHER]: { name: "Aminah", phone: "+66830000009" } });
    const shown = document.querySelector("[data-unit-contact-shown]")!;
    expect(shown.textContent).toContain("Aminah");
    expect(shown.querySelector('a[href="tel:+66830000009"]')).not.toBeNull();
    expect(shown.textContent).toContain(th.authority.act.phoneLogged);
    expect(document.querySelector("[data-unit-contact]")).toBeNull();
  });

  it("says so when the team has no number, or the database refused", () => {
    draw({ [OTHER]: { name: null, phone: null } });
    expect(document.body.textContent).toContain(th.authority.coverage.contactNone);
    document.body.innerHTML = "";
    draw({ [OTHER]: "failed" });
    expect(document.body.textContent).toContain(th.authority.coverage.contactFailed);
  });
});

describe("the points ledger", () => {
  it("counts only the awards nobody has taken back", () => {
    const row = (points: number, revokedAt: string | null) => ({
      id: points,
      createdAt: "2026-11-20T00:00:00Z",
      unitName: "x",
      orgName: "y",
      sosId: null,
      tambonNameTh: null,
      tambonNameEn: null,
      points,
      reason: "rescue confirmed: requester",
      revokedAt,
      revokeReason: revokedAt ? "duplicate" : null,
    });
    expect(livePoints([row(12, null), row(16, "2026-11-21T00:00:00Z"), row(10, null)])).toBe(22);
    expect(livePoints([])).toBe(0);
  });
});

describe("the points", () => {
  it("says what the caller's team has, how points are earned, and lists teams by province", () => {
    renderWithIntl(<PointsView points={EXAMPLE_POINTS} />);
    expect(document.querySelector("[data-points-mine]")?.getAttribute("data-points-mine")).toBe(
      "167",
    );
    expect(document.body.textContent).toContain(th.authority.points.rule);
    expect(document.querySelectorAll("[data-points-row]").length).toBe(3);
    expect(document.body.textContent).toContain(th.authority.coverage.province[95]);
  });

  it("says so when nothing has been confirmed yet, or when the read failed", () => {
    renderWithIntl(<PointsView points={[]} />);
    expect(document.body.textContent).toContain(th.authority.points.none);
    document.body.innerHTML = "";
    renderWithIntl(<PointsView points="failed" />);
    expect(document.body.textContent).toContain(th.authority.points.failed);
  });
});

describe("the console's views", () => {
  it("keeps the alarm and the team's switches on screen whichever view is open", () => {
    const onView = vi.fn();
    renderWithIntl(
      <BoardView
        board={EXAMPLE_AUTHORITY_BOARD}
        now={EXAMPLE_NOW}
        alarm="off"
        onArm={() => {}}
        busy={null}
        notice={null}
        phones={{}}
        media={{}}
        stale={false}
        onRefresh={null}
        actions={{
          accept: vi.fn(),
          decline: vi.fn(),
          eta: vi.fn(),
          advance: vi.fn(),
          release: vi.fn(),
          phone: vi.fn(),
          complete: vi.fn(),
          confirm: vi.fn(),
          media: vi.fn(),
        }}
        unitActions={{ duty: vi.fn(), sharing: vi.fn() }}
        view="points"
        onView={onView}
        other={<PointsView points={EXAMPLE_POINTS} />}
      />,
    );
    expect(document.querySelector("[data-alarm]")).not.toBeNull();
    expect(document.querySelector("[data-duty]")).not.toBeNull();
    // The offer is still said in words above every view: a team looking at points must see it.
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(document.querySelector('[data-view="points"]')).not.toBeNull();
    expect(document.querySelector("[data-case]")).toBeNull();
    fireEvent.click(document.querySelector('[data-console-view="coverage"]')!);
    expect(onView).toHaveBeenCalledWith("coverage");
  });
});

describe("rescues waiting for an admin's confirmation", () => {
  const row = (more: Partial<UnconfirmedRescue> = {}): UnconfirmedRescue => ({
    sosId: "88888888-0000-4000-8000-000000000008",
    tambonNameTh: "ปูยุด",
    tambonNameEn: "Puyut",
    unitName: "อปพร. ตัวอย่าง",
    completedAt: "2026-11-19T20:00:00Z",
    proofCount: 2,
    peopleCount: 3,
    due: true,
    ...more,
  });

  it("draws nothing when nothing is waiting", () => {
    renderWithIntl(<UnconfirmedRescues rows={[]} />);
    expect(document.querySelector("[data-unconfirmed]")).toBeNull();
  });

  it("offers no confirmation while the person still has time", () => {
    renderWithIntl(<UnconfirmedRescues rows={[row({ due: false })]} />);
    expect(document.querySelector("[data-admin-confirm]")).toBeNull();
    expect(document.body.textContent).toContain(th.warRoom.unconfirmed.notDue);
  });

  it("takes a photo and a note, both, and says when it is done", async () => {
    const send = vi.fn().mockResolvedValue("done");
    renderWithIntl(<UnconfirmedRescues rows={[row()]} send={send} />);
    fireEvent.click(document.querySelector("[data-admin-confirm]")!);
    const button = document.querySelector<HTMLButtonElement>("[data-finish-send]")!;
    expect(button.disabled).toBe(true);
    const file = new File(["x"], "seen.jpg", { type: "image/jpeg" });
    fireEvent.change(document.querySelector("[data-finish-photos]")!, {
      target: { files: [file] },
    });
    expect(button.disabled).toBe(true);
    fireEvent.change(document.querySelector("[data-finish-note]")!, {
      target: { value: "โทรยืนยันกับครอบครัวแล้ว" },
    });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(send).toHaveBeenCalledWith(row().sosId, [file], "โทรยืนยันกับครอบครัวแล้ว");
    await waitFor(() => expect(document.body.textContent).toContain(th.warRoom.unconfirmed.done));
    expect(refresh).toHaveBeenCalled();
  });

  it("says plainly when the database refused", async () => {
    const send = vi.fn().mockResolvedValue("refused");
    renderWithIntl(<UnconfirmedRescues rows={[row()]} send={send} />);
    fireEvent.click(document.querySelector("[data-admin-confirm]")!);
    fireEvent.change(document.querySelector("[data-finish-photos]")!, {
      target: { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] },
    });
    fireEvent.change(document.querySelector("[data-finish-note]")!, { target: { value: "x" } });
    await act(async () => {
      fireEvent.click(document.querySelector("[data-finish-send]")!);
    });
    await waitFor(() =>
      expect(document.querySelector('[role="alert"]')?.textContent).toContain(
        th.warRoom.unconfirmed.refused,
      ),
    );
  });
});

describe("the wording of the new views", () => {
  const keys = (o: unknown, prefix = ""): string[] =>
    o && typeof o === "object"
      ? Object.entries(o).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
      : [prefix.slice(0, -1)];

  it("exists in Thai, Malay and English, key for key", () => {
    const groups = [
      (m: typeof th) => m.authority.views,
      (m: typeof th) => m.authority.map,
      (m: typeof th) => m.authority.coverage,
      (m: typeof th) => m.authority.points,
      (m: typeof th) => m.warRoom.unconfirmed,
      (m: typeof th) => m.admin.points,
      (m: typeof th) => m.admin.households,
      (m: typeof th) => m.admin.nav,
    ];
    for (const group of groups) {
      const thai = keys(group(th)).sort();
      expect(keys(group(en as unknown as typeof th)).sort()).toEqual(thai);
      expect(keys(group(ms as unknown as typeof th)).sort()).toEqual(thai);
    }
  });
});
