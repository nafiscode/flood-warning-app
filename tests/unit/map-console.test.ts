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
      gauge({ status: "above_warning" }),
      gauge({ status: "above_watch" }),
      gauge({ status: "normal", observedAt: "2026-11-20T06:30:00.000Z" }),
      gauge({ status: "no_levels" }),
      gauge({ status: "no_recent_data", observedAt: "2026-11-19T06:00:00.000Z" }),
    ]);
    expect(g.over).toBe(1);
    expect(g.near).toBe(1);
    expect(g.silent).toBe(1);
    expect(g.total).toBe(5);
    // A station with no thresholds still reports; only a silent one does not.
    expect(g.reporting).toBe(4);
    expect(g.newestAt).toBe("2026-11-20T06:30:00.000Z");
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

  it("is behind one breakpoint: a wide screen with a mouse, so no tablet is touched", () => {
    expect(css).toContain(
      "@custom-variant console (@media (min-width: 1024px) and (pointer: fine))",
    );
    // The plain-CSS half of the console must ask exactly the same question.
    const queries = css.match(/@media \(min-width: 1024px\) and \(pointer: fine\)/g) ?? [];
    expect(queries.length).toBe(2);
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
