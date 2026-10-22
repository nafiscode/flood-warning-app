import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ageMinutes,
  CONSOLE_LEVELS,
  consoleVeil,
  damTally,
  gaugeTally,
  levelTally,
  reportTally,
  VEIL_COLOR,
  veilAlpha,
} from "@/lib/map-console";
import {
  alertsAlarm,
  damAlarm,
  gaugeAlarm,
  damRun,
  damsAlarm,
  damsLit,
  damsTally,
  gaugeOfInterest,
  gaugeRun,
  gaugesLit,
  LIT_MAX,
  reportsAlarm,
} from "@/lib/map-console";
import { bandFor, CONSOLE_QUERY, LAPTOP_QUERY, TABLET_QUERY } from "@/lib/console-view";
import { contrastRatio } from "@/lib/brand/contrast";
import { brand, darkBrand } from "@/lib/brand/tokens";
import { SCENE_LOOKS, SCENES } from "@/lib/weather-scene";
import type { Dam } from "@/lib/dam";
import type { TambonReports } from "@/lib/flood-reports";
import type { Gauge } from "@/lib/map-data";

const gauge = (over: Partial<Gauge>): Gauge => ({
  id: "g",
  name: { th: "สถานี" },
  lat: 6.8,
  lon: 101.2,
  value: 3,
  observedAt: "2026-11-20T06:00:00.000Z",
  status: "normal",
  ...over,
});

const tambon = (over: Partial<TambonReports>): TambonReports => ({
  tambon: "940101",
  nameTh: "ตำบล",
  nameEn: "Tambon",
  district: "9401",
  districtTh: "อำเภอ",
  districtEn: "District",
  lat: 6.8,
  lon: 101.2,
  reports: 1,
  people: 1,
  deepest: null,
  worstRoad: null,
  trend: null,
  firstAt: "2026-11-20T02:00:00.000Z",
  latestAt: "2026-11-20T05:00:00.000Z",
  confirmed: false,
  ...over,
});

describe("the laptop console's readout strip", () => {
  it("counts only the levels that mean act, worst first", () => {
    expect([...CONSOLE_LEVELS]).toEqual(["evacuate", "warning", "watch"]);
  });

  it("counts each tambon once, at the level of the newest alert that names it", () => {
    // Newest first, as the status feed gives them: the evacuate order is the older one, so the
    // tambon in both counts as a warning and never twice.
    const tally = levelTally([
      { level: "warning", tambons: ["940101", "940102"] },
      { level: "evacuate", tambons: ["940101"] },
      { level: "watch", tambons: ["940103"] },
    ]);
    expect(tally).toEqual([
      { level: "evacuate", tambons: 0 },
      { level: "warning", tambons: 2 },
      { level: "watch", tambons: 1 },
    ]);
  });

  it("never counts normal or return as something in force", () => {
    const tally = levelTally([
      { level: "normal", tambons: ["940101"] },
      { level: "return", tambons: ["940102"] },
    ]);
    expect(tally.every((x) => x.tambons === 0)).toBe(true);
  });

  it("sorts the gauges by what they read and keeps the newest reading", () => {
    const g = gaugeTally([
      gauge({ status: "above_evacuate" }),
      gauge({ status: "above_warning" }),
      // Above its normal level, a long way below its bank: counted as reporting, not as a bank.
      gauge({ status: "above_watch" }),
      gauge({ status: "normal", observedAt: "2026-11-20T06:30:00.000Z" }),
      gauge({ status: "no_levels" }),
      gauge({ status: "no_recent_data", observedAt: "2026-11-19T06:00:00.000Z" }),
    ]);
    expect(g.over).toBe(1);
    expect(g.near).toBe(1);
    expect(g.silent).toBe(1);
    expect(g.total).toBe(6);
    // A station with no thresholds still reports; only a silent one does not.
    expect(g.reporting).toBe(5);
    expect(g.newestAt).toBe("2026-11-20T06:30:00.000Z");
  });

  /*
   * The owner, 18 Oct 2026: the rivers' readout opens a station, the way the reservoir's opens
   * its card. Which station must not wander between presses, or the card would answer a
   * different question each time.
   */
  it("opens the station that matters most, and the same one every time", () => {
    const over = gauge({ id: "over", status: "above_evacuate" });
    const near = gauge({ id: "near", status: "above_warning" });
    const high = gauge({ id: "high", status: "above_watch" });
    const quiet = gauge({ id: "quiet", status: "no_recent_data" });
    const normal = gauge({ id: "normal", status: "normal" });
    expect(gaugeOfInterest([quiet, normal, high, near, over])!.id).toBe("over");
    expect(gaugeOfInterest([quiet, normal, high, near])!.id).toBe("near");
    expect(gaugeOfInterest([quiet, normal, high])!.id).toBe("high");
    expect(gaugeOfInterest([quiet, normal])!.id).toBe("normal");
    expect(gaugeOfInterest([quiet])!.id).toBe("quiet");
    // The order they arrive in never changes the answer.
    expect(gaugeOfInterest([over, near, quiet, normal])!.id).toBe("over");
  });

  /*
   * The owner, 18 Oct: "the nearest of the user's place... if users have multiple watch places,
   * show the riskiest one first", and 20 Oct: a river at or near its bank comes first "regardless
   * they are near or not". So their own rivers are the pool below the bank, and distance only
   * breaks a tie between two stations reading the same.
   */
  it("opens one of the person's own rivers, the riskiest of them", () => {
    const home = { lat: 6.87, lon: 101.27 };
    // Far enough from home that its station is not within reach of home as well (50 km).
    const watched = { lat: 6.0, lon: 101.28 };
    const nearHome = gauge({ id: "nearHome", lat: 6.88, lon: 101.28, status: "normal" });
    const nearWatched = gauge({
      id: "nearWatched",
      lat: 6.01,
      lon: 101.29,
      status: "above_evacuate",
    });
    const farAway = gauge({ id: "far", lat: 7.6, lon: 100.1, status: "above_evacuate" });
    const all = [farAway, nearHome, nearWatched];
    // Two places, one of them with a station over its bank: that one.
    expect(gaugeOfInterest(all, [home, watched])!.id).toBe("nearWatched");
    /*
     * With only the quiet place saved, the far station over its bank is still the one that
     * opens - the readout counts all four provinces, so what it counts is what it opens. This
     * supersedes the rule of 18 Oct, where their own river came first whatever the others read.
     */
    expect(gaugeOfInterest([farAway, nearHome], [home])!.id).toBe("far");
    // Below the bank, their own river is read before everybody else's, as it always was.
    const farQuiet = gauge({ id: "farQuiet", lat: 7.6, lon: 100.1, status: "normal" });
    expect(gaugeOfInterest([farQuiet, nearHome], [home])!.id).toBe("nearHome");
    // Two over their banks: the nearer of them, which is how "all" reads here.
    expect(gaugeOfInterest(all, [home])!.id).toBe("nearWatched");
    // Reading the same, the nearer of their own wins.
    const alsoOver = gauge({ id: "alsoOver", lat: 6.2, lon: 101.3, status: "above_evacuate" });
    expect(gaugeOfInterest([alsoOver, nearWatched], [watched])!.id).toBe("nearWatched");
  });

  it("falls back to every river for somebody who has saved nowhere near one", () => {
    const far = gauge({ id: "far", lat: 7.6, lon: 100.1, status: "above_evacuate" });
    const quiet = gauge({ id: "quiet", lat: 7.4, lon: 100.2, status: "no_recent_data" });
    // Their place is hundreds of kilometres from both: they still get the riskiest.
    expect(gaugeOfInterest([quiet, far], [{ lat: 6.2, lon: 102.0 }])!.id).toBe("far");
    expect(gaugeOfInterest([quiet, far], [])!.id).toBe("far");
  });

  it("takes the newest reading among equals, and the id when even that ties", () => {
    const old = gauge({ id: "b", status: "normal", observedAt: "2026-11-20T05:00:00.000Z" });
    const fresh = gauge({ id: "c", status: "normal", observedAt: "2026-11-20T06:00:00.000Z" });
    expect(gaugeOfInterest([old, fresh])!.id).toBe("c");
    const same = { status: "normal" as const, observedAt: "2026-11-20T06:00:00.000Z" };
    expect(gaugeOfInterest([gauge({ id: "z", ...same }), gauge({ id: "a", ...same })])!.id).toBe(
      "a",
    );
    expect(gaugeOfInterest([])).toBeNull();
  });

  it("has nothing to say about gauges that have never reported", () => {
    expect(gaugeTally([gauge({ observedAt: null })]).newestAt).toBeNull();
    expect(gaugeTally([]).total).toBe(0);
  });

  it("adds up the standing reports and the tambons they come from", () => {
    const r = reportTally([
      tambon({ reports: 3, people: 2, confirmed: true }),
      tambon({
        tambon: "940102",
        reports: 1,
        people: 1,
        latestAt: "2026-11-20T07:00:00.000Z",
      }),
    ]);
    expect(r).toEqual({
      reports: 4,
      people: 3,
      tambons: 2,
      confirmed: 1,
      latestAt: "2026-11-20T07:00:00.000Z",
    });
  });

  it("reads the dam's own figures, and says nothing when there is no reading", () => {
    const base = { code: "bang_lang", name: { th: "เขื่อนบางลาง" } } as unknown as Dam;
    expect(damTally(undefined)).toBeNull();
    expect(damTally({ ...base, signal: null } as Dam)).toEqual({
      dam: { ...base, signal: null },
      percentFull: null,
      spilledCms: null,
      normalMark: null,
      outflowCms: null,
      inflowCms: null,
      observedAt: null,
      stale: false,
    });
    const withSignal = {
      ...base,
      signal: {
        observedAt: "2026-11-20T01:00:00.000Z",
        percentFull: 62.4,
        outflowCms: 118,
        releasedCms: 90,
        inflowCms: 200,
        stale: true,
      },
    } as unknown as Dam;
    const d = damTally(withSignal)!;
    // Everything leaving the dam, not only what went through the turbines.
    expect(d.outflowCms).toBe(118);
    expect(d.percentFull).toBe(62.4);
    expect(d.stale).toBe(true);
  });

  it("falls back to the released figure when no total outflow is published", () => {
    const dam = {
      code: "x",
      name: {},
      signal: { observedAt: null, outflowCms: null, releasedCms: 42, stale: false },
    } as unknown as Dam;
    expect(damTally(dam)!.outflowCms).toBe(42);
  });

  it("gives a reading's age in whole minutes, and never a negative one", () => {
    const now = Date.parse("2026-11-20T06:30:00.000Z");
    expect(ageMinutes("2026-11-20T06:00:00.000Z", now)).toBe(30);
    expect(ageMinutes("2026-11-20T06:29:30.000Z", now)).toBe(0);
    // A station clock running ahead must not read as "-5 minutes ago".
    expect(ageMinutes("2026-11-20T06:35:00.000Z", now)).toBe(0);
    expect(ageMinutes(null, now)).toBeNull();
    expect(ageMinutes("not a time", now)).toBeNull();
  });
});

describe("the console's arrangement", () => {
  const css = readFileSync("app/globals.css", "utf8");

  /*
   * Three bands since 21 Oct 2026, exclusive and between them every screen (lib/console-view.ts
   * holds the same three). The floor moved from 1024 to 1280 because a tablet with a keyboard
   * reports a fine pointer, passed the old test, and was handed a 216-369 px map.
   */
  it("asks the same three questions for Tailwind and in plain CSS", () => {
    /*
     * The variant has to be written as a block of three `@media` rules with `@slot` in each:
     * a comma-separated list inside `@custom-variant console (...)` takes the first clause and
     * leaves the rest dangling in the selector, and the stylesheet then fails to parse (seen in
     * the dev server, 21 Oct).
     */
    const variant = css.slice(css.indexOf("@custom-variant console {"));
    const block = variant.slice(0, variant.indexOf("\n}"));
    for (const query of CONSOLE_QUERY.split(", ")) {
      expect(block).toContain(`@media ${query} {`);
      // And the plain-CSS half of the console asks exactly the same thing.
      expect(css.slice(css.indexOf(block) + block.length)).toContain(query);
    }
    expect(block.split("@slot").length - 1).toBe(3);
    // A laptop needs a pointer that can hover; a tablet held sideways does not.
    expect(CONSOLE_QUERY).toContain(LAPTOP_QUERY);
    expect(CONSOLE_QUERY).toContain(TABLET_QUERY);
  });

  it("has a tablet block that takes the three columns down to two", () => {
    // The block the tablet band is written in, which is the last thing to mention that band.
    const at = css.lastIndexOf("@media (min-width: 1024px) and (max-width: 1279.98px)");
    expect(at).toBeGreaterThan(0);
    const block = css.slice(at);
    /*
     * The two columns are written on the console while the map is NOT on its own: full screen
     * lays the same blocks out by hand, and naming the grid areas again there put the map in a
     * dashboard-sized cell with the layer switches floating over the middle of the screen (the
     * owner, on an iPad held sideways, 21 Oct). So the selector is part of the test.
     */
    const twoColumns = block.slice(block.indexOf("[data-map-console]:not([data-map-full]) {"));
    const areas = twoColumns.slice(twoColumns.indexOf("grid-template-areas:"));
    expect(areas.slice(0, areas.indexOf(";"))).toContain('"map    side"');
    expect(areas.slice(0, areas.indexOf(";"))).toContain('"rail   rail"');
    // The map's and the panel's own height is scoped the same way, for the same reason.
    expect(block).toContain('[data-map-console]:not([data-map-full]) [data-console-area="map"]');
    // No hover on a touch screen: the pin is the way a readout opens, and it is always there.
    expect(block).toMatch(/\[data-console-tile\] \[data-tile-pin\] \{\s*opacity: 1/);
    /*
     * Only the left rail stops scrolling inside itself. The answer panel beside the map keeps
     * its own height and its own scrollbar: when it did not, the legend inside it hung out of
     * the bottom of the page's box and the hotline bar, the links and the season outlook all
     * stopped about a screen early (the owner, on an iPad Air held sideways, 21 Oct).
     */
    const rail = block.slice(
      block.indexOf('[data-map-console]:not([data-map-full]) [data-console-area="rail"] {'),
    );
    expect(rail.slice(0, rail.indexOf("}"))).toContain("overflow: visible");
    expect(block).not.toMatch(/\[data-console-rail\] \{\s*overflow: visible/);

    // Thumb-sized controls, where the laptop's are sized for a pointer.
    expect(block).toMatch(
      /\[data-console-tile\] \[data-tile-card\] button \{\s*min-height: 2\.75rem/,
    );
  });

  /*
   * The owner, 23 Oct 2026: "when open the Full screen map, also bring the 5 cards that show
   * live monitoring to be on Right side of the map, align vertically".
   */
  it("stands the readouts in a column beside the full-screen map, on a laptop only", () => {
    // The laptop-only block: the last place that asks for a fine pointer on its own.
    const at = css.lastIndexOf("@media (min-width: 1280px) and (pointer: fine) {");
    expect(at).toBeGreaterThan(0);
    const rest = css.slice(at);
    // Its own block and no more: the tablet's is written straight after it.
    const block = rest.slice(0, rest.indexOf("\n@media", 1));
    // Three columns now: the pickers, the map, the readouts.
    const columns = block.slice(block.indexOf("grid-template-columns:"));
    expect(columns.slice(0, columns.indexOf(";"))).toBe(
      "grid-template-columns: minmax(0, 21rem) minmax(0, 1fr) minmax(0, 20rem)",
    );
    const tiles = block.slice(block.indexOf("[data-map-full] [data-console-tiles] {"));
    const rule = tiles.slice(0, tiles.indexOf("}"));
    expect(rule).toContain("grid-column: 3");
    expect(rule).toContain("grid-row: 1 / span 2");
    // One card above the next, and the column scrolls rather than the map moving.
    expect(rule).toContain("grid-template-columns: minmax(0, 1fr)");
    expect(rule).toContain("overflow-y: auto");
    /*
     * It comes after the block that hides everything but the map and the pickers, because that
     * list is shared with the tablet - where a third column would leave the map about 350 px.
     */
    expect(at).toBeGreaterThan(css.indexOf('> *:not([data-console-area="rail"]'));
    expect(block).not.toContain("@media (min-width: 1024px)");
    // And the console block it follows still ends where it did: the tablet reads it too.
    expect(css.slice(0, at)).toContain("[data-places-toggle] {");
  });

  it("keeps the readout's own controls above the cover that opens the card", () => {
    const at = css.indexOf("[data-tile-card] [data-tile-head],");
    expect(at).toBeGreaterThan(0);
    expect(css.slice(at, css.indexOf("}", at))).toContain("z-index: 3");
    // The cover itself is below them.
    const cover = css.indexOf("[data-tile-toggle] {");
    expect(css.slice(cover, css.indexOf("}", cover))).toContain("z-index: 2");
  });

  it("puts every screen in exactly one band", () => {
    const band = (width: number, height: number, pointer: "fine" | "coarse") =>
      bandFor({ width, height, pointer });
    // The six tablet sizes measured on the live site on 21 Oct.
    expect(band(744, 1133, "coarse")).toBe("phone");
    expect(band(1133, 744, "coarse")).toBe("tablet");
    expect(band(820, 1180, "coarse")).toBe("phone");
    expect(band(1180, 820, "coarse")).toBe("tablet");
    // Upright, even an iPad Pro: 1024 px cannot hold two columns and a map worth looking at.
    expect(band(1024, 1366, "coarse")).toBe("phone");
    expect(band(1366, 1024, "coarse")).toBe("tablet");
    /*
     * A tablet with a keyboard: at 1,366 px the three columns measured well (a 525 px map) and
     * the pointer can hover, so it gets the laptop console. Upright it is the phone's, and
     * between 1,024 and 1,280 it is the tablet's - which is the case the floor was raised for.
     */
    expect(band(1366, 1024, "fine")).toBe("laptop");
    expect(band(1024, 1366, "fine")).toBe("phone");
    expect(band(1180, 820, "fine")).toBe("tablet");
    // Phones, and a laptop.
    expect(band(360, 640, "coarse")).toBe("phone");
    expect(band(1440, 900, "fine")).toBe("laptop");
    // A laptop window pulled in narrower gets the tablet arrangement, not the phone's.
    expect(band(1100, 800, "fine")).toBe("tablet");
  });

  it("reads left rail, then the map, then the right rail - the page's own order of blocks", () => {
    const areas = css.slice(css.indexOf("grid-template-areas:"));
    expect(areas.slice(0, areas.indexOf(";"))).toContain('"rail   map    side"');
  });

  it("keeps the figures lined up without reaching for a font that cannot write Thai", () => {
    expect(css).toContain("font-variant-numeric: tabular-nums");
    expect(css).not.toMatch(/\[data-console-readout\][^}]*font-family/);
  });
});

/** What a veil of `alpha` leaves behind, which is what the console's words sit on. */
function behind(veil: string, alpha: number, sky: string): string {
  const parts = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  const [vr, vg, vb] = parts(veil);
  const [sr, sg, sb] = parts(sky);
  const mix = (a: number, b: number) => Math.round(a * alpha + b * (1 - alpha));
  return `#${[mix(vr!, sr!), mix(vg!, sg!), mix(vb!, sb!)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

describe("the weather behind the console", () => {
  it("keeps the weakest text readable on every sky, in both themes", () => {
    for (const scene of SCENES) {
      const sky = SCENE_LOOKS[scene].sky;
      const veil = consoleVeil(sky);
      for (const colour of sky) {
        // The secondary grey is the weakest thing written on the sky; if it passes, all do.
        expect(
          contrastRatio(brand["jaga-text-2"], behind(VEIL_COLOR.light, veil.light, colour)),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(darkBrand["jaga-text-2"], behind(VEIL_COLOR.dark, veil.dark, colour)),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("lets a clear day through and holds a storm back", () => {
    // The point of working it out per sky: a blue sky is a blue sky, and a dark one is not
    // allowed to swallow the words on it.
    expect(consoleVeil(SCENE_LOOKS.clearDay.sky).light).toBeLessThan(
      consoleVeil(SCENE_LOOKS.thunder.sky).light,
    );
    expect(consoleVeil(SCENE_LOOKS.clearDay.sky).light).toBeLessThan(0.5);
  });

  it("never asks for more veil than it needs", () => {
    // One step lighter than what it chose must fail, give or take the margin it adds.
    const sky = SCENE_LOOKS.overcast.sky;
    const alpha = veilAlpha(sky, brand["jaga-text-2"], VEIL_COLOR.light);
    const lighter = Math.round((alpha - 0.06) * 100) / 100;
    expect(
      sky.every(
        (c) => contrastRatio(brand["jaga-text-2"], behind(VEIL_COLOR.light, lighter, c)) >= 4.5,
      ),
    ).toBe(false);
  });

  it("falls back to a readable veil rather than none when a sky is impossible", () => {
    expect(veilAlpha(["#4A5E68"], brand["jaga-text-2"], VEIL_COLOR.light)).toBeGreaterThan(0.5);
  });
});

describe("the readouts that ask for an admin's eye", () => {
  const dam = (over: Record<string, unknown>) =>
    ({
      dam: {} as never,
      percentFull: null,
      spilledCms: null,
      normalMark: null,
      outflowCms: null,
      inflowCms: null,
      observedAt: null,
      stale: false,
      ...over,
    }) as Parameters<typeof damAlarm>[0];

  it("blinks the alerts card at the worst level in force, and never at Watch", () => {
    expect(alertsAlarm(levelTally([{ level: "evacuate", tambons: ["940101"] }]))).toBe("evacuate");
    expect(alertsAlarm(levelTally([{ level: "warning", tambons: ["940101"] }]))).toBe("warning");
    // A watch is not a thing to act on at a glance; it would blink for most of a wet week.
    expect(alertsAlarm(levelTally([{ level: "watch", tambons: ["940101"] }]))).toBeNull();
    expect(alertsAlarm([])).toBeNull();
    // The worst wins when two are in force.
    const both = levelTally([
      { level: "warning", tambons: ["940101"] },
      { level: "evacuate", tambons: ["940102"] },
    ]);
    expect(alertsAlarm(both)).toBe("evacuate");
  });

  it("never dresses a measurement or a resident's report as a level (safety rules 2 and 3)", () => {
    // Everything but the alerts card asks in the page's own ink, never in the alert palette.
    expect(gaugeAlarm({ over: 2 })).toBe("attention");
    expect(damAlarm(dam({ spilledCms: 40 }))).toBe("attention");
    expect(reportsAlarm({ confirmed: 1 })).toBe("attention");
  });

  it("asks only when it is worth asking", () => {
    // A river near its bank is not over it.
    expect(gaugeAlarm({ over: 0 })).toBeNull();
    expect(reportsAlarm({ confirmed: 0 })).toBeNull();
    expect(damAlarm(null)).toBeNull();
    expect(damAlarm(dam({ spilledCms: 0, percentFull: 47, normalMark: 0.8 }))).toBeNull();
  });

  it("blinks the dam when the reservoir is past the level it is normally held at", () => {
    expect(damAlarm(dam({ percentFull: 85, normalMark: 0.8 }))).toBe("attention");
    expect(damAlarm(dam({ percentFull: 75, normalMark: 0.8 }))).toBeNull();
    // Nothing published about the normal level is not a reason to blink.
    expect(damAlarm(dam({ percentFull: 99, normalMark: null }))).toBeNull();
  });

  it("pulses slowly enough to be safe, and stops when less motion is asked for", () => {
    const css = readFileSync("app/globals.css", "utf8");
    // Three flashes a second can harm a photosensitive reader; this is about one every two.
    const rule = css.slice(css.indexOf("[data-console-alarm] {"));
    const seconds = Number(/animation: jaga-console-alarm ([\d.]+)s/.exec(rule)?.[1]);
    expect(seconds).toBeGreaterThanOrEqual(1);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\[data-console-alarm\]/);
  });
});

/*
 * The owner, 20 Oct 2026: a press on either readout opens the worst of what it counts, and the
 * card then walks through the rest. Both runs are total orders, so Next cannot wander and a
 * second press cannot land somewhere else.
 */
describe("the run a readout opens, and the marks it lights", () => {
  /** The least a reservoir needs for the order to be worked out. */
  const dam = (over: Partial<Dam>): Dam =>
    ({ code: "d", name: {}, signal: null, reaches: [], ...over }) as unknown as Dam;
  const over = gauge({ id: "over", lat: 7.5, lon: 100.1, status: "above_evacuate" });
  const near1 = gauge({ id: "near1", lat: 6.3, lon: 101.1, status: "above_warning" });
  const near2 = gauge({ id: "near2", lat: 6.9, lon: 101.6, status: "above_warning" });
  const near3 = gauge({ id: "near3", lat: 6.1, lon: 101.9, status: "above_warning" });
  const calm = gauge({ id: "calm", lat: 6.8, lon: 101.2, status: "normal" });

  it("puts every river at or near its bank first, however far away it is", () => {
    const home = [{ lat: 6.8, lon: 101.2 }];
    const run = gaugeRun([calm, near1, over], home);
    expect(run.map((g) => g.id)).toEqual(["over", "near1", "calm"]);
    // Their own quiet river still comes before a stranger's quiet river.
    const farCalm = gauge({ id: "farCalm", lat: 7.5, lon: 100.2, status: "normal" });
    expect(gaugeRun([farCalm, calm], home).map((g) => g.id)).toEqual(["calm", "farCalm"]);
  });

  it("lights at most three, and never a river that is nowhere near its bank", () => {
    const lit = gaugesLit(gaugeRun([calm, near1, near2, near3, over]));
    expect(lit.map((g) => g.id)).toEqual(["over", "near1", "near2"].slice(0, LIT_MAX));
    expect(lit).toHaveLength(LIT_MAX);
    expect(lit.some((g) => g.id === "calm")).toBe(false);
    // With no river near its bank, the one station the card opens on - never nothing.
    expect(gaugesLit(gaugeRun([calm])).map((g) => g.id)).toEqual(["calm"]);
    expect(gaugesLit([])).toEqual([]);
  });

  /** A reservoir past the level it is normally held at, by `over` of its whole capacity. */
  const past = (code: string, over: number, size = 100) =>
    dam({
      code,
      signal: { percentFull: (0.8 + over) * 100 } as Dam["signal"],
      storageMaxMcm: size,
      storageNormalMcm: size * 0.8,
    });

  it("puts a spilling reservoir before a full one, and the worst of each first", () => {
    const quiet = dam({ code: "quiet" });
    const full = past("full", 0.17);
    const spilling = dam({ code: "spilling", signal: { spilledCms: 40 } as Dam["signal"] });
    const run = damRun([quiet, full, spilling]);
    expect(run.map((d) => d.code)).toEqual(["spilling", "full", "quiet"]);
    expect(damsLit(run).map((d) => d.code)).toEqual(["spilling", "full"]);
    // Within each half, criticality: more water over the spillway, and further past normal.
    const trickle = dam({ code: "trickle", signal: { spilledCms: 2 } as Dam["signal"] });
    expect(damRun([trickle, spilling]).map((d) => d.code)).toEqual(["spilling", "trickle"]);
    expect(damRun([past("a", 0.02), past("b", 0.12)]).map((d) => d.code)).toEqual(["b", "a"]);
    expect(damsLit([])).toEqual([]);
  });

  it("opens the largest reservoir first when all of them are normal", () => {
    // The owner, 23 Oct 2026: "for the normal situation for all, it should bring the largest
    // capacity first, sort by that" - not the dam the chips happen to mean.
    const small = dam({ code: "small", storageMaxMcm: 100 });
    const big = dam({ code: "big", storageMaxMcm: 1420 });
    const mid = dam({ code: "mid", storageMaxMcm: 400 });
    expect(damRun([small, big, mid]).map((d) => d.code)).toEqual(["big", "mid", "small"]);
    // And only that one is lit, because there is nothing to point at.
    expect(damsLit(damRun([small, big, mid])).map((d) => d.code)).toEqual(["big"]);
  });

  it("counts every reservoir for the dam readout, and blinks when any of them is doing something", () => {
    const quiet = dam({ code: "quiet", storageMaxMcm: 1420 });
    const spilling = dam({ code: "spilling", signal: { spilledCms: 40 } as Dam["signal"] });
    const calm = damsTally([quiet]);
    expect(calm).toMatchObject({ spilling: 0, aboveNormal: 0, watch: 0, total: 1, live: false });
    expect(calm.lead?.dam.code).toBe("quiet");
    expect(damsAlarm(calm)).toBeNull();

    const busy = damsTally([quiet, spilling, past("full", 0.1)]);
    expect(busy).toMatchObject({ spilling: 1, aboveNormal: 1, watch: 2, total: 3 });
    // Titled by the worst, never by the biggest, while anything is happening.
    expect(busy.lead?.dam.code).toBe("spilling");
    expect(damsAlarm(busy)).toBe("attention");

    /*
     * The dot beside the figure is about that figure: the reservoir the card names. A dot fed by
     * some other reservoir's clock would say "live" about a number that is a day old.
     */
    const sending = dam({
      code: "sending",
      storageMaxMcm: 2000,
      signal: { percentFull: 40, observedAt: "2026-10-23T01:00:00Z", stale: false } as Dam["signal"],
    });
    expect(damsTally([quiet, sending]).live).toBe(true);
    const stopped = dam({
      code: "stopped",
      storageMaxMcm: 3000,
      signal: { percentFull: 40, observedAt: "2026-10-01T01:00:00Z", stale: true } as Dam["signal"],
    });
    // The biggest leads here, and its feed has stopped - whatever the others are sending.
    expect(damsTally([stopped, sending]).live).toBe(false);
  });
});
