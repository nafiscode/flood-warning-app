import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DamDialFigure, DamRiverFigure, DamSectionFigure } from "@/components/dam/DamFigures";
import { damForFigure, showsDamFigure, type Dam } from "@/lib/dam";
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
  feed: "hourly" as const,
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
  arrivals: [],
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

describe("the readings written on the cross-section (the owner, 18 Oct)", () => {
  const labels = (dam: Dam) =>
    renderWithIntl(<DamSectionFigure dam={dam} />).container.textContent ?? "";

  it("carries the storage, the share of capacity and the reservoir level", () => {
    const text = labels(withSignal("quiet"));
    // 745 of 1,589.8 million m³, at 99.53 m MSL, which is 47%.
    expect(text).toContain("745");
    expect(text).toContain(th.dam.figure.unit.mcm);
    expect(text).toContain("47%");
    expect(text).toContain(th.dam.figure.tag.ofCapacity);
    expect(text).toContain("99.53");
    expect(text).toContain(th.dam.figure.unit.m);
  });

  it("carries both flows, each named, with the spill only while there is one", () => {
    const quiet = labels(withSignal("quiet"));
    expect(quiet).toContain(th.dam.figure.tag.inflow);
    expect(quiet).toContain(th.dam.figure.tag.outflow);
    expect(quiet).toContain("103");
    expect(quiet).not.toContain(th.dam.figure.tag.spill);
    const releasing = labels(withSignal("releasing"));
    expect(releasing).toContain(th.dam.figure.tag.spill);
    expect(releasing).toContain("648");
    expect(releasing).toContain("788");
  });

  it("reads the storage the report's own panel reads, down to the day it fell back to", () => {
    /*
     * ThaiWater's hourly series for Bang Lang carries its flows hours before its storage, so the
     * figure would have drawn an empty reservoir beside a panel showing 745 million m³. Both now
     * come from storageNow(), and the drawing says which day the figure belongs to by not
     * claiming it is this hour's.
     */
    const hourWithoutStorage = { ...exampleDamSignal("quiet")!, storageMcm: null, levelM: null };
    const dam: Dam = {
      ...DAM,
      signal: hourWithoutStorage,
      days: [
        {
          day: "2026-10-17",
          hours: 24,
          releasedMeanCms: 46,
          spilledMeanCms: 0,
          outflowMeanCms: 46,
          outflowMcm: 4,
          spilledMcm: 0,
          storageEndMcm: 743.5,
          levelEndM: 99.49,
        },
      ],
    };
    const f = damFigure(dam);
    expect(f.storageMcm).toBe(743.5);
    expect(f.levelM).toBe(99.49);
    expect(f.storageDay).toBe("2026-10-17");
    // 743.5 million m³ is written to the nearest million, as everywhere else in the app.
    expect(labels(dam)).toContain("744");
  });

  it("a reservoir that publishes one capacity gets no line to work to", () => {
    // The five RID reservoirs publish the same figure for maximum and for normal high water, so a
    // dashed line across the top would mark nothing. Bang Lang publishes two, and keeps its line.
    const oneCapacity: Dam = { ...DAM, storageNormalMcm: DAM.storageMaxMcm };
    expect(damFigure({ ...oneCapacity, signal: exampleDamSignal("quiet") }).normalMark).toBeNull();
    expect(damFigure(withSignal("quiet")).normalMark).not.toBeNull();
  });

  it("writes no reading it has not been given", () => {
    const none = labels(withSignal("none"));
    expect(none).toContain(th.dam.figure.tag.noStorage);
    expect(none).not.toContain("%");
    expect(none).not.toContain(th.dam.figure.tag.inflow);
  });

  it("says the units the same way the report's panel says them", () => {
    // One figure, two screens: a reader must never meet two spellings of m³/s in one app.
    for (const locale of ["th", "ms", "en"] as const) {
      const m = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));
      expect(m.dam.figure.unit.cms).toBe(m.dam.readout.unit.cms);
      expect(m.dam.figure.unit.mcm).toBe(m.dam.readout.unit.mcm);
      expect(m.dam.figure.unit.m).toBe(m.dam.readout.unit.m);
    }
  });

  it("is still one picture to a screen reader, with the words under it", () => {
    // Everything written on the drawing is inside the box that is a single img, so the labels are
    // never read out one by one; the caption below carries them in a sentence instead.
    const box = renderWithIntl(
      <DamSectionFigure dam={withSignal("quiet")} />,
    ).container.querySelector("[role=img]")!;
    expect(box.getAttribute("aria-label")).toContain("103");
    expect(box.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
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

  /*
   * In the dam's full report the words sit below the drawing already (the chip, the grade line and
   * the figures), so the caption is turned off there - but never the description a screen reader
   * reads, which is the only way that reader has of knowing what moved.
   */
  it("can drop its caption where the screen says the state anyway, and keeps its description", () => {
    const { container } = renderWithIntl(
      <DamSectionFigure dam={withSignal("releasing")} caption={false} />,
    );
    expect(container.querySelector("figcaption")).toBeNull();
    const alt = container.querySelector("[role='img']")?.getAttribute("aria-label") ?? "";
    expect(alt).toContain(th.dam.state.releasing);
    expect(container.querySelector("[data-dam-level]")?.getAttribute("data-dam-level")).toBe(
      "releasing",
    );
  });

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

  it("reaches someone whose own area is on the dam's path", () => {
    expect(showsDamFigure(onRiver, ["950801"])).toBe(true);
    expect(showsDamFigure(onRiver, ["940104"])).toBe(true);
  });

  /*
   * The owner narrowed this on 14 Oct 2026: only a reservoir that can really reach their area or
   * one of their watched places belongs on the home screen. Being in the same province is not
   * being in the water's way, and the five reservoirs added that day would otherwise have put a
   * card about somebody else's valley above the SOS button.
   */
  it("reaches nobody who is merely in the same province", () => {
    expect(showsDamFigure(onRiver, ["950299"])).toBe(false); // Yala, off the path
    expect(showsDamFigure(onRiver, ["940999"])).toBe(false); // Pattani, off the path
    expect(showsDamFigure(onRiver, ["960501"])).toBe(false); // Narathiwat
    expect(showsDamFigure(onRiver, ["900101"])).toBe(false); // Songkhla
    expect(showsDamFigure(onRiver, [])).toBe(false);
  });

  it("one watched place in the water's way is enough", () => {
    // Their home is in Songkhla, a place they watch is on the river.
    expect(showsDamFigure(onRiver, ["900101", "940104"])).toBe(true);
  });

  /*
   * With six reservoirs a home screen still takes one of them: where two can reach the same
   * place, the larger reservoir is the one that can do the most.
   */
  describe("and which one of several", () => {
    const sadao: Dam = {
      ...DAM,
      code: "khlong_sadao",
      storageMaxMcm: 56.7,
      tambons: [
        { code: "901101", via: "main", kmFromDam: 12 },
        { code: "901102", via: "main", kmFromDam: 30 },
      ],
    };
    const la: Dam = {
      ...DAM,
      code: "khlong_la",
      storageMaxMcm: 21.4,
      tambons: [{ code: "901102", via: "main", kmFromDam: 3 }],
    };
    // No channel mapped below it, so it has no tambons and can be nobody's card.
    const unmapped: Dam = { ...DAM, code: "ban_baik", storageMaxMcm: 1.2, tambons: [] };
    const all = [onRiver, sadao, la, unmapped];

    it("gives a place below two reservoirs the larger one", () => {
      expect(damForFigure(all, ["901102"])?.code).toBe("khlong_sadao");
    });

    it("gives a place below one of them that one", () => {
      expect(damForFigure(all, ["901101"])?.code).toBe("khlong_sadao");
      expect(damForFigure(all, ["950801"])?.code).toBe("bang_lang");
    });

    it("gives nothing to a place no reservoir can reach", () => {
      expect(damForFigure(all, ["950299"])).toBeNull();
      expect(damForFigure(all, ["100101"])).toBeNull();
      expect(damForFigure(all, [])).toBeNull();
    });

    it("never gives a reservoir whose channel is not mapped", () => {
      expect(damForFigure([unmapped], ["950299"])).toBeNull();
    });
  });
});
