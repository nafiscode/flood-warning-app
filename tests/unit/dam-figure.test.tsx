import { describe, expect, it } from "vitest";
import { DamDialFigure, DamRiverFigure, DamSectionFigure } from "@/components/dam/DamFigures";
import { DAM_FIGURE_PROVINCES, showsDamFigure, type Dam } from "@/lib/dam";
import { cycleFor, damFigure, RECORD_OUTFLOW_CMS, TURBINE_MAX_CMS } from "@/lib/dam-figure";
import { exampleDamSignal } from "@/lib/dev-examples";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

/*
 * The animated figures of the dam's state (the owner, 12 Oct), three of them, for them to choose
 * between. What is tested is the part that could lie: what moves, how fast, and whether a reader
 * who cannot see the motion still gets the state.
 */

const DAM: Dam = {
  code: "bang_lang",
  name: { th: "เขื่อนบางลาง", en: "Bang Lang Dam" },
  river: { th: "แม่น้ำปัตตานี", en: "Pattani River" },
  operator: "EGAT",
  point: null,
  spillwayPoint: null,
  outletPoint: null,
  reservoir: null,
  storageMaxMcm: 1589.8,
  storageNormalMcm: 1454.4,
  geometrySource: "osm",
  geometryNote: {},
  reaches: [],
  tambons: [],
  signal: null,
  daily: null,
  days: [],
};

const withSignal = (scenario: Parameters<typeof exampleDamSignal>[0]): Dam => ({
  ...DAM,
  signal: exampleDamSignal(scenario),
});

describe("what the figure moves with", () => {
  it("the water level is the storage against the dam's own capacity", () => {
    const quiet = damFigure(withSignal("quiet"));
    expect(quiet.fullness).toBeCloseTo(0.469, 3);
    const releasing = damFigure(withSignal("releasing"));
    expect(releasing.fullness).toBeCloseTo(0.946, 3);
    // And the line the operator works to sits where the capacities put it.
    expect(quiet.normalMark).toBeCloseTo(1454.4 / 1589.8, 4);
  });

  it("the speed is the outflow against the largest release in the record", () => {
    expect(damFigure(withSignal("releasing")).flow).toBeCloseTo(788 / RECORD_OUTFLOW_CMS, 3);
    expect(damFigure(withSignal("quiet")).flow).toBeCloseTo(103 / RECORD_OUTFLOW_CMS, 3);
    // The turbines' own limit is marked on the same scale.
    expect(damFigure(withSignal("quiet")).turbineMark).toBeCloseTo(
      TURBINE_MAX_CMS / RECORD_OUTFLOW_CMS,
      6,
    );
  });

  it("a figure beyond the record is held to the end of the scale, never past it", () => {
    // The archive's impossible hour: 1,944 m3/s with nothing over the spillway.
    const odd = damFigure(withSignal("awaiting"));
    expect(odd.flow).toBe(1);
    // The number itself is not clamped: the caption still says what was published.
    expect(odd.outflowCms).toBe(1944);
  });

  it("the drawing runs faster the more water is leaving", () => {
    expect(cycleFor(0)).toBeGreaterThan(cycleFor(0.5));
    expect(cycleFor(0.5)).toBeGreaterThan(cycleFor(1));
    expect(cycleFor(1)).toBeGreaterThan(0.5);
    expect(damFigure(withSignal("releasing")).cycleSeconds).toBeLessThan(
      damFigure(withSignal("quiet")).cycleSeconds,
    );
  });

  /*
   * A dam that has published nothing is not a dam that is behaving. Grey, and still: a lively
   * drawing would say "all is well" with no figures behind it (safety rule 10).
   */
  it("a dam with no figures stands still, in grey", () => {
    const none = damFigure(DAM);
    expect(none.level).toBe("unknown");
    expect(none.still).toBe(true);
    expect(none.flow).toBe(0);
    expect(none.fullness).toBeNull();
  });

  it("knows when water is going over the spillway", () => {
    expect(damFigure(withSignal("releasing")).spilling).toBe(true);
    expect(damFigure(withSignal("quiet")).spilling).toBe(false);
  });
});

describe("every figure says what it shows, without the motion", () => {
  const figures = [
    ["section", DamSectionFigure],
    ["river", DamRiverFigure],
    ["dial", DamDialFigure],
  ] as const;

  for (const [name, Figure] of figures) {
    it(`${name}: carries the state in a word, an icon and a colour`, () => {
      const { container } = renderWithIntl(<Figure dam={withSignal("releasing")} />);
      const figure = container.querySelector(`[data-dam-figure="${name}"]`)!;
      expect(figure.getAttribute("data-dam-level")).toBe("releasing");
      expect(figure.textContent).toContain(th.dam.state.releasing);
      // The word is not the only thing: an icon rides with it, and the numbers sit beneath.
      expect(figure.querySelector("svg")).toBeTruthy();
      expect(figure.textContent).toContain("788");
    });

    it(`${name}: offers the same thing to a screen reader`, () => {
      const { container } = renderWithIntl(<Figure dam={withSignal("watch")} />);
      const img = container.querySelector("[role='img']")!;
      const alt = img.getAttribute("aria-label") ?? "";
      expect(alt).toContain(th.dam.state.watch);
      expect(alt.length).toBeGreaterThan(10);
    });

    it(`${name}: a dam with no figures neither moves nor claims a state`, () => {
      const { container } = renderWithIntl(<Figure dam={DAM} />);
      const figure = container.querySelector(`[data-dam-figure="${name}"]`)!;
      expect(figure.getAttribute("data-dam-level")).toBe("unknown");
      expect(figure.textContent).toContain(th.dam.figures.none);
      // Nothing in it carries an animation class while there is nothing to animate.
      expect(figure.innerHTML).not.toMatch(/flowLine|jet|spill|pulse/);
    });
  }

  it("the stale marker rides along, so an old reading is not drawn as the present", () => {
    const { container } = renderWithIntl(<DamSectionFigure dam={withSignal("stale")} />);
    expect(container.textContent).toContain(th.dam.state.stale);
  });
});

/*
 * Who sees the figure on their home screen (the owner's choice of 12 Oct): the people the quiet
 * notice already reaches, and everyone in Yala, Pattani or Narathiwat. **Songkhla is left out on
 * the evidence**: the 39 tambons the released water runs through are in Yala and Pattani only,
 * and the river ends in Pattani Bay, so neither a release nor a failure of the dam sends water
 * over the divide into the Songkhla Lake or U-Taphao basins.
 */
describe("whose home screen the figure reaches", () => {
  const onRiver: Dam = {
    ...DAM,
    tambons: [
      { code: "950801", via: "main", kmFromDam: 4.6 },
      { code: "940104", via: "main", kmFromDam: 128 },
    ],
  };

  it("reaches someone whose own area is on the river", () => {
    expect(showsDamFigure(onRiver, ["950801"])).toBe(true);
  });

  it("reaches the three provinces the dam's water belongs to, river or no river", () => {
    // A tambon in each, none of them on the dam's own path.
    expect(showsDamFigure(onRiver, ["950299"])).toBe(true); // Yala
    expect(showsDamFigure(onRiver, ["940999"])).toBe(true); // Pattani
    expect(showsDamFigure(onRiver, ["960501"])).toBe(true); // Narathiwat
    expect([...DAM_FIGURE_PROVINCES].sort()).toEqual(["94", "95", "96"]);
  });

  it("does not reach Songkhla, which is the other side of the divide", () => {
    expect(showsDamFigure(onRiver, ["900101"])).toBe(false);
    // Nor anywhere else in the country.
    expect(showsDamFigure(onRiver, ["100101"])).toBe(false);
  });

  it("one place in the region is enough, and no places at all is not", () => {
    expect(showsDamFigure(onRiver, ["900101", "960501"])).toBe(true);
    expect(showsDamFigure(onRiver, [])).toBe(false);
  });
});
