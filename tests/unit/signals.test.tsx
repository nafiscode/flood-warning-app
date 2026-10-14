import { render as plainRender } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { SignalsView } from "@/components/admin/Signals";
import {
  gaugeNow,
  gaugeState,
  linePath,
  rainBetween,
  rainNow,
  span,
  suggest,
  toSignals,
  type Point,
  type Zone,
} from "@/lib/signals";
import { EXAMPLE_SIGNALS, EXAMPLE_SIGNALS_NOW } from "@/lib/signals-examples";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

// The "Write an alert" link is next-intl's, which wants its provider around it.
const render = (ui: ReactElement) =>
  plainRender(
    <NextIntlClientProvider locale="en" messages={{}}>
      {ui}
    </NextIntlClientProvider>,
  );

const HOUR = 3_600_000;
const now = EXAMPLE_SIGNALS_NOW;
const rising = EXAMPLE_SIGNALS.zones[0]!;
const quiet = EXAMPLE_SIGNALS.zones[1]!;

/** A stand-in for next-intl's `t`: finds the key and fills the {placeholders}. */
function translator(messages: Record<string, unknown>) {
  return (key: string, values: Record<string, string | number> = {}) => {
    const text = key
      .split(".")
      .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages);
    if (typeof text !== "string") throw new Error(`missing message signals.${key}`);
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
  };
}

describe("the figures", () => {
  it("a gauge's state carries its age, its rise and its distance from the bank", () => {
    const state = gaugeNow(rising.key, now)!;
    expect(state.ageH).toBeCloseTo(1);
    expect(state.stale).toBe(false);
    expect(state.riseM).toBeGreaterThan(0.5);
    expect(state.belowBankM).toBeCloseTo(16.5 - state.value);
    expect(gaugeNow(quiet.key, now)!.stale).toBe(true);
    expect(gaugeNow(null, now)).toBeNull();
  });

  it("rain is summed behind and ahead of now, and the largest 72 hours ahead is found", () => {
    const rain: Point[] = Array.from({ length: 200 }, (_, i): Point => [
      now + (i - 100) * HOUR,
      i - 100 > 10 && i - 100 <= 20 ? 10 : 1,
    ]);
    expect(rainBetween(rain, now - 24 * HOUR, now)).toBe(24);
    const r = rainNow(rain, now);
    expect(r.past72).toBe(72);
    expect(r.next24).toBe(24 + 10 * 9);
    expect(r.peak72).toBe(72 + 10 * 9);
    expect(r.peak72At).not.toBeNull();
    expect(rainNow([], now)).toMatchObject({ hasPast: false, hasForecast: false, past72: 0 });
  });

  it("the axis holds the reference lines as well as the readings", () => {
    const [lo, hi] = span([12, 13, 16.5]);
    expect(lo).toBeLessThan(12);
    expect(hi).toBeGreaterThan(16.5);
  });

  it("a line is broken where the gauge was silent", () => {
    const d = linePath(
      [
        [0, 1],
        [HOUR, 2],
        [9 * HOUR, 3],
      ],
      (t) => t / HOUR,
      (v) => v,
    );
    expect(d.match(/M/g)).toHaveLength(2);
  });
});

describe("the suggestion", () => {
  it("a river near its bank suggests Warning, and says which reading and which threshold", () => {
    const s = suggest(rising, now);
    expect(s.level).toBe("warning");
    expect(s.reasons[0]).toMatchObject({ kind: "keyNearBank", level: "warning", threshold: 16 });
    expect(s.blind).toEqual([]);
  });

  it("at the bank it suggests Evacuate", () => {
    const zone: Zone = { ...rising, key: { ...rising.key!, series: [[now - HOUR, 16.6]] } };
    expect(suggest(zone, now).level).toBe("evacuate");
  });

  it("a forecast alone never suggests more than Watch", () => {
    const calm: Zone = {
      ...rising,
      key: { ...rising.key!, series: [[now - HOUR, 12.5]] },
      upstream: null,
      thresholds: [
        {
          signal: "rain_72h_mm",
          levels: { watch: 100, warning: 150 },
          provisional: true,
          updatedAt: null,
        },
      ],
      rain: Array.from({ length: 150 }, (_, i): Point => [
        now + (i - 72) * HOUR,
        i - 72 > 0 ? 5 : 0,
      ]),
    };
    const s = suggest(calm, now);
    expect(s.reasons.map((r) => r.kind)).toEqual(["rain72Forecast"]);
    expect(s.level).toBe("watch");
  });

  it("rain that has already fallen takes the highest level it reaches", () => {
    const wet: Zone = {
      ...quiet,
      thresholds: [
        {
          signal: "rain_72h_mm",
          levels: { watch: 100, warning: 150 },
          provisional: true,
          updatedAt: null,
        },
      ],
      rain: Array.from({ length: 72 }, (_, i): Point => [now - i * HOUR, 2.5]),
    };
    expect(suggest(wet, now).reasons[0]).toMatchObject({ kind: "rain72", level: "warning" });
  });

  it("a silent key gauge gives no reason either way and is named as a blind spot", () => {
    const s = suggest(quiet, now);
    expect(s.level).toBeNull();
    expect(s.blind).toContain("keyGaugeStale");
    // Even a very high old reading must not speak for the river as it is now.
    const old: Zone = { ...quiet, key: { ...quiet.key!, series: [[now - 9 * HOUR, 11]] } };
    expect(suggest(old, now).reasons).toEqual([]);
  });

  it("an old forecast and missing thresholds are blind spots too", () => {
    const s = suggest(
      { ...quiet, thresholds: [], forecastIssuedAt: now - 5 * HOUR, rain: [] },
      now,
    );
    expect(s.blind).toEqual(
      expect.arrayContaining(["noThresholds", "forecastStale", "rainMissing"]),
    );
  });
});

describe("the database's answer", () => {
  it("is read into zones with their key and upstream gauges, and bad rows are dropped", () => {
    const data = toSignals({
      now: "2026-11-26T03:00:00Z",
      feeds: { gauges: { at: "2026-11-26T02:50:00Z", ok: true, error: null }, signals: null },
      zones: [
        {
          id: "z1",
          basin: "pattani_river",
          name: { en: "Pattani River" },
          roles: { key: 2583, upstream: 1095877 },
          thresholds: [
            {
              signal: "key_level_m",
              levels: { warning: 16, evacuate: 16.5, nonsense: 1 },
              provisional: true,
              updatedAt: null,
            },
            { signal: "made_up", levels: { watch: 1 } },
          ],
          gauges: [
            {
              code: "X.40A",
              thaiwaterId: 2583,
              name: {},
              bank: 16.5,
              watch: 16,
              series: [
                ["2026-11-26T02:00:00Z", 15.9],
                ["bad", 1],
                ["2026-11-26T01:00:00Z", null],
              ],
            },
            { code: "X.77", thaiwaterId: 1095877, name: {}, bank: 39.7, watch: null, series: [] },
            { code: "X.10A", thaiwaterId: 2587, name: {}, bank: 1.15, watch: null, series: [] },
          ],
          rain: [["2026-11-26T02:00:00Z", 3.2]],
          discharge: [],
          tide: [],
          issuedAt: "2026-11-26T02:11:00Z",
        },
      ],
    });
    const zone = data.zones[0]!;
    expect(zone.key?.code).toBe("X.40A");
    expect(zone.upstream?.code).toBe("X.77");
    expect(zone.others.map((g) => g.code)).toEqual(["X.10A"]);
    expect(zone.key?.series).toHaveLength(1);
    expect(zone.thresholds).toHaveLength(1);
    expect(zone.thresholds[0]!.levels).toEqual({ warning: 16, evacuate: 16.5 });
    expect(data.feeds.signals).toBeNull();
    expect(toSignals(null).zones).toEqual([]);
  });
});

describe("the screen", () => {
  for (const [locale, messages] of [
    ["en", en],
    ["th", th],
    ["ms", ms],
  ] as const) {
    it(`draws both zones in ${locale} with every message found`, () => {
      const { container } = render(
        <SignalsView
          data={EXAMPLE_SIGNALS}
          locale={locale}
          t={translator(messages.signals as Record<string, unknown>)}
        />,
      );
      expect(container.querySelectorAll("[data-signal-zone]")).toHaveLength(2);
      expect(container.textContent).not.toMatch(/\{\w+\}/);
    });
  }

  it("writes the suggested level in words in an outlined box, never in an alert colour", () => {
    const { container } = render(
      <SignalsView
        data={EXAMPLE_SIGNALS}
        locale="en"
        t={translator(en.signals as Record<string, unknown>)}
      />,
    );
    const zone = container.querySelector('[data-signal-zone="pattani_river"]')!;
    expect(zone.getAttribute("data-suggested")).toBe("warning");
    const box = zone.querySelector("[data-signal-suggestion]")!;
    expect(box.textContent).toContain("Warning");
    expect(box.textContent).toContain("advice only");
    // An alert badge means a person issued that level. Nobody has.
    expect(container.innerHTML).not.toMatch(/bg-alert-|text-alert-|border-alert-|bg-sos/);
  });

  it("marks a silent gauge and says what could not be judged", () => {
    const { container } = render(
      <SignalsView
        data={EXAMPLE_SIGNALS}
        locale="en"
        t={translator(en.signals as Record<string, unknown>)}
      />,
    );
    const zone = container.querySelector('[data-signal-zone="kolok"]')!;
    expect(zone.getAttribute("data-suggested")).toBe("none");
    expect(zone.querySelector("[data-signal-stale]")).not.toBeNull();
    expect(zone.querySelector("[data-signal-blind]")!.textContent).toContain(
      "more than 6 hours old",
    );
  });

  it("has no save button where there is nothing to save to, and one per signal where there is", () => {
    const t = translator(en.signals as Record<string, unknown>);
    const plain = render(<SignalsView data={EXAMPLE_SIGNALS} locale="en" t={t} />);
    expect(plain.container.querySelectorAll("[data-threshold-form] button")).toHaveLength(0);
    const live = render(<SignalsView data={EXAMPLE_SIGNALS} locale="en" t={t} action={() => {}} />);
    // Rain per zone (two signals, two zones); the levels are in each gauge's own box.
    expect(live.container.querySelectorAll("[data-threshold-form] button")).toHaveLength(4);
  });

  it("fills every gauge's box in the zone with its stored levels, and saves them per gauge", async () => {
    const { withGaugeLevels } = await import("@/lib/signals");
    const { EXAMPLE_GAUGE_LEVELS } = await import("@/lib/signals-examples");
    const t = translator(en.signals as Record<string, unknown>);
    const fn = () => {};
    const { container } = render(
      <SignalsView
        data={withGaugeLevels(EXAMPLE_SIGNALS, EXAMPLE_GAUGE_LEVELS)}
        locale="en"
        t={t}
        action={fn}
        levelsAction={fn}
      />,
    );
    const zone = container.querySelector('[data-signal-zone="pattani_river"]')!;
    const box = (code: string) => zone.querySelector(`[data-gauge-levels-box="${code}"]`)!;
    const values = (code: string) =>
      [...box(code).querySelectorAll<HTMLInputElement>("input[data-level]")].map((i) => i.value);
    expect(values("X.40A")).toEqual(["15.75", "16.00", "16.50"]);
    expect(values("X.77")).toEqual(["37.40", "38.15", "39.70"]);
    // A gauge that is neither key nor upstream has a box of its own, from its stored levels.
    expect(values("X.10A")).toEqual(["0.85", "1.05", "1.15"]);
    expect(box("X.10A").querySelector<HTMLInputElement>('input[name="station"]')!.value).toBe(
      "example-X.10A",
    );
    expect(box("X.10A").querySelector("button")).not.toBeNull();
  });

  it("suggests Watch when the key gauge reaches its Watch level", () => {
    const z = {
      ...rising,
      key: { ...rising.key!, series: [[now - HOUR / 2, 15.8]] as Point[] },
      upstream: null,
      rain: [],
    };
    const s = suggest(z, now);
    expect(s.level).toBe("watch");
    expect(s.reasons.map((r) => r.kind)).toContain("keyAtWatch");
  });
});

describe("the automated alarm", () => {
  const t = translator(en.signals as Record<string, unknown>);

  it("puts the switch for every gauge at the top, and a tick per gauge in a zone", () => {
    const fn = () => {};
    const { container } = render(
      <SignalsView
        data={EXAMPLE_SIGNALS}
        locale="en"
        t={t}
        autoAction={fn}
        allAction={fn}
        modeAction={fn}
        dismissAction={fn}
      />,
    );
    const panel = container.querySelector("[data-signals-auto]")!;
    expect(panel.getAttribute("data-signals-auto")).toBe("drill");
    // Above the first zone card.
    const first = container.querySelector("[data-signal-zone]")!;
    expect(panel.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.querySelector("[data-signals-all-on]")).not.toBeNull();
    expect(panel.querySelector("[data-signals-all-off]")).not.toBeNull();
    expect(panel.querySelector("[data-signals-pending]")!.textContent).toContain("X.40A");
    expect(container.querySelectorAll("[data-signal-auto]").length).toBeGreaterThan(0);
  });

  it("offers no buttons without the actions (the example page)", () => {
    const { container } = render(<SignalsView data={EXAMPLE_SIGNALS} locale="en" t={t} />);
    expect(container.querySelector("[data-signals-all-on]")).toBeNull();
  });
});

describe("a gauge's state on the map", () => {
  const g = (value: number, ageH = 0.5, bank: number | null = 10) => ({
    ...rising.key!,
    bank,
    series: [[now - ageH * HOUR, value]] as Point[],
  });

  it("measures a key gauge against its zone's levels and others against their bank", () => {
    const levels = { warning: 16, evacuate: 16.5 };
    expect(gaugeState(g(16.6), now, levels)).toBe("evacuate");
    expect(gaugeState(g(16.1), now, levels)).toBe("warning");
    expect(gaugeState(g(10.2), now)).toBe("warning");
    expect(gaugeState(g(9.7), now)).toBe("near");
    expect(gaugeState(g(5), now)).toBe("normal");
    expect(gaugeState(g(5, 7), now)).toBe("stale");
    expect(gaugeState(g(5, 0.5, null), now)).toBe("nolevels");
  });
});

describe("a gauge's own levels", () => {
  it("are joined by station id, and a key gauge keeps its zone's Warning and Evacuate", async () => {
    const { withGaugeLevels, mapLevels } = await import("@/lib/signals");
    const all = EXAMPLE_SIGNALS.allGauges!;
    const key = all.find((g) => g.code === "X.40A")!;
    const up = all.find((g) => g.code === "X.77")!;
    const data = withGaugeLevels(EXAMPLE_SIGNALS, [
      {
        station_id: key.id,
        watch_m: 15.75,
        warning_m: 16.3,
        evacuate_m: 16.9,
        provisional: true,
        method: {},
      },
      {
        station_id: up.id,
        watch_m: 37.4,
        warning_m: 38.15,
        evacuate_m: 39.7,
        provisional: false,
        method: { how: "rise", floods: 2, bank_suspect: true },
      },
    ]);
    const k = data.allGauges!.find((g) => g.code === "X.40A")!;
    const u = data.allGauges!.find((g) => g.code === "X.77")!;
    expect(mapLevels(k, data.zones)).toEqual({ watch: 15.75, warning: 16, evacuate: 16.5 });
    expect(mapLevels(u, data.zones)).toEqual({ watch: 37.4, warning: 38.15, evacuate: 39.7 });
    expect(u.levels).toMatchObject({ provisional: false, how: "rise", bankSuspect: true });
  });

  it("puts a gauge at Watch once it reaches its own Watch level", () => {
    const g = { ...rising.key!, bank: 10, series: [[now - HOUR / 2, 9.2]] as Point[] };
    expect(gaugeState(g, now, { watch: 9, warning: 9.6, evacuate: 10 })).toBe("near");
    expect(gaugeState(g, now, { watch: 9.3, warning: 9.6, evacuate: 10 })).toBe("normal");
  });
});
