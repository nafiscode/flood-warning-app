import { render as plainRender } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { SignalsView } from "@/components/admin/Signals";
import {
  gaugeNow,
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
    expect(live.container.querySelectorAll("[data-threshold-form] button")).toHaveLength(8);
  });
});
