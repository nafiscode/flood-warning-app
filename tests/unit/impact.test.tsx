import { describe, expect, it } from "vitest";
import { Impact } from "@/components/admin/Impact";
import {
  areaPath,
  barPercent,
  bubbleSize,
  byProvince,
  chartPoints,
  confirmedShare,
  cumulativeWaits,
  dotGrid,
  earnedMilestones,
  honours,
  linePath,
  MILESTONES,
  nextMilestone,
  percent,
  provinceCentre,
  seasonChange,
  sumBy,
  unansweredShare,
  type UnitImpact,
} from "@/lib/impact";
import { EXAMPLE_IMPACT } from "@/lib/impact-examples";
import { PROVINCE_BOUNDS } from "@/lib/map";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const unit = (over: Partial<UnitImpact> = {}): UnitImpact => ({
  id: "u",
  org: "Org",
  unit: "Unit",
  province: "94",
  capabilities: ["rescue"],
  accepted: 0,
  confirmed: 0,
  peopleReached: 0,
  seasons: 1,
  acceptedThisMonth: 0,
  confirmedThisMonth: 0,
  lastSeasonAccepted: null,
  ...over,
});

describe("impact arithmetic", () => {
  it("never divides by zero", () => {
    expect(percent(3, 0)).toBe(0);
    expect(barPercent(3, 0)).toBe(0);
    expect(confirmedShare({ ...EXAMPLE_IMPACT.totals, requestsCarried: 0 })).toBe(0);
  });

  it("draws a small value as a visible bar, and nothing as nothing", () => {
    expect(barPercent(1, 500)).toBe(2);
    expect(barPercent(0, 500)).toBe(0);
    expect(barPercent(250, 500)).toBe(50);
  });
});

describe("milestones", () => {
  it("counts only what a unit has reached", () => {
    const earned = earnedMilestones(unit({ accepted: 12, confirmed: 1, peopleReached: 40 }));
    expect(earned.map((m) => m.key)).toEqual(["firstAccepted", "firstRescue", "accepted10"]);
  });

  it("aims at the nearest one, measured by how few are missing", () => {
    // 3 short of 25 accepted, 10 short of 50 people, 24 short of 25 rescues.
    const next = nextMilestone(unit({ accepted: 22, confirmed: 1, peopleReached: 40 }));
    expect(next?.milestone.key).toBe("accepted25");
    expect(next?.remaining).toBe(3);
    expect(next?.current).toBe(22);
  });

  it("has nothing left to aim at once every milestone is reached", () => {
    const every = unit({ accepted: 999, confirmed: 999, peopleReached: 999, seasons: 9 });
    expect(earnedMilestones(every)).toHaveLength(MILESTONES.length);
    expect(nextMilestone(every)).toBeNull();
  });

  it("never offers a season as the next step: a team cannot go and earn one", () => {
    // One season short beats three cases short on raw count, and would be a year away.
    const next = nextMilestone(unit({ accepted: 22, seasons: 1, lastSeasonAccepted: 10 }));
    expect(next?.milestone.metric).not.toBe("seasons");
    // Seasons still count as a badge once they are behind the team.
    expect(earnedMilestones(unit({ seasons: 3 })).map((m) => m.key)).toContain("seasons3");
  });

  it("rewards no milestone for being fast", () => {
    // A team far from the water cannot be quick; no milestone may depend on time.
    expect(MILESTONES.every((m) => m.metric !== "accepted" || m.target > 0)).toBe(true);
    expect(MILESTONES.map((m) => m.metric)).not.toContain("minutes");
  });
});

describe("recognition, not ranking", () => {
  it("thanks the teams that confirmed a rescue this month, most first", () => {
    const list = honours([
      unit({ id: "a", org: "A", confirmedThisMonth: 2, acceptedThisMonth: 9 }),
      unit({ id: "b", org: "B", confirmedThisMonth: 5, acceptedThisMonth: 6 }),
      unit({ id: "c", org: "C", confirmedThisMonth: 0, acceptedThisMonth: 4 }),
      unit({ id: "d", org: "D", confirmedThisMonth: 5, acceptedThisMonth: 9 }),
    ]);
    // D before B on the same rescues (more cases accepted); C is not in the list at all.
    expect(list.map((u) => u.id)).toEqual(["d", "b", "a"]);
  });

  it("keeps the honours list short, so there is a top and no bottom", () => {
    const many = Array.from({ length: 9 }, (_, i) =>
      unit({ id: `u${i}`, org: `Org ${i}`, confirmedThisMonth: i + 1 }),
    );
    expect(honours(many)).toHaveLength(3);
  });

  it("groups units by province and orders them by name, never by figures", () => {
    const groups = byProvince([
      unit({ id: "1", org: "Zeta", province: "96", accepted: 90 }),
      unit({ id: "2", org: "Alpha", province: "96", accepted: 1 }),
      unit({ id: "3", org: "Mid", province: "90", accepted: 50 }),
    ]);
    expect(groups.map((g) => g.province)).toEqual(["90", "96"]);
    expect(groups[1]!.units.map((u) => u.org)).toEqual(["Alpha", "Zeta"]);
  });

  it("compares a unit with its own last season, and says nothing in a first season", () => {
    expect(seasonChange(unit({ accepted: 30, lastSeasonAccepted: 20 }))).toEqual({
      delta: 10,
      percent: 50,
    });
    expect(seasonChange(unit({ accepted: 12, lastSeasonAccepted: 20 }))?.delta).toBe(-8);
    expect(seasonChange(unit({ accepted: 12, lastSeasonAccepted: null }))).toBeNull();
  });
});

describe("the example season", () => {
  const { totals, outcomes, waits, weeks, provinces, units } = EXAMPLE_IMPACT;
  const noTeam = outcomes.find((o) => o.outcome === "noTeam")!.cases;

  it("adds up, so the design is judged on numbers that behave like real ones", () => {
    expect(sumBy(outcomes, (o) => o.cases)).toBe(totals.requestsCarried);
    expect(sumBy(weeks, (w) => w.requests)).toBe(totals.requestsCarried);
    expect(sumBy(weeks, (w) => w.confirmed)).toBe(totals.confirmedRescues);
    expect(sumBy(provinces, (p) => p.requests)).toBe(totals.requestsCarried);
    expect(sumBy(provinces, (p) => p.confirmed)).toBe(totals.confirmedRescues);
    // Every request that was accepted by somebody is on exactly one unit's card.
    expect(sumBy(waits, (w) => w.cases)).toBe(totals.requestsCarried - noTeam);
    expect(sumBy(units, (u) => u.accepted)).toBe(totals.requestsCarried - noTeam);
    expect(sumBy(units, (u) => u.confirmed)).toBe(totals.confirmedRescues);
    expect(sumBy(units, (u) => u.peopleReached)).toBe(totals.peopleReached);
    expect(units).toHaveLength(totals.teamsThatAccepted);
  });

  it("names no person and carries no phone number", () => {
    const text = JSON.stringify(EXAMPLE_IMPACT);
    expect(text).not.toMatch(/0\d{8,9}/);
    expect(units.every((u) => !("pocName" in u) && !("phone" in u))).toBe(true);
  });

  it("marks every invented organisation as an example", () => {
    // Invented rescue counts must never read as a claim about a real foundation.
    expect(units.every((u) => u.org.includes("ตัวอย่าง"))).toBe(true);
  });

  it("publishes a failure beside the successes", () => {
    expect(noTeam).toBeGreaterThan(0);
    expect(unansweredShare(outcomes)).toBe(6);
  });
});

describe("the charts' arithmetic", () => {
  it("draws one mark per request, and a request nobody accepted as large as a rescue", () => {
    const grid = dotGrid(EXAMPLE_IMPACT.outcomes);
    expect(grid.unit).toBe(1);
    expect(grid.groups.map((g) => g.dots)).toEqual([268, 71, 48, 25]);
  });

  it("lets one mark stand for several when there are too many, without losing an outcome", () => {
    const grid = dotGrid(
      [
        { outcome: "confirmed", cases: 4000 },
        { outcome: "unconfirmed", cases: 900 },
        { outcome: "cancelled", cases: 0 },
        { outcome: "noTeam", cases: 3 },
      ],
      420,
    );
    expect(grid.unit).toBe(12);
    const dots = Object.fromEntries(grid.groups.map((g) => [g.outcome, g.dots]));
    // Three requests nobody accepted still get their mark; none at all gets none.
    expect(dots.noTeam).toBe(1);
    expect(dots.cancelled).toBe(0);
    expect(dots.confirmed).toBe(333);
  });

  it("accumulates the waiting bands, and always ends at everyone who was accepted", () => {
    const steps = cumulativeWaits(EXAMPLE_IMPACT.waits);
    expect(steps.map((s) => s.share)).toEqual([22, 59, 84, 97, 100]);
    expect(cumulativeWaits([]).map((s) => s.share)).toEqual([0, 0, 0, 0, 0]);
  });

  it("starts every axis at zero and keeps a value inside its box", () => {
    const points = chartPoints([0, 50, 100, 140], 100);
    expect(points.map((p) => p.y)).toEqual([100, 50, 0, 0]);
    expect(points.map((p) => p.x)).toEqual([12.5, 37.5, 62.5, 87.5]);
    // Nothing to scale against: everything sits on the floor, never NaN.
    expect(chartPoints([3], 0)[0]!.y).toBe(100);
    expect(linePath(points)).toBe("M12.5 100 L37.5 50 L62.5 0 L87.5 0");
    expect(areaPath(points).endsWith("L87.5 100 L12.5 100 Z")).toBe(true);
    expect(areaPath([])).toBe("");
  });
});

describe("the map of the four provinces", () => {
  it("sizes a circle by area, with a floor so a small figure is still seen", () => {
    expect(bubbleSize(100, 100)).toBe(92);
    // A quarter of the requests is half the width: a quarter of the ink.
    expect(bubbleSize(25, 100)).toBe(46);
    expect(bubbleSize(50, 100)).toBe(65);
    expect(bubbleSize(1, 1000)).toBe(40);
    expect(bubbleSize(0, 0)).toBe(40);
    // The phone's smaller circles keep the same proportions.
    expect(bubbleSize(100, 100, 60, 27)).toBe(60);
    expect(bubbleSize(25, 100, 60, 27)).toBe(30);
  });

  it("names real tambons in the example, so the map can find them", () => {
    // A code is province (2) + district (2) + tambon (2), and must sit in its own province.
    for (const gap of EXAMPLE_IMPACT.gaps) {
      expect(gap.tambon).toMatch(/^\d{6}$/);
      expect(gap.tambon.slice(0, 2)).toBe(gap.province);
    }
    expect(EXAMPLE_IMPACT.gaps.map((g) => g.tambon)).toEqual(["950204", "960904", "901005"]);
  });

  it("puts each circle inside its own province", () => {
    for (const row of EXAMPLE_IMPACT.provinces) {
      const [lon, lat] = provinceCentre(row.province);
      const [west, south, east, north] = PROVINCE_BOUNDS[row.province]!;
      expect(lon).toBeGreaterThan(west);
      expect(lon).toBeLessThan(east);
      expect(lat).toBeGreaterThan(south);
      expect(lat).toBeLessThan(north);
    }
  });

  it("says in words that a province is the finest grain it shows", () => {
    const { container } = renderWithIntl(<Impact season={EXAMPLE_IMPACT} locale="th" />);
    const figure = container.querySelector("[data-impact-map-figure]")!;
    expect(figure.textContent).toContain(th.impact.map.note);
    expect(figure.textContent).toContain(th.impact.map.legendGap);
  });
});

describe("the dashboard", () => {
  it("says it is made up before anything else", () => {
    const { container } = renderWithIntl(<Impact season={EXAMPLE_IMPACT} locale="th" />);
    expect(container.textContent).toContain(th.impact.example.title);
    // The notice is the first thing in the page, above the heading.
    const first = container.firstElementChild!.firstElementChild!;
    expect(first.textContent).toContain(th.impact.example.title);
  });

  it("never claims Jaga did the rescuing", () => {
    const { container } = renderWithIntl(<Impact season={EXAMPLE_IMPACT} locale="th" />);
    expect(container.textContent).toContain(th.impact.carriedNotSaved);
    expect(container.textContent).toContain(th.impact.limits.outside);
  });

  it("uses no alert colour anywhere: a count is not a status", () => {
    const { container } = renderWithIntl(<Impact season={EXAMPLE_IMPACT} locale="th" />);
    expect(container.innerHTML).not.toMatch(/bg-alert-|text-alert-|bg-sos|text-sos/);
  });

  it("shows every team, and ranks none of them", () => {
    const { container } = renderWithIntl(<Impact season={EXAMPLE_IMPACT} locale="th" />);
    for (const team of EXAMPLE_IMPACT.units) {
      expect(container.textContent).toContain(team.unit);
    }
    expect(container.textContent).toContain(th.impact.teams.note);
  });

  it("invites a first-season team instead of comparing it with others", () => {
    const { container } = renderWithIntl(<Impact season={EXAMPLE_IMPACT} locale="th" />);
    expect(container.textContent).toContain(th.impact.teams.firstSeason);
  });

  it("offers the numbers behind every chart as a table", () => {
    const { container } = renderWithIntl(<Impact season={EXAMPLE_IMPACT} locale="th" />);
    expect(container.querySelectorAll("table").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the gaps where no rescue team covers", () => {
    const { container } = renderWithIntl(<Impact season={EXAMPLE_IMPACT} locale="th" />);
    expect(container.textContent).toContain(EXAMPLE_IMPACT.gaps[0]!.name);
  });

  it("gives a cup only to the month's honours, and never in gold", () => {
    const { container } = renderWithIntl(<Impact season={EXAMPLE_IMPACT} locale="th" />);
    // Three on the honours cards, and the same three beside their names in the list of teams.
    expect(container.querySelectorAll("[data-cup]")).toHaveLength(6);
    expect(container.innerHTML).not.toMatch(/yellow|amber|gold/);
  });

  it("draws every request as one mark, and still says each outcome in words", () => {
    const { container } = renderWithIntl(<Impact season={EXAMPLE_IMPACT} locale="th" />);
    const marks = container.querySelector("[data-outcome-dots]")!;
    expect(marks.children).toHaveLength(EXAMPLE_IMPACT.totals.requestsCarried);
    expect(marks.getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent).toContain(th.impact.outcomes.noTeam);
    expect(container.textContent).toContain(th.impact.outcomes.noTeamNote);
  });

  it("keeps the true headline figures in the page while the counting copy moves", () => {
    const { container } = renderWithIntl(<Impact season={EXAMPLE_IMPACT} locale="en" />, "en");
    const panel = container.querySelector("[data-impact-panel]")!;
    expect(panel.querySelector(".sr-only")!.textContent).toBe("412");
    expect(panel.textContent).toContain("1,147");
  });
});
