import { describe, expect, it } from "vitest";
import { Impact } from "@/components/admin/Impact";
import {
  barPercent,
  byProvince,
  confirmedShare,
  earnedMilestones,
  honours,
  MILESTONES,
  nextMilestone,
  percent,
  seasonChange,
  sumBy,
  unansweredShare,
  type UnitImpact,
} from "@/lib/impact";
import { EXAMPLE_IMPACT } from "@/lib/impact-examples";
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
});
