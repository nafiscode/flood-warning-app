import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CaseActions } from "@/components/authority/CaseCard";
import { TeamWarRoom } from "@/components/authority/TeamWarRoom";
import { EXAMPLE_AUTHORITY_BOARD, EXAMPLE_NOW } from "@/lib/authority-examples";
import { caseState } from "@/lib/dispatch";
import type { AuthorityBoard, TeamRecord } from "@/lib/dispatch";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

// The map is MapLibre in a canvas; here it is only a stand-in that says which basemap and case.
vi.mock("next/dynamic", () => ({
  default: () =>
    function BoardMapStandIn(props: { basemap?: string; selected?: string | null }) {
      return (
        <div data-map-stand-in data-basemap={props.basemap} data-selected={props.selected ?? ""} />
      );
    },
}));

function actions(): CaseActions {
  return {
    accept: vi.fn(),
    decline: vi.fn(),
    eta: vi.fn(),
    advance: vi.fn(),
    release: vi.fn(),
    phone: vi.fn(),
    complete: vi.fn(),
    confirm: vi.fn(),
    media: vi.fn(),
    assign: vi.fn(),
    unassign: vi.fn(),
  };
}

const record: TeamRecord[] = [
  {
    unitId: EXAMPLE_AUTHORITY_BOARD.units[0]!.id,
    unitName: "Team",
    points: 36,
    cases: 3,
    members: [
      { userId: "a", name: "Owner", role: "owner", casesTaken: 0, rescuesReported: 0 },
      { userId: "b", name: "Boat one", role: "field", casesTaken: 3, rescuesReported: 2 },
    ],
  },
];

function draw(
  over: { board?: AuthorityBoard; record?: TeamRecord[] | "failed" | null; live?: boolean } = {},
) {
  const act = actions();
  const view = renderWithIntl(
    <TeamWarRoom
      board={over.board ?? EXAMPLE_AUTHORITY_BOARD}
      now={EXAMPLE_NOW}
      alarm="on"
      onArm={vi.fn()}
      busy={null}
      notice={null}
      phones={{}}
      media={{}}
      stale={false}
      onRefresh={vi.fn()}
      actions={act}
      unitActions={{ duty: vi.fn(), sharing: vi.fn() }}
      coverage={null}
      record={over.record === undefined ? record : over.record}
      live={over.live ?? false}
    />,
    "en",
  );
  return { ...view, act };
}

describe("the team's war room", () => {
  it("lists the cases, draws the map, and offers the same four basemaps as the main map", () => {
    const { container } = draw();
    expect(container.querySelectorAll("[data-war-case]").length).toBeGreaterThan(0);
    expect(container.querySelector("[data-map-stand-in]")).not.toBeNull();
    const choices = Array.from(container.querySelectorAll("[data-basemap-choice]")).map((b) =>
      b.getAttribute("data-basemap-choice"),
    );
    expect(choices).toEqual(["streets", "terrain", "satellite", "satelliteTerrain"]);
  });

  it("changes the basemap under the map when one is picked", () => {
    const { container } = draw();
    expect(container.querySelector("[data-map-stand-in]")!.getAttribute("data-basemap")).toBe(
      "streets",
    );
    fireEvent.click(container.querySelector('[data-basemap-choice="satellite"]')!);
    expect(container.querySelector("[data-map-stand-in]")!.getAttribute("data-basemap")).toBe(
      "satellite",
    );
  });

  it("opens the case that is picked in the list, with the map following it", () => {
    const { container } = draw();
    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-war-case]"));
    const target = rows.at(-1)!;
    fireEvent.click(target);
    const id = target.getAttribute("data-war-case")!;
    expect(container.querySelector("[data-map-stand-in]")!.getAttribute("data-selected")).toBe(id);
    expect(container.querySelector("[data-war-panel] [data-case]")).not.toBeNull();
  });

  it("puts the offer that is ringing in front without being asked, so accepting is one tap", () => {
    const { container } = draw();
    const offered = container.querySelector<HTMLElement>('[data-war-state="offered_to_me"]');
    expect(offered).not.toBeNull();
    const id = offered!.getAttribute("data-war-case")!;
    expect(container.querySelector("[data-map-stand-in]")!.getAttribute("data-selected")).toBe(id);
  });

  it("says whether updates are live or checked every few seconds", () => {
    expect(
      draw({ live: true })
        .container.querySelector("[data-war-live]")!
        .getAttribute("data-war-live"),
    ).toBe("live");
    expect(
      draw({ live: false })
        .container.querySelector("[data-war-live]")!
        .getAttribute("data-war-live"),
    ).toBe("poll");
  });

  it("shows no crew list to a team of one, and one to a team with a second person", () => {
    const solo = draw({
      board: { ...EXAMPLE_AUTHORITY_BOARD, crew: EXAMPLE_AUTHORITY_BOARD.crew.slice(0, 1) },
    });
    expect(solo.container.querySelector("[data-war-crew]")).toBeNull();
    solo.unmount();
    const team = draw();
    expect(team.container.querySelector("[data-war-crew]")).not.toBeNull();
    expect(team.container.querySelectorAll("[data-crew-member]").length).toBe(3);
  });

  it("shows the team's points, and each person's part only when there are several", () => {
    const withMembers = draw();
    expect(withMembers.container.querySelector("[data-war-record]")!.textContent).toContain(
      "36 points",
    );
    expect(withMembers.container.querySelectorAll("[data-war-record] tbody tr")).toHaveLength(2);
    withMembers.unmount();
    const solo = draw({ record: [{ ...record[0]!, members: record[0]!.members.slice(0, 1) }] });
    expect(solo.container.querySelector("[data-war-record] table")).toBeNull();
  });

  it("says plainly when the record is loading or could not be read", () => {
    expect(
      draw({ record: null }).container.querySelector("[data-war-record]")!.textContent,
    ).toContain("Loading");
    expect(
      draw({ record: "failed" }).container.querySelector("[data-war-record]")!.textContent,
    ).toContain("couldn't be loaded");
  });

  it("keeps the console's other views one tap away, and shows one in place of the war room", () => {
    const onView = vi.fn();
    const base = {
      board: EXAMPLE_AUTHORITY_BOARD,
      now: EXAMPLE_NOW,
      alarm: "on" as const,
      onArm: vi.fn(),
      busy: null,
      notice: null,
      phones: {},
      media: {},
      stale: false,
      onRefresh: vi.fn(),
      actions: actions(),
      unitActions: { duty: vi.fn(), sharing: vi.fn() },
      coverage: null,
      record,
      live: false,
      onView,
    };
    const war = renderWithIntl(<TeamWarRoom {...base} view="cases" other={null} />, "en");
    const tabs = Array.from(war.container.querySelectorAll("[data-console-view]")).map((b) =>
      b.getAttribute("data-console-view"),
    );
    // The map and the case list are the war room itself, so there is no tab for the map.
    expect(tabs).toEqual(["cases", "reports", "households", "coverage", "points"]);
    fireEvent.click(war.container.querySelector('[data-console-view="points"]')!);
    expect(onView).toHaveBeenCalledWith("points");
    war.unmount();

    const other = renderWithIntl(
      <TeamWarRoom {...base} view="points" other={<p data-points-stand-in>points</p>} />,
      "en",
    );
    expect(other.container.querySelector("[data-points-stand-in]")).not.toBeNull();
    expect(other.container.querySelector("[data-war-queue]")).toBeNull();
    expect(other.container.querySelector("[data-war-record]")).toBeNull();
    // Still the war room's own page: the alarm's state and the notice stay above it.
    expect(other.container.querySelector("[data-team-war-room]")).not.toBeNull();
  });

  it("a team that only brings food and water counts deliveries, not rescues", () => {
    const board = {
      ...EXAMPLE_AUTHORITY_BOARD,
      units: EXAMPLE_AUTHORITY_BOARD.units.map((u) => ({ ...u, capabilities: ["supplies"] })),
    };
    const { container } = draw({ board });
    const foot = container.querySelector("[data-war-record]")!;
    expect(foot.getAttribute("data-war-record")).not.toBeNull();
    expect(container.querySelector("[data-record-kind]")!.getAttribute("data-record-kind")).toBe(
      "supplies",
    );
    expect(foot.textContent).toContain("36 points from 3 confirmed deliveries");
    expect(foot.textContent).toContain("Deliveries reported");
    expect(foot.textContent).toContain("5 points for a confirmed delivery");
    expect(foot.textContent).not.toContain("rescue");
  });

  it("a team that does both says cases, and gives both rules", () => {
    const { container } = draw();
    const foot = container.querySelector("[data-war-record]")!;
    expect(container.querySelector("[data-record-kind]")!.getAttribute("data-record-kind")).toBe(
      "both",
    );
    expect(foot.textContent).toContain("3 confirmed cases");
    expect(foot.textContent).toContain("confirmed delivery of food and water");
  });

  it("a rescue-only team still says rescues", () => {
    const board = {
      ...EXAMPLE_AUTHORITY_BOARD,
      units: EXAMPLE_AUTHORITY_BOARD.units.map((u) => ({ ...u, capabilities: ["rescue"] })),
    };
    const { container } = draw({ board });
    expect(container.querySelector("[data-war-record]")!.textContent).toContain(
      "3 confirmed rescues",
    );
  });

  it("opens an offered request for food and water by itself, with a calm pill and no alarm", () => {
    const offered = EXAMPLE_AUTHORITY_BOARD.cases.filter(
      (c) => c.kind === "supplies" && caseState(c) === "offered_to_me",
    );
    expect(offered.length).toBeGreaterThan(0);
    // Only the request for food and water is on the board: nothing rings.
    const board = { ...EXAMPLE_AUTHORITY_BOARD, cases: offered };
    const { container } = draw({ board });
    expect(container.querySelector("[data-war-supply-offer]")).not.toBeNull();
    expect(container.querySelector('[role="alert"].bg-sos')).toBeNull();
    // Its card is already in front, so accepting is one tap.
    expect(
      container.querySelector(`[data-war-panel] [data-case="${offered[0]!.sosId}"] [data-accept]`),
    ).not.toBeNull();
  });

  it("keeps the case in front after it is accepted", () => {
    const offered = EXAMPLE_AUTHORITY_BOARD.cases.filter((c) => caseState(c) === "offered_to_me");
    const board = { ...EXAMPLE_AUTHORITY_BOARD, cases: offered };
    const { container, act } = draw({ board });
    const accept = container.querySelector<HTMLElement>("[data-war-panel] [data-accept]")!;
    fireEvent.click(accept);
    expect(act.accept).toHaveBeenCalledTimes(1);
    // The board comes back with the case held by this team, and the card is still there.
    const id = (act.accept as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(container.querySelector(`[data-war-panel] [data-case="${id}"]`)).not.toBeNull();
  });

  it("every language has every line of the war room", () => {
    const keys = (o: unknown, p = ""): string[] =>
      Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
        v && typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`],
      );
    const base = keys(th.authority.war).sort();
    expect(keys(en.authority.war).sort()).toEqual(base);
    expect(keys(ms.authority.war).sort()).toEqual(base);
  });
});
