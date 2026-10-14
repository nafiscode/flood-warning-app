import { describe, expect, it } from "vitest";
import { DamReadout } from "@/components/dam/DamReadout";
import type { Dam } from "@/lib/dam";
import {
  changeOf,
  DIAL_START,
  DIAL_SWEEP,
  dialAngle,
  dialDash,
  flowNow,
  fullnessOf,
  storageNow,
} from "@/lib/dam-readout";
import { exampleDamDaily, exampleDamDays, exampleDamSignal } from "@/lib/dev-examples";
import en from "@/messages/en.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

/*
 * The instrument panel at the head of a reservoir's report (the owner asked for a report with
 * some awe in it for a reader who knows water, 14 Oct 2026). What is tested here is what such a
 * reader would check: the denominators, the units, where each figure came from, and that none of
 * it reads as an alert.
 */

// Cast, not annotated: a dam carries far more than its panel needs.
const BANG_LANG = {
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
  signal: exampleDamSignal("watch"),
  daily: exampleDamDaily("watch"),
  days: exampleDamDays("watch"),
  arrivals: [],
} as unknown as Dam;

const withSignal = (signal: Dam["signal"], more: Partial<Dam> = {}): Dam => ({
  ...BANG_LANG,
  signal,
  ...more,
});

describe("which published figure the stored volume is", () => {
  it("takes the newest hour when the hour has it", () => {
    const now = storageNow(BANG_LANG)!;
    expect(now.from).toBe("hour");
    expect(now.mcm).toBe(1460);
    expect(now.levelM).toBe(114.2);
  });

  it("falls back to the newest figure of the day, and says which day", () => {
    /*
     * This is not a made-up case: on 14 Oct the live feed carried Bang Lang's flows for the
     * newest hour and no storage or level at all, while the daily series still had both. Leaving
     * the two best cells empty would have been the wrong answer.
     */
    const hour = { ...exampleDamSignal("watch")!, storageMcm: null, levelM: null };
    const dam = withSignal(hour);
    const last = dam.days.at(-1)!;
    const now = storageNow(dam)!;
    expect(now.from).toBe("day");
    expect(now.mcm).toBe(last.storageEndMcm);
    expect(now.levelM).toBe(last.levelEndM);
    expect(now.day).toBe(last.day);
    // The share is then worked out from the capacity, not taken from an hour it does not belong to.
    expect(now.percentFull).toBeNull();
  });

  it("says nothing when neither the hour nor any day has it", () => {
    const hour = { ...exampleDamSignal("watch")!, storageMcm: null };
    expect(storageNow(withSignal(hour, { days: [] }))).toBeNull();
    expect(storageNow(withSignal(null, { days: [] }))).toBeNull();
  });
});

describe("how full the reservoir is", () => {
  it("answers with both denominators, because the bulletins use the other one", () => {
    // 1,460 Mm³ is 91.8% of the maximum and over 100% of the capacity at normal high water -
    // the same reservoir, two figures, which is exactly why both are named on screen.
    const full = fullnessOf(BANG_LANG, storageNow(BANG_LANG))!;
    expect(full.percentMax).toBe(92);
    expect(full.percentNormal).toBe(100);
    expect(full.normalMark).toBeCloseTo(1454.4 / 1589.8, 3);
    expect(full.roomToNormalMcm).toBeCloseTo(-5.6, 1);
  });

  it("keeps the share the database worked out itself", () => {
    const dam = withSignal({ ...exampleDamSignal("quiet")!, storageMcm: 748.3, percentFull: 47 });
    expect(fullnessOf(dam, storageNow(dam))!.percentMax).toBe(47);
  });

  it("says nothing at all without a capacity, and nothing of normal without a second one", () => {
    const storage = storageNow(BANG_LANG);
    expect(fullnessOf({ ...BANG_LANG, storageMaxMcm: null }, storage)).toBeNull();
    expect(fullnessOf(BANG_LANG, null)).toBeNull();
    /*
     * The five RID reservoirs publish one capacity as both figures, so "% of normal" would just
     * repeat "% of maximum" and the mark would sit at the end of the dial. Then only one is said.
     */
    const oneCapacity = { ...BANG_LANG, storageNormalMcm: BANG_LANG.storageMaxMcm };
    const same = fullnessOf(oneCapacity, storageNow(oneCapacity))!;
    expect(same.percentNormal).toBeNull();
    expect(same.normalMark).toBeNull();
    expect(same.roomToNormalMcm).toBeNull();
  });

  it("goes past full rather than pretending to stop there (January 2021 did)", () => {
    const dam = withSignal(exampleDamSignal("releasing"));
    expect(fullnessOf(dam, storageNow(dam))!.percentNormal).toBeGreaterThan(100);
  });
});

describe("the dial", () => {
  it("draws three quarters of a circle, open at the bottom", () => {
    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    const empty = dialDash(0, radius);
    expect(Number(empty.value.split(" ")[0])).toBe(0);
    expect(Number(empty.track.split(" ")[0])).toBeCloseTo((circumference * 270) / 360, 6);
    const full = dialDash(1, radius);
    expect(Number(full.value.split(" ")[0])).toBeCloseTo((circumference * 270) / 360, 6);
    // A reservoir over its maximum stays on the scale rather than running round it twice.
    expect(dialDash(1.4, radius).value).toBe(full.value);
  });

  it("puts a mark where normal high water sits, measured from the dial's own start", () => {
    expect(dialAngle(0)).toBe(DIAL_START);
    expect(dialAngle(1)).toBe(DIAL_START + DIAL_SWEEP);
    expect(dialAngle(0.5)).toBe(DIAL_START + DIAL_SWEEP / 2);
  });
});

describe("the flows and the change in storage", () => {
  it("an hourly dam answers with its newest hour, and carries the day's mean beside it", () => {
    const flow = flowNow(BANG_LANG, "inflow")!;
    expect(flow.from).toBe("hour");
    expect(flow.cms).toBe(520);
    // An hour of 0 beside a day that passed millions of cubic metres is the pair that matters.
    expect(flow.meanCms).toBe(exampleDamDaily("watch")!.inflowMeanCms);
    expect(flow.meanHours).toBe(exampleDamDaily("watch")!.inflowHours);
  });

  it("a reservoir reported once a day answers with the day's mean, and says so", () => {
    const daily = { ...exampleDamDaily("watch")!, inflowMeanCms: 46, inflowHours: 24 };
    const flow = flowNow(
      withSignal(exampleDamSignal("watch"), { feed: "daily", daily }),
      "inflow",
    )!;
    expect(flow.from).toBe("mean");
    expect(flow.cms).toBe(46);
    expect(flow.hours).toBe(24);
  });

  it("the rate is the one measured from the readings, with its window", () => {
    expect(changeOf(exampleDamSignal("watch"))).toEqual({
      mcmPerH: 5.2,
      windowH: exampleDamSignal("watch")!.riseWindowH,
      way: "rising",
    });
    const falling = { ...exampleDamSignal("quiet")!, riseMcmPerH: -0.41 };
    expect(changeOf(falling)!.way).toBe("falling");
    expect(changeOf({ ...falling, riseMcmPerH: 0.001 })!.way).toBe("steady");
    // Nothing measured, nothing said (safety rule 8).
    expect(changeOf({ ...falling, riseMcmPerH: null })).toBeNull();
    expect(changeOf(null)).toBeNull();
  });
});

describe("the panel on the screen", () => {
  const panel = (dam: Dam, locale: "th" | "en" = "en") =>
    renderWithIntl(<DamReadout dam={dam} />, locale).container.querySelector(
      "[data-dam-readout]",
    ) as HTMLElement;

  it("gives every figure its unit, its datum and where it came from", () => {
    const text = panel(BANG_LANG).textContent!;
    expect(text).toContain(en.dam.readout.title);
    expect(text).toContain("1,460");
    expect(text).toContain(en.dam.readout.unit.mcm);
    expect(text).toContain("114.20");
    // The datum, not a bare metre figure: these are metres above mean sea level.
    expect(text).toContain(en.dam.readout.unit.m);
    expect(text).toContain("520");
    expect(text).toContain(en.dam.readout.unit.cms);
    expect(text).toContain(en.dam.readout.fromHour);
    expect(text).toContain("+5.20");
    expect(text).toContain(en.dam.readout.unit.mcmPerH);
    expect(text).toContain(
      en.dam.readout.over.replace("{hours}", String(exampleDamSignal("watch")!.riseWindowH)),
    );
  });

  it("names both denominators and marks normal high water on the dial", () => {
    const shown = panel(BANG_LANG);
    expect(shown.textContent).toContain(en.dam.readout.ofMax.replace("{percent}", "92"));
    expect(shown.textContent).toContain(en.dam.readout.ofNormal.replace("{percent}", "100"));
    expect(shown.textContent).toContain(en.dam.readout.normalMark.replace("{percent}", "91"));
    expect(shown.querySelector("[data-dam-dial]")?.getAttribute("data-dam-dial")).toBe("92");
    expect(shown.querySelector("[data-dam-dial] line")).not.toBeNull();
  });

  it("shows the storage the daily series still has, and names the day it belongs to", () => {
    // The live case of 14 Oct: flows for the newest hour, no storage or level in it.
    const dam = withSignal({ ...exampleDamSignal("watch")!, storageMcm: null, levelM: null });
    const shown = panel(dam);
    const last = dam.days.at(-1)!;
    expect(shown.textContent).toContain("1,463");
    expect(last.storageEndMcm).toBe(1463);
    // The made-up days carry no level, so only the real feed exercises that half of the fallback.
    // Not "latest hour": the figure is the day's, and the panel says whose day it is.
    expect(shown.textContent).toContain(en.dam.readout.fromDay.split("{")[0]!.trim());
    expect(shown.querySelector("[data-dam-dial]")).not.toBeNull();
  });

  it("puts the day's mean beside an hour, because the hour alone can say the opposite", () => {
    const daily = exampleDamDaily("watch")!;
    const text = panel(BANG_LANG).textContent!;
    expect(text).toContain(
      en.dam.readout.dayMean
        .replace("{hours}", String(daily.outflowHours))
        .replace("{cms, number}", String(Math.round(daily.outflowMeanCms!))),
    );
  });

  it("writes a falling reservoir with a true minus sign", () => {
    const text = panel(
      withSignal({ ...exampleDamSignal("quiet")!, riseMcmPerH: -0.41 }),
    ).textContent!;
    expect(text).toContain("−0.41");
    expect(text).not.toContain("-0.41");
    expect(text).toContain(en.dam.readout.way.falling);
  });

  it("separates the spillway from the total when water is going over it", () => {
    const text = panel(withSignal(exampleDamSignal("releasing"))).textContent!;
    expect(text).toContain("788");
    expect(text).toContain(en.dam.readout.spill.replace("{cms, number}", "648"));
  });

  it("draws nothing when the dam has published nothing", () => {
    expect(panel(withSignal(null))).toBeNull();
  });

  it("never wears a status: the state is the chip's job, not the panel's", () => {
    // Brand slate and teal only (docs/brand.md); an alert hue here would read as a level
    // somebody issued (safety rule 2).
    for (const scenario of ["quiet", "watch", "releasing"] as const) {
      const html = panel(withSignal(exampleDamSignal(scenario))).outerHTML;
      expect(html).not.toMatch(/bg-alert-|text-alert-|bg-sos|border-alert-/);
    }
  });

  it("has words in Thai", () => {
    const text = panel(BANG_LANG, "th").textContent!;
    expect(text).toContain(th.dam.readout.title);
    expect(text).toContain(th.dam.readout.unit.mcm);
    expect(text).not.toMatch(/dam\.readout/);
  });
});
