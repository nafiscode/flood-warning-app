/**
 * The dam on the map (spec section 15, the owner's request of 10 Oct).
 *
 * What is held here, in order of how much it would matter to get wrong:
 *   1. The quiet notice never becomes an alert: no alert colour, and it says so in words.
 *   2. Timing is only ever a measured range, and only where S7 has measured one.
 *   3. Only someone on the river below the dam is told, and nobody else.
 *   4. The map's water colour is not an alert hue and does not change with the dam's state.
 */
import { describe, expect, it } from "vitest";
import { DamBoard } from "@/components/admin/DamBoard";
import { DamCard, DamLegendKeys, DamLegendRow, DamNotice } from "@/components/map/Dam";
import { alert as alertColors } from "@/lib/brand/tokens";
import {
  ageHours,
  attention,
  dailyPart,
  damLevel,
  flow,
  fullness,
  onPath,
  reachesInOrder,
  trend,
  volume,
  type Dam,
  type DamDaily,
  type DamSignal,
} from "@/lib/dam";
import {
  bars,
  hadSpill,
  levelY,
  run,
  scaleFor,
  storageLine,
  WHOLE_DAY_HOURS,
  type DamDay,
} from "@/lib/dam-chart";
import {
  byZoom,
  CASING_EXTRA,
  DAM_WATER,
  DAM_WATER_DARK,
  damMarks,
  damPaint,
  markColor,
  emphasis,
  MAIN_WIDTH,
  RESERVOIR_FILL_OPACITY,
  TRIBUTARY_WIDTH,
} from "@/lib/dam-map";
import {
  DAM_SCENARIOS,
  exampleDamDaily,
  exampleDamDays,
  exampleDamSignal,
  EXAMPLE_NOW,
} from "@/lib/dev-examples";
import { EXAMPLE_DAMS } from "@/lib/war-room-examples";
import { readFileSync } from "node:fs";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

const line = (coords: [number, number][]) => ({ type: "LineString" as const, coordinates: coords });

const DAM: Dam = {
  code: "bang_lang",
  name: { th: "เขื่อนบางลาง", en: "Bang Lang Dam" },
  river: { th: "แม่น้ำปัตตานี", en: "Pattani River" },
  operator: "EGAT",
  feed: "hourly" as const,
  point: { type: "Point", coordinates: [101.2721, 6.1551] },
  spillwayPoint: { type: "Point", coordinates: [101.2764, 6.1501] },
  outletPoint: { type: "Point", coordinates: [101.273, 6.1536] },
  reservoir: {
    type: "MultiPolygon",
    coordinates: [
      [
        [
          [101.2, 6.0],
          [101.3, 6.0],
          [101.3, 6.15],
          [101.2, 6.0],
        ],
      ],
    ],
  },
  storageMaxMcm: 1589.8,
  storageNormalMcm: 1454.4,
  geometrySource: "osm",
  geometryNote: {
    source: "osm",
    limits_en:
      "The river line is OpenStreetMap's. It shows where the water runs, not how far it spreads.",
    mapped_tributaries: 10,
    spillway_channel_mapped: false,
  },
  reaches: [
    {
      kind: "main",
      seq: 0,
      name: {},
      kmFromDam: 0,
      lengthKm: 134.3,
      line: line([
        [101.27, 6.15],
        [101.24, 6.9],
      ]),
    },
    {
      kind: "tributary",
      seq: 1,
      name: {},
      kmFromDam: 14.7,
      lengthKm: 5,
      line: line([
        [101.2, 6.3],
        [101.27, 6.28],
      ]),
    },
    {
      kind: "outlet",
      seq: 0,
      name: {},
      kmFromDam: 0,
      lengthKm: 0.31,
      line: line([
        [101.273, 6.153],
        [101.2738, 6.156],
      ]),
    },
    {
      kind: "tributary",
      seq: 0,
      name: {},
      kmFromDam: 4.6,
      lengthKm: 5,
      line: line([
        [101.2, 6.2],
        [101.27, 6.19],
      ]),
    },
  ],
  tambons: [
    { code: "950801", via: "main", kmFromDam: 4.6 },
    { code: "940104", via: "main", kmFromDam: 128 },
    { code: "950802", via: "tributary", kmFromDam: 14.7 },
  ],
  signal: exampleDamSignal("quiet"),
  daily: exampleDamDaily("quiet"),
  days: exampleDamDays("quiet"),
  arrivals: [],
};

const withSignal = (signal: DamSignal | null): Dam => ({ ...DAM, signal });
const withFigures = (signal: DamSignal | null, daily: DamDaily | null): Dam => ({
  ...DAM,
  signal,
  daily,
});
/** The words of a message before its first placeholder: enough to find it on the screen. */
const words = (message: string) => message.split("{")[0]!.trim();

describe("what the app says of its own accord", () => {
  it("says nothing while the dam is quiet", () => {
    expect(attention(exampleDamSignal("quiet"))).toBe("none");
  });

  it("says nothing when there are no figures at all", () => {
    expect(attention(null)).toBe("none");
  });

  it("is the quiet notice when the reservoir is high", () => {
    expect(attention(exampleDamSignal("watch"))).toBe("watch");
  });

  it("is the firmer notice when a release is confirmed", () => {
    expect(attention(exampleDamSignal("releasing"))).toBe("releasing");
  });

  it("shows a single unconfirmed reading as awaiting, not as a release", () => {
    expect(attention(exampleDamSignal("awaiting"))).toBe("awaiting");
  });
});

describe("the notice is not an alert", () => {
  it("says in words that it is not an alert from Jaga", () => {
    const { getByText } = renderWithIntl(
      <DamNotice
        dam={withSignal(exampleDamSignal("releasing"))}
        via="main"
        tambonName="บานา"
        now={EXAMPLE_NOW}
      />,
    );
    expect(getByText(th.dam.disclaimer.notAnAlert)).toBeTruthy();
  });

  /*
   * Until 12 Oct nothing about the dam could wear an alert colour. The owner then asked for the
   * states to be coloured and chose Jaga's own hues, so the two things that *are* the state - the
   * chip and the drawing - may, and nothing else may. Strip those two and the old rule stands:
   * the notice's own background, borders and body text stay as they were.
   */
  it("carries no alert or SOS colour beyond the state chip and the figure", () => {
    const { container } = renderWithIntl(
      <DamNotice
        dam={withSignal(exampleDamSignal("releasing"))}
        via="main"
        tambonName="บานา"
        now={EXAMPLE_NOW}
      />,
    );
    container.querySelector("[data-dam-level]")!.remove();
    container.querySelector("[data-dam-figure]")?.remove();
    const html = container.innerHTML;
    // Only the alert palette may show a level (docs/brand.md), and this is not a level.
    expect(html).not.toMatch(/bg-alert-|text-alert-|border-alert-|bg-sos/);
    for (const hex of Object.values(alertColors).map((c) => c.toString().toLowerCase())) {
      expect(html.toLowerCase()).not.toContain(hex);
    }
  });

  it("says plainly when no travel time has been measured for the dam", () => {
    for (const state of ["watch", "releasing", "awaiting"] as const) {
      const { getByText, unmount } = renderWithIntl(
        // This fixture has no arrivals: the dam has never been measured.
        <DamNotice
          dam={withSignal(exampleDamSignal(state))}
          via="main"
          tambonName="บานา"
          now={EXAMPLE_NOW}
        />,
      );
      expect(getByText(th.dam.disclaimer.noArrivalTime)).toBeTruthy();
      unmount();
    }
  });

  it("names the hour the figures are for, and how old they are", () => {
    const { container } = renderWithIntl(
      <DamNotice
        dam={withSignal(exampleDamSignal("releasing"))}
        via="main"
        tambonName="บานา"
        now={EXAMPLE_NOW}
      />,
    );
    expect(container.textContent).toContain(th.dam.figures.observed.split(" {")[0]);
    expect(container.textContent).toMatch(/ชั่วโมงที่แล้ว/);
  });

  it("says where the person is, and differently for a tributary", () => {
    const river = renderWithIntl(
      <DamNotice
        dam={withSignal(exampleDamSignal("releasing"))}
        via="main"
        tambonName="บานา"
        now={EXAMPLE_NOW}
      />,
    );
    expect(river.container.textContent).toContain("อยู่ริม");
    river.unmount();
    const trib = renderWithIntl(
      <DamNotice
        dam={withSignal(exampleDamSignal("releasing"))}
        via="tributary"
        tambonName="ลำพะยา"
        now={EXAMPLE_NOW}
      />,
    );
    expect(trib.container.textContent).toContain("ลำน้ำสาขา");
  });

  it("is nothing at all when the dam is quiet", () => {
    const { container } = renderWithIntl(
      <DamNotice
        dam={withSignal(exampleDamSignal("quiet"))}
        via="main"
        tambonName="บานา"
        now={EXAMPLE_NOW}
      />,
    );
    expect(container.querySelector("[data-dam-notice]")).toBeNull();
  });

  it("names the source, so nobody takes the figures for ours", () => {
    const { container } = renderWithIntl(
      <DamNotice
        dam={withSignal(exampleDamSignal("releasing"))}
        via="main"
        tambonName="บานา"
        now={EXAMPLE_NOW}
      />,
    );
    expect(container.textContent).toContain("EGAT");
    expect(container.textContent).toContain("ThaiWater");
  });
});

describe("who is told", () => {
  it("someone on the river below the dam", () => {
    expect(onPath(DAM, ["940104"])?.via).toBe("main");
  });

  it("someone on a tributary's lower reach, and it says so", () => {
    expect(onPath(DAM, ["950802"])?.via).toBe("tributary");
  });

  it("nobody else", () => {
    expect(onPath(DAM, ["900101", "960101"])).toBeNull();
  });

  it("nobody, when they have chosen no area at all", () => {
    expect(onPath(DAM, [])).toBeNull();
  });

  it("the river itself comes before a tributary when both touch them", () => {
    expect(onPath(DAM, ["950802", "950801"])?.via).toBe("main");
  });

  it("the reach nearest the dam when two of their places are on the river", () => {
    expect(onPath(DAM, ["940104", "950801"])?.kmFromDam).toBe(4.6);
  });
});

describe("the figures", () => {
  it("a flow is whole cubic metres a second: the feed is not that precise", () => {
    expect(flow(647.6)).toBe(648);
    expect(flow(null)).toBeNull();
  });

  it("the share full comes from the database, not from arithmetic here", () => {
    expect(fullness(exampleDamSignal("releasing"))).toBe(94.6);
    expect(fullness(null)).toBeNull();
  });

  it("the age is in hours from the hour published", () => {
    const signal = { observedAt: new Date(EXAMPLE_NOW - 3 * 3_600_000).toISOString() };
    expect(ageHours(signal, EXAMPLE_NOW)).toBeCloseTo(3, 5);
  });

  it("a missing rate of rise is unknown, never steady", () => {
    expect(trend(exampleDamSignal("stale"))).toBe("unknown");
    expect(trend(null)).toBe("unknown");
  });

  it("rising, falling and steady are told apart", () => {
    expect(trend(exampleDamSignal("releasing"))).toBe("rising");
    // A quiet dam barely moves, and "steady" is the honest word for that.
    expect(trend(exampleDamSignal("quiet"))).toBe("steady");
    const falling = { ...exampleDamSignal("quiet")!, riseMcmPerH: -3 };
    expect(trend(falling)).toBe("falling");
  });

  it("the card says so plainly when there are no figures", () => {
    const { container } = renderWithIntl(<DamCard dam={withSignal(null)} now={EXAMPLE_NOW} />);
    expect(container.textContent).toContain(th.dam.figures.none);
  });
});

describe("the day behind the newest reading", () => {
  it("a volume is two decimals of a million cubic metres", () => {
    expect(volume(3.9797)).toBe(3.98);
    expect(volume(69.04321)).toBe(69.04);
    expect(volume(null)).toBeNull();
  });

  it("one hour is not an average: it would only repeat the reading already shown", () => {
    const daily = exampleDamDaily("quiet")!;
    expect(dailyPart({ ...daily, outflowHours: 1 }, "outflow")).toBeNull();
    expect(dailyPart({ ...daily, outflowHours: 2 }, "outflow")).not.toBeNull();
    expect(dailyPart(null, "outflow")).toBeNull();
  });

  it("a mean with no figure behind it is not printed", () => {
    const daily = exampleDamDaily("quiet")!;
    expect(dailyPart({ ...daily, inflowMeanCms: null }, "inflow")).toBeNull();
    expect(dailyPart({ ...daily, inflowMcm: null }, "inflow")).toBeNull();
  });

  it("the hours each mean rests on travel with it", () => {
    const part = dailyPart(exampleDamDaily("stale"), "outflow");
    expect(part).toEqual({ hours: 3, cms: 46, mcm: 0.5 });
  });

  /*
   * The case the owner asked for this over: at 17:00 on 11 Oct the dam's newest hour said it was
   * releasing nothing, while the day behind it had passed 3.98 million m3 downstream, a mean of
   * 46 m3/s. Both have to be on the screen, or the card says the opposite of what the day did.
   */
  it("the card shows the day's mean beside an hour that disagrees with it", () => {
    const quiet = exampleDamSignal("quiet")!;
    const { container } = renderWithIntl(
      <DamCard
        dam={withFigures(
          { ...quiet, releasedCms: 0, spilledCms: 0, outflowCms: 0 },
          exampleDamDaily("quiet"),
        )}
        now={EXAMPLE_NOW}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain(words(th.dam.figures.daily.title));
    expect(text).toContain(words(th.dam.figures.daily.outflow));
    expect(text).toContain(words(th.dam.figures.daily.inflow));
    // The day's own numbers, and the hour's nought still beside them.
    expect(text).toContain("46");
    expect(text).toContain("3.98");
    expect(text).toContain("0");
  });

  it("names the spillway's share of the day only when there was one", () => {
    const spilling = renderWithIntl(
      <DamCard
        dam={withFigures(exampleDamSignal("releasing"), exampleDamDaily("releasing"))}
        now={EXAMPLE_NOW}
      />,
    );
    expect(spilling.container.textContent).toContain(words(th.dam.figures.daily.spilled));
    const quiet = renderWithIntl(<DamCard dam={DAM} now={EXAMPLE_NOW} />);
    expect(quiet.container.textContent).not.toContain(words(th.dam.figures.daily.spilled));
  });

  /*
   * The notice is read on the home screen, so it carries the day's release and not the day's
   * inflow: what matters to someone downstream is how much water has been coming down the river.
   */
  it("the notice keeps the day's release and leaves the reservoir's inflow to the card", () => {
    const dam = withFigures(exampleDamSignal("releasing"), exampleDamDaily("releasing"));
    const { container } = renderWithIntl(
      <DamNotice dam={dam} via="main" tambonName="บานา" now={EXAMPLE_NOW} />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain(words(th.dam.figures.daily.outflow));
    expect(text).not.toContain(words(th.dam.figures.daily.inflow));
    const card = renderWithIntl(<DamCard dam={dam} now={EXAMPLE_NOW} />);
    expect(card.container.textContent).toContain(words(th.dam.figures.daily.inflow));
  });

  it("says nothing of a day the feed has not published", () => {
    const { container } = renderWithIntl(
      <DamCard dam={withFigures(exampleDamSignal("quiet"), null)} now={EXAMPLE_NOW} />,
    );
    expect(container.textContent).not.toContain(words(th.dam.figures.daily.title));
  });
});

/*
 * The fortnight charts (the owner, 12 Oct): "people can see if it's continuously increased for
 * few days or a week". What is tested here is that the picture cannot say something the figures
 * do not - a gap is not a nought, a half-published day is not a quiet day, and a wobble is not a
 * trend.
 */
/*
 * The dam's state as a colour (the owner, 12 Oct: normal green, attention yellow, risky red).
 * They chose Jaga's own alert hues over a second traffic light. Because those hues mean "a
 * person issued this level" everywhere else in the app (safety rule 2), what is tested here is
 * everything that keeps the two apart: the words, the icon, the shape, and the fact that a dam
 * with no figures is never green.
 */
describe("the dam's state wears a colour", () => {
  const chipOf = (signal: DamSignal | null) =>
    renderWithIntl(<DamCard dam={withSignal(signal)} now={EXAMPLE_NOW} />).container.querySelector(
      // The drawing above it carries a level of its own (the owner, 13 Oct), so name the chip.
      "[data-dam-chip]",
    )!;

  it("names the level the figures are at", () => {
    expect(damLevel(exampleDamSignal("quiet"))).toBe("normal");
    expect(damLevel(exampleDamSignal("watch"))).toBe("watch");
    expect(damLevel(exampleDamSignal("releasing"))).toBe("releasing");
    // A rule that has fired once and waits for the next reading is attention, not calm.
    expect(damLevel(exampleDamSignal("awaiting"))).toBe("watch");
  });

  it("a dam that has published nothing is grey, never green (safety rule 10)", () => {
    expect(damLevel(null)).toBe("unknown");
    const chip = chipOf(null);
    expect(chip.getAttribute("data-dam-level")).toBe("unknown");
    expect(chip.className).toContain("bg-alert-stale");
    expect(chip.className).not.toContain("bg-alert-normal");
  });

  it("wears the alert hues the owner chose, one per state", () => {
    expect(chipOf(exampleDamSignal("quiet")).className).toContain("bg-alert-normal");
    expect(chipOf(exampleDamSignal("watch")).className).toContain("bg-alert-watch");
    expect(chipOf(exampleDamSignal("releasing")).className).toContain("bg-alert-evacuate");
  });

  it("never carries the colour alone: an icon and a word ride with it", () => {
    const chip = chipOf(exampleDamSignal("releasing"));
    expect(chip.querySelector("svg")).toBeTruthy();
    expect(chip.textContent).toContain(th.dam.state.releasing);
  });

  /*
   * A level a person issued is a square-cornered badge; the dam's own state is a pill. The
   * colours are shared on purpose, so the shape and the words are what tell them apart.
   */
  it("is a pill, not an alert badge, and says it is not an alert from Jaga", () => {
    const { container } = renderWithIntl(
      <DamCard dam={withSignal(exampleDamSignal("releasing"))} now={EXAMPLE_NOW} />,
    );
    const chip = container.querySelector("[data-dam-chip]")!;
    expect(chip.className).toContain("rounded-full");
    expect(chip.getAttribute("data-level")).toBeNull();
    expect(container.textContent).toContain(th.dam.disclaimer.notAnAlert);
  });

  /*
   * A reading from yesterday morning does not say what the dam is doing now. The app's rule for
   * a stale alert is to keep the level and add a grey marker beside it (docs/brand.md), never to
   * downgrade it, and the dam follows the same rule.
   */
  it("a stale reading keeps its state and gains a grey marker, it is not recoloured", () => {
    const { container } = renderWithIntl(
      <DamCard dam={withSignal(exampleDamSignal("stale"))} now={EXAMPLE_NOW} />,
    );
    const chip = container.querySelector("[data-dam-level]")!;
    expect(chip.getAttribute("data-dam-level")).toBe("normal");
    const marker = container.querySelector("[data-dam-stale]")!;
    expect(marker).toBeTruthy();
    expect(marker.className).toContain("bg-alert-stale");
    expect(marker.textContent).toContain(th.dam.state.stale);
    // A fresh reading has no marker at all.
    const fresh = renderWithIntl(
      <DamCard dam={withSignal(exampleDamSignal("quiet"))} now={EXAMPLE_NOW} />,
    );
    expect(fresh.container.querySelector("[data-dam-stale]")).toBeNull();
  });

  it("the quiet notice carries the same chip", () => {
    const { container } = renderWithIntl(
      <DamNotice
        dam={withSignal(exampleDamSignal("releasing"))}
        via="main"
        tambonName="บานา"
        now={EXAMPLE_NOW}
      />,
    );
    expect(container.querySelector("[data-dam-level='releasing']")).toBeTruthy();
  });

  /*
   * On the map only the dam's own three marks take the state's colour. The river runs through 39
   * tambons whose alert colours lie underneath it, and a red line across a green tambon would
   * contradict the level a person issued there.
   */
  it("the marks take the state's colour and the water does not", () => {
    expect(markColor("normal", false)).toBe(alertColors.normal.bg);
    expect(markColor("watch", false)).toBe(alertColors.watch.bg);
    expect(markColor("releasing", false)).toBe(alertColors.evacuate.bg);
    // Unknown keeps the dam's own ink, not an alert hue.
    const hues = Object.values(alertColors).map((c) => c.bg.toLowerCase());
    expect(hues).not.toContain(markColor("unknown", false).toLowerCase());
    expect(hues).not.toContain(markColor("unknown", true).toLowerCase());
    // The water is the water, whatever the dam is doing.
    expect(damPaint(false).water).toBe(DAM_WATER);
    expect(damPaint(true).water).toBe(DAM_WATER_DARK);
  });

  it("the state's colour is the same by day and by night, like every level in this app", () => {
    for (const level of ["normal", "watch", "releasing"] as const) {
      expect(markColor(level, true)).toBe(markColor(level, false));
    }
  });
});

describe("the fortnight behind the dam", () => {
  const day = (over: Partial<DamDay> & { day: string }): DamDay => ({
    hours: 24,
    releasedMeanCms: 46,
    spilledMeanCms: 0,
    outflowMeanCms: 46,
    outflowMcm: 3.97,
    spilledMcm: 0,
    storageEndMcm: 745,
    levelEndM: 99.5,
    ...over,
  });
  const series = (values: number[]) =>
    values.map((v, i) =>
      day({
        day: `2026-10-${String(i + 1).padStart(2, "0")}`,
        releasedMeanCms: v,
        outflowMeanCms: v,
      }),
    );

  it("the scale is a clean number above the tallest day", () => {
    expect(scaleFor(series([46, 52]))).toBe(100);
    expect(scaleFor(series([120, 788]))).toBe(1000);
    expect(scaleFor(series([3, 7]))).toBe(10);
    // A dam doing nothing still gets an axis rather than a division by zero.
    expect(scaleFor([])).toBe(1);
    expect(scaleFor(series([0, 0]))).toBe(1);
  });

  it("the two charts share one scale, so their heights mean the same thing", () => {
    const days = [
      day({ day: "2026-10-01", outflowMeanCms: 800, spilledMeanCms: 400, spilledMcm: 34 }),
    ];
    const scale = scaleFor(days);
    expect(bars(days, "outflow", scale)[0]!.percent).toBe(80);
    expect(bars(days, "spill", scale)[0]!.percent).toBe(40);
  });

  it("a day the feed never published is a gap, not a nought", () => {
    const [gap] = bars([day({ day: "2026-10-01", hours: 0 })], "outflow", 100);
    expect(gap!.value).toBeNull();
    expect(gap!.percent).toBe(0);
  });

  it("a day with water in it is never drawn as nothing", () => {
    const [tiny] = bars([day({ day: "2026-10-01", outflowMeanCms: 0.2 })], "outflow", 1000);
    expect(tiny!.percent).toBe(2);
  });

  /*
   * "The dam released nothing that day" and "the feed published nothing that day" are different
   * facts, and only the first is one. A published nought keeps its mark; a gap has none.
   */
  it("a published day of nothing still gets a mark, a gap does not", () => {
    const rows = bars(
      [
        day({ day: "2026-10-01", outflowMeanCms: 0, hours: 24 }),
        day({ day: "2026-10-02", hours: 0 }),
      ],
      "outflow",
      100,
    );
    expect(rows[0]!.percent).toBe(2);
    expect(rows[0]!.value).toBe(0);
    expect(rows[1]!.percent).toBe(0);
    expect(rows[1]!.value).toBeNull();
  });

  it("a half-published day is marked apart from a whole one", () => {
    const rows = bars(
      [day({ day: "2026-10-01", hours: WHOLE_DAY_HOURS }), day({ day: "2026-10-02", hours: 6 })],
      "outflow",
      100,
    );
    expect(rows.map((r) => r.whole)).toEqual([true, false]);
  });

  it("counts the run of days the release has been rising", () => {
    const rising = run(series([46, 47, 61, 78, 96, 118]));
    expect(rising).toMatchObject({ direction: "rising", days: 4, to: 118 });
    const falling = run(series([200, 180, 120, 90]));
    expect(falling).toMatchObject({ direction: "falling", days: 3 });
  });

  /*
   * The feed publishes a few hours of today and the rest later. Counting that part-day would
   * report a fall every morning and a rise every evening, which is noise dressed as a trend.
   */
  it("the run ignores a day the feed has only half published", () => {
    const days = [
      ...series([46, 61, 78, 96]),
      day({ day: "2026-10-05", outflowMeanCms: 12, hours: 4 }),
    ];
    expect(run(days)).toMatchObject({ direction: "rising", days: 3, to: 96 });
  });

  it("a wobble of a per cent is steady, not a trend", () => {
    expect(run(series([46.0, 46.1]))).toMatchObject({ direction: "steady" });
    expect(run(series([46]))).toBeNull();
    expect(run([])).toBeNull();
  });

  it("knows whether anything went over the spillway at all", () => {
    expect(hadSpill(series([46, 47]))).toBe(false);
    expect(hadSpill([day({ day: "2026-10-01", spilledMcm: 34 })])).toBe(true);
  });

  it("every example fortnight adds up: the volumes match the means and the hours", () => {
    for (const scenario of DAM_SCENARIOS) {
      for (const d of exampleDamDays(scenario)) {
        if (d.hours === 0) {
          expect(d.outflowMcm).toBeNull();
          continue;
        }
        const seconds = d.hours * 3600;
        expect(d.outflowMcm!).toBeCloseTo((d.outflowMeanCms! * seconds) / 1_000_000, 3);
        expect(d.spilledMcm!).toBeCloseTo((d.spilledMeanCms! * seconds) / 1_000_000, 3);
      }
    }
  });

  /*
   * Found in a browser, not by reasoning: the card printed an ICU error where it should have said
   * why the dam is worth watching, because the message names the window it measured over and
   * nobody passed it.
   */
  it("every reason the card prints has the figures its wording needs", () => {
    const watchful = exampleDamSignal("watch")!;
    const { container } = renderWithIntl(
      <DamCard dam={{ ...DAM, signal: watchful }} now={EXAMPLE_NOW} />,
    );
    expect(container.textContent).not.toMatch(/\{hours\}|\{cms\}|\{mcm\}|\{days\}/);
    expect(container.textContent).toContain(String(watchful.riseWindowH));
  });

  it("the card draws the charts and lists every day underneath", () => {
    const dam = { ...DAM, days: exampleDamDays("releasing") };
    const { container } = renderWithIntl(<DamCard dam={dam} now={EXAMPLE_NOW} />);
    expect(container.querySelector("[data-dam-chart='outflow']")).toBeTruthy();
    // There was a spill in that fortnight, so it gets its own chart on the same scale.
    expect(container.querySelector("[data-dam-chart='spill']")).toBeTruthy();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(dam.days.length);
    expect(container.textContent).toContain(words(th.dam.history.numbers));
  });

  it("says in a sentence that the release has been rising, for someone who does not read pictures", () => {
    const { container } = renderWithIntl(
      <DamCard dam={{ ...DAM, days: exampleDamDays("watch") }} now={EXAMPLE_NOW} />,
    );
    expect(container.textContent).toContain(words(th.dam.history.trend.rising));
  });

  it("a fortnight with no spill says so in words instead of drawing noughts", () => {
    const { container } = renderWithIntl(
      <DamCard dam={{ ...DAM, days: exampleDamDays("quiet") }} now={EXAMPLE_NOW} />,
    );
    expect(container.querySelector("[data-dam-chart='spill']")).toBeNull();
    expect(container.textContent).toContain(words(th.dam.history.noSpill));
  });

  it("draws nothing at all when there is no record to draw", () => {
    const { container } = renderWithIntl(<DamCard dam={{ ...DAM, days: [] }} now={EXAMPLE_NOW} />);
    expect(container.querySelector("[data-dam-history]")).toBeNull();
  });

  /*
   * docs/brand.md: only the alert palette shows a level. A chart of how much water is leaving a
   * dam is not a level, so no alert colour may appear in it - and the two series are told apart
   * by their titles and the table, never by two steps of one teal.
   */
  it("wears no alert colour, and tells the two charts apart in words", () => {
    const { container } = renderWithIntl(
      <DamCard dam={{ ...DAM, days: exampleDamDays("releasing") }} now={EXAMPLE_NOW} />,
    );
    const history = container.querySelector("[data-dam-history]")!;
    expect(history.innerHTML).not.toMatch(/bg-alert-|text-alert-|border-alert-|bg-sos|border-sos/);
    const hues = new Set(
      [...history.querySelectorAll("[data-dam-chart] span[style]")].map(
        (el) => [...el.classList].find((c) => c.startsWith("bg-")) ?? "",
      ),
    );
    hues.delete("");
    expect([...hues]).toEqual(["bg-jaga-dam"]);
    expect(history.textContent).toContain(words(th.dam.history.outflowTitle));
    expect(history.textContent).toContain(words(th.dam.history.spillTitle));
  });
});

/*
 * The reservoir behind the releases (the owner, 12 Oct). The trap this guards against is an axis
 * zoomed onto the days drawn: storage moves by a fraction of a per cent on an ordinary day, and
 * such an axis would turn rounding into a mountain range.
 */
describe("the reservoir's own fortnight", () => {
  const CAPACITY = 1589.8;
  const NORMAL = 1454.4;
  const day = (over: Partial<DamDay> & { day: string }): DamDay => ({
    hours: 24,
    releasedMeanCms: 46,
    spilledMeanCms: 0,
    outflowMeanCms: 46,
    outflowMcm: 3.97,
    spilledMcm: 0,
    storageEndMcm: 745,
    levelEndM: 99.5,
    ...over,
  });

  it("the axis is the dam's capacity, not the range of the days drawn", () => {
    // The real fortnight of 12 Oct 2026: 743.9 to 748.3 million m3, which is half full and flat.
    const flat = [743.9, 745, 746.1, 748.3].map((storage, i) =>
      day({ day: `2026-10-0${i + 1}`, storageEndMcm: storage }),
    );
    const [line] = storageLine(flat, CAPACITY);
    const heights = line!.map((p) => p.y);
    // Every point sits near the middle of the box, and the whole fortnight moves under a third
    // of one per cent of it. On an axis fitted to the data it would have spanned the box.
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.3);
    for (const h of heights) expect(h).toBeGreaterThan(50);
    expect(line![0]!.percent).toBeCloseTo(46.8, 1);
  });

  it("a full reservoir reaches the top of the box and an empty one the bottom", () => {
    const [line] = storageLine(
      [
        day({ day: "2026-10-01", storageEndMcm: 0 }),
        day({ day: "2026-10-02", storageEndMcm: CAPACITY }),
      ],
      CAPACITY,
    );
    expect(line!.map((p) => p.y)).toEqual([100, 0]);
    expect(line!.map((p) => p.x)).toEqual([0, 100]);
  });

  /*
   * A line drawn across a gap is invented data: it would show the reservoir passing through
   * levels nobody published.
   */
  it("a gap in the feed breaks the line instead of being drawn through", () => {
    const runs = storageLine(
      [
        day({ day: "2026-10-01" }),
        day({ day: "2026-10-02" }),
        day({ day: "2026-10-03", hours: 0, storageEndMcm: null }),
        day({ day: "2026-10-04" }),
        day({ day: "2026-10-05" }),
      ],
      CAPACITY,
    );
    expect(runs).toHaveLength(2);
    expect(runs.map((r) => r.length)).toEqual([2, 2]);
  });

  it("the normal high water line is drawn only when it is on the chart", () => {
    expect(levelY(NORMAL, CAPACITY)).toBeCloseTo(8.5, 1);
    expect(levelY(CAPACITY, CAPACITY)).toBeNull();
    expect(levelY(null, CAPACITY)).toBeNull();
    expect(levelY(NORMAL, 0)).toBeNull();
  });

  it("the card draws the reservoir under the releases, and lists it in the table", () => {
    const dam = { ...DAM, days: exampleDamDays("watch") };
    const { container } = renderWithIntl(<DamCard dam={dam} now={EXAMPLE_NOW} />);
    const storage = container.querySelector("[data-dam-chart='storage']")!;
    expect(storage).toBeTruthy();
    expect(storage.textContent).toContain(words(th.dam.history.storageTitle));
    // The capacity at normal high water is what an operator works to, so it is marked and named.
    expect(storage.textContent).toContain(words(th.dam.history.normalLine));
    expect(container.textContent).toContain(words(th.dam.history.columns.storage));
    // One hue here too: no alert colour, and nothing but the river's own blue.
    expect(storage.innerHTML).not.toMatch(/bg-alert-|text-alert-|border-alert-|bg-sos|border-sos/);
    expect(storage.innerHTML).toMatch(/stroke-jaga-dam|fill-jaga-dam/);
  });

  it("draws no reservoir line when the dam's capacity is unknown", () => {
    const { container } = renderWithIntl(
      <DamCard
        dam={{ ...DAM, storageMaxMcm: null, days: exampleDamDays("watch") }}
        now={EXAMPLE_NOW}
      />,
    );
    expect(container.querySelector("[data-dam-chart='storage']")).toBeNull();
    // The release charts are unaffected: one missing figure does not take the rest down.
    expect(container.querySelector("[data-dam-chart='outflow']")).toBeTruthy();
  });
});

describe("the card carries the limits of the lines", () => {
  it("says the line is the river's course, not the edge of a flood", () => {
    const { getByText } = renderWithIntl(<DamCard dam={DAM} now={EXAMPLE_NOW} />);
    expect(getByText(th.dam.path.limits)).toBeTruthy();
  });

  it("says the spillway's own channel is not mapped", () => {
    const { getByText } = renderWithIntl(<DamCard dam={DAM} now={EXAMPLE_NOW} />);
    expect(getByText(th.dam.path.spillwayNotMapped)).toBeTruthy();
  });

  it("credits OpenStreetMap", () => {
    const { container } = renderWithIntl(<DamCard dam={DAM} now={EXAMPLE_NOW} />);
    expect(container.textContent).toContain("OpenStreetMap");
  });

  it("names every rule that fired, in words", () => {
    const { container } = renderWithIntl(
      <DamCard dam={withSignal(exampleDamSignal("releasing"))} now={EXAMPLE_NOW} />,
    );
    expect(container.textContent).toContain(th.dam.reason.spilling);
    expect(container.textContent).toContain(th.dam.reason.above_turbines);
  });

  it("explains an unconfirmed reading instead of hiding it", () => {
    const { container } = renderWithIntl(
      <DamCard dam={withSignal(exampleDamSignal("awaiting"))} now={EXAMPLE_NOW} />,
    );
    expect(container.textContent).toContain("รอข้อมูลชั่วโมงถัดไป");
    // The figure itself is still on screen: 1,944 m3/s, the archive's impossible hour.
    expect(container.textContent).toContain("1,944");
  });

  it("counts the tambons on the river and on the tributaries separately", () => {
    const { container } = renderWithIntl(<DamCard dam={DAM} now={EXAMPLE_NOW} />);
    expect(container.textContent).toContain("2");
    expect(container.textContent).toContain("1");
  });
});

describe("how it is drawn", () => {
  it("the water colour is not an alert hue", () => {
    const hues = Object.values(alertColors).map((c) => c.toString().toLowerCase());
    for (const colour of [DAM_WATER, DAM_WATER_DARK]) {
      expect(hues).not.toContain(colour.toLowerCase());
    }
  });

  it("the water colour does not change with what the dam is doing", () => {
    // The state is said in words with an icon. A river that turned amber would be a sixth
    // alert colour, and one nobody has been taught (docs/brand.md).
    expect(damPaint(false).water).toBe(DAM_WATER);
    expect(damPaint(true).water).toBe(DAM_WATER_DARK);
  });

  it("day and night differ in every value", () => {
    const day = damPaint(false);
    const night = damPaint(true);
    for (const key of Object.keys(day) as (keyof typeof day)[]) {
      expect(day[key]).not.toBe(night[key]);
    }
  });

  it("globals.css holds the same two colours as the map does", () => {
    // MapLibre cannot read a CSS variable, so the value exists twice. This is the only thing
    // keeping the legend swatch and the river the same colour.
    const css = readFileSync("app/globals.css", "utf8").toLowerCase();
    const light = css.slice(0, css.indexOf(':root[data-theme="dark"]'));
    const dark = css.slice(css.indexOf(':root[data-theme="dark"]'));
    expect(light).toContain(`--jaga-dam: ${DAM_WATER.toLowerCase()};`);
    expect(dark).toContain(`--jaga-dam: ${DAM_WATER_DARK.toLowerCase()};`);
  });

  it("a release thickens the casing and nothing else", () => {
    expect(emphasis("releasing")).toBe(true);
    expect(emphasis("watchful")).toBe(false);
    expect(emphasis(null)).toBe(false);
  });

  it("the river is drawn wider than its tributaries at every zoom", () => {
    for (const [i, [zoom, width]] of MAIN_WIDTH.entries()) {
      expect(TRIBUTARY_WIDTH[i]![0]).toBe(zoom);
      expect(width).toBeGreaterThan(TRIBUTARY_WIDTH[i]![1]);
    }
  });

  it("the casing is always wider than the line it carries", () => {
    expect(CASING_EXTRA).toBeGreaterThan(0);
  });

  it("the reservoir is faint enough to read the alert levels through", () => {
    expect(RESERVOIR_FILL_OPACITY).toBeLessThan(0.5);
  });

  it("a zoom ramp becomes a MapLibre interpolate expression", () => {
    expect(
      byZoom([
        [7, 2],
        [9, 3],
      ]),
    ).toEqual(["interpolate", ["linear"], ["zoom"], 7, 2, 9, 3]);
  });

  it("tributaries are drawn first, so the river lies over them", () => {
    const order = reachesInOrder(DAM).map((r) => r.kind);
    expect(order.indexOf("main")).toBeGreaterThan(order.lastIndexOf("tributary"));
    expect(order).toEqual(["tributary", "tributary", "outlet", "main"]);
  });

  /*
   * With six reservoirs (14 Oct 2026) the legend explains each mark once and then lists the
   * reservoirs: the same text per dam was 1,494 px of legend on a 360 px screen.
   */
  it("explains the marks once, for every reservoir", () => {
    const { container } = renderWithIntl(
      <ul>
        <DamLegendKeys />
      </ul>,
    );
    expect(container.textContent).toContain("อ่างเก็บน้ำ");
    expect(container.textContent).toContain("น้ำจากลำน้ำเอ่อถึงได้");
    // The shaded land is not a flood extent, and the legend has to say so (safety rule 8).
    expect(container.textContent).toContain("ไม่ใช่แผนที่น้ำท่วม");
    // No dam name in it: naming one here would say the marks belong to that one.
    expect(container.textContent).not.toContain("บางลาง");
  });

  it("names each reservoir with its river and its size", () => {
    const { container } = renderWithIntl(<DamLegendRow dam={DAM} />);
    expect(container.textContent).toContain("เขื่อนบางลาง");
    expect(container.textContent).toContain("แม่น้ำปัตตานี");
    expect(container.textContent).toContain("1,590"); // million m3, rounded
  });
});

describe("the copy says the same thing in all three languages", () => {
  const files = {
    th: th as Record<string, unknown>,
    ms: JSON.parse(readFileSync("messages/ms.json", "utf8")),
    en: JSON.parse(readFileSync("messages/en.json", "utf8")),
  };

  const keys = (value: unknown, prefix = ""): string[] =>
    typeof value === "object" && value !== null
      ? Object.entries(value).flatMap(([k, v]) => keys(v, `${prefix}${k}.`))
      : [prefix.slice(0, -1)];

  it("every key exists in Malay and English too", () => {
    const thai = keys((files.th as { dam: unknown }).dam).sort();
    for (const locale of ["ms", "en"] as const) {
      expect(keys((files[locale] as { dam: unknown }).dam).sort()).toEqual(thai);
    }
  });

  it("each one says it is not an alert from Jaga", () => {
    for (const locale of ["th", "ms", "en"] as const) {
      const dam = (files[locale] as { dam: { disclaimer: { notAnAlert: string } } }).dam;
      expect(dam.disclaimer.notAnAlert.length).toBeGreaterThan(20);
    }
  });
});

describe("the dam on the admins' war room", () => {
  const row = EXAMPLE_DAMS[0]!;
  const render = (
    over: Partial<typeof row> = {},
    review: ((f: FormData) => void) | null = () => {},
  ) => renderWithIntl(<DamBoard dams={[{ ...row, ...over }]} now={EXAMPLE_NOW} review={review} />);

  it("says plainly that nothing has been sent to anybody", () => {
    const { getByText } = render();
    expect(getByText(th.warRoom.dam.reviewTitle)).toBeTruthy();
    expect(getByText(th.warRoom.dam.reviewBody)).toBeTruthy();
  });

  it("offers the two answers, and only those two", () => {
    const { getByText, container } = render();
    expect(getByText(th.warRoom.dam.sent)).toBeTruthy();
    expect(getByText(th.warRoom.dam.dismiss)).toBeTruthy();
    const values = [...container.querySelectorAll("button[name='status']")].map((b) =>
      b.getAttribute("value"),
    );
    expect(values.sort()).toEqual(["dismissed", "sent"]);
  });

  it("carries the notice's own id, so a second dam cannot be reviewed by mistake", () => {
    const { container } = render();
    expect(container.querySelector("input[name='notice']")?.getAttribute("value")).toBe(
      row.notice!.id,
    );
  });

  it("wears the state chip, and no other alert or SOS colour", () => {
    // The war room paints an unanswered SOS with border-sos. A dam release is not a level and
    // must not borrow that weight (docs/brand.md) - the chip the owner asked for on 12 Oct is
    // the one thing that carries a hue, and it says what it is in words.
    const { container } = render();
    const chip = container.querySelector("[data-dam-level]")!;
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain(th.dam.state.releasing);
    chip.remove();
    expect(container.innerHTML).not.toMatch(
      /bg-alert-|text-alert-|border-alert-|bg-sos|border-sos/,
    );
  });

  it("names every rule that fired", () => {
    const { container } = render();
    expect(container.textContent).toContain(th.warRoom.dam.reason.spilling);
    expect(container.textContent).toContain(th.warRoom.dam.reason.above_normal_high);
  });

  it("asks for nothing when the dam is quiet", () => {
    const { container, queryByText } = render({
      signal: exampleDamSignal("quiet"),
      notice: null,
    });
    expect(queryByText(th.warRoom.dam.reviewTitle)).toBeNull();
    expect(container.querySelector("[data-dam-notice='none']")).toBeTruthy();
  });

  it("shows who judged it once somebody has", () => {
    const { container } = render({
      notice: {
        ...row.notice!,
        status: "sent",
        reviewedAt: new Date(EXAMPLE_NOW - 60_000).toISOString(),
        reviewedByName: "นาฟิส",
      },
    });
    expect(container.textContent).toContain("นาฟิส");
    // Judged, so it no longer asks.
    expect(container.querySelector("button[name='status']")).toBeNull();
  });

  it("calls out a feed that stopped answering, which otherwise looks like calm", () => {
    const { getByRole } = render({
      feed: {
        ok: false,
        ranAt: new Date(EXAMPLE_NOW - 3_600_000).toISOString(),
        error: "http 504",
      },
    });
    expect(getByRole("alert").textContent).toContain("ดึงข้อมูลเขื่อนไม่สำเร็จ");
  });

  it("calls out figures that are older than usual", () => {
    const { container } = render({ signal: exampleDamSignal("stale") });
    expect(container.textContent).toContain(th.warRoom.dam.stale);
  });

  it("explains an unconfirmed reading rather than grading on it", () => {
    const { container } = render({ signal: exampleDamSignal("awaiting"), notice: null });
    expect(container.textContent).toContain("ต้องตรงกัน");
  });

  it("counts the tambons on the river and on its tributaries", () => {
    const { container } = render();
    expect(container.textContent).toContain("36");
    expect(container.textContent).toContain("3");
  });

  it("draws nothing at all when there is no dam", () => {
    const { container } = renderWithIntl(<DamBoard dams={[]} now={EXAMPLE_NOW} review={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows no form on the example page, which records nothing", () => {
    const { container } = render({}, null);
    expect(container.querySelector("form")).toBeNull();
    // It still says a release is waiting, so the example shows the real state of the screen.
    expect(container.querySelector("[data-dam-notice='open']")).toBeTruthy();
  });
});

describe("the labels on the map marks", () => {
  /*
   * The dam's mark is labelled with its name alone. It used to be the word "dam" plus the name,
   * and since the Thai word for the dam *is* its name, the map read "เขื่อนบางลาง เขื่อนบางลาง"
   * wrapped over two lines. Only a screenshot caught it, so it is pinned here.
   */
  const text = (locale: string) => ({ spillway: "ทางระบายน้ำล้น", outlet: "ท้ายน้ำ", locale });
  const labelOf = (locale: string, kind: string) =>
    damMarks(DAM, text(locale)).find((m) => m.kind === kind)!.label;

  it("the dam's label is its name, once", () => {
    const label = labelOf("th", "dam");
    expect(label).toBe("เขื่อนบางลาง");
    // Twice over would split into three pieces, which is what the map drew before.
    expect(label.split("เขื่อนบางลาง")).toHaveLength(2);
  });

  it("the name follows the reader's language", () => {
    expect(labelOf("en", "dam")).toBe("Bang Lang Dam");
  });

  it("falls back to a name it has when the reader's language has none", () => {
    expect(labelOf("ms", "dam")).toBe("เขื่อนบางลาง");
  });

  it("the spillway and the outlet keep their own words", () => {
    expect(labelOf("th", "spillway")).toBe("ทางระบายน้ำล้น");
    expect(labelOf("th", "outlet")).toBe("ท้ายน้ำ");
  });

  it("a dam with no spillway pinned still gets its own mark", () => {
    const marks = damMarks({ ...DAM, spillwayPoint: null }, text("th"));
    expect(marks.map((m) => m.kind)).toEqual(["dam", "spillway", "outlet"]);
    expect(marks.find((m) => m.kind === "spillway")!.point).toBeNull();
  });
});
