import { render as plainRender } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { SignalsView } from "@/components/admin/Signals";
import {
  bangkokDay,
  coastalGate,
  gateDays,
  slowReturn,
  toReferences,
  type GateReference,
} from "@/lib/coastal-gate";
import type { Point } from "@/lib/signals";
import { withGaugeLevels } from "@/lib/signals";
import {
  EXAMPLE_COASTAL_GATE,
  EXAMPLE_GAUGE_LEVELS,
  EXAMPLE_SIGNALS,
  EXAMPLE_SIGNALS_NOW,
} from "@/lib/signals-examples";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => {} }),
}));

const render = (ui: ReactElement) =>
  plainRender(
    <NextIntlClientProvider locale="en" messages={{}}>
      {ui}
    </NextIntlClientProvider>,
  );

function translator(messages: Record<string, unknown>) {
  return (key: string, values: Record<string, string | number> = {}) => {
    const text = key
      .split(".")
      .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], messages);
    if (typeof text !== "string") throw new Error(`missing message signals.${key}`);
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? `{${name}}`));
  };
}

const HOUR = 3_600_000;
const now = EXAMPLE_SIGNALS_NOW;
const reference = toReferences(EXAMPLE_COASTAL_GATE).find((g) => g.id === "pattani_river")!;

/** Hourly sea level from `from` to `to` hours around now. */
const tide = (from: number, to: number, f: (h: number) => number): Point[] =>
  Array.from({ length: to - from + 1 }, (_, i): Point => [now + (from + i) * HOUR, f(from + i)]);

/** A plain daily curve: `mean` with a tidal range of `range`. */
const curve = (mean: number, range: number) => (h: number) =>
  mean + (range / 2) * Math.sin((h / 12.4) * 2 * Math.PI);

describe("reading the reference", () => {
  it("keeps the rows it can read and drops the ones it cannot", () => {
    const rows = toReferences([
      ...EXAMPLE_COASTAL_GATE,
      { id: "broken", lat: null, lon: 101 },
      { lat: 6, lon: 101 },
      "nonsense",
    ]);
    expect(rows.map((r) => r.id)).toEqual(["pattani_river", "kolok", "bang_nara"]);
    expect(toReferences(null)).toEqual([]);
    expect(rows[0]!.llw).toEqual({ p50: 0.75, p90: 0.94, p98: 1.1 });
    // A mouth with no warning zone keeps its reference and has no basin to match a zone on.
    expect(rows[2]!.basin).toBeNull();
  });
});

describe("folding the forecast into Bangkok days", () => {
  it("a Bangkok day starts at 17:00 the day before, UTC", () => {
    expect(new Date(bangkokDay(Date.UTC(2026, 10, 26, 3, 0))).toISOString()).toBe(
      "2026-11-25T17:00:00.000Z",
    );
    // 16:59 UTC is still the same Bangkok day; 17:00 is the next one.
    expect(bangkokDay(Date.UTC(2026, 10, 26, 16, 59))).toBe(bangkokDay(Date.UTC(2026, 10, 26, 3)));
    expect(bangkokDay(Date.UTC(2026, 10, 26, 17, 0))).toBeGreaterThan(
      bangkokDay(Date.UTC(2026, 10, 26, 3)),
    );
  });

  it("leaves out days behind us and days with too few hours", () => {
    const days = gateDays(tide(-48, 40, curve(0.7, 0.9)), reference, now);
    // Yesterday is gone; the last day holds only a few hours, so it is not read as a low.
    expect(days.every((d) => d.at >= bangkokDay(now))).toBe(true);
    expect(days.every((d) => d.hours >= 20)).toBe(true);
  });

  it("reads each day's lowest and highest, and the range between them", () => {
    const days = gateDays(tide(-24, 72, curve(1.0, 0.6)), reference, now);
    expect(days.length).toBeGreaterThan(0);
    const first = days[0]!;
    expect(first.low).toBeCloseTo(0.7, 1);
    expect(first.high).toBeCloseTo(1.3, 1);
    expect(first.range).toBeCloseTo(first.high - first.low);
  });
});

describe("the gate", () => {
  it("is shut when the low water stays over p90 for two days running", () => {
    // Set-up with the range squeezed: low water about 1.11, over p90 (0.94) and p98 (1.10).
    const gate = coastalGate(tide(-24, 72, curve(1.25, 0.28)), reference, now);
    expect(gate.state).toBe("shut");
    expect(gate.shutRun).toBeGreaterThanOrEqual(2);
    expect(gate.shutFrom).toBe(bangkokDay(now));
    expect(gate.days.every((d) => d.shut && d.hard)).toBe(true);
  });

  it("is open when the sea drops away normally every day", () => {
    const gate = coastalGate(tide(-24, 72, curve(0.7, 0.9)), reference, now);
    expect(gate.state).toBe("open");
    expect(gate.shutRun).toBe(0);
    expect(gate.shutFrom).toBeNull();
  });

  it("is narrowing on one shut day alone: one high day is a tide, not a gate", () => {
    const shutDay = bangkokDay(now);
    const series = tide(-24, 72, curve(0.7, 0.9)).map(([at, v]): Point => [
      at,
      bangkokDay(at) === shutDay ? v + 0.8 : v,
    ]);
    const gate = coastalGate(series, reference, now);
    expect(gate.shutRun).toBe(1);
    expect(gate.state).toBe("narrowing");
  });

  it("is narrowing when every day ahead sits over the median without reaching p90", () => {
    const gate = coastalGate(tide(-24, 72, curve(1.0, 0.3)), reference, now);
    expect(gate.days.every((d) => d.low > reference.llw.p50! && !d.shut)).toBe(true);
    expect(gate.state).toBe("narrowing");
  });

  it("is unknown, never open, with nothing stored or no reference line", () => {
    expect(coastalGate([], reference, now).state).toBe("unknown");
    const noLine: GateReference = { ...reference, llw: { p50: null, p90: null, p98: null } };
    expect(coastalGate(tide(-24, 72, curve(0.7, 0.9)), noLine, now).state).toBe("unknown");
  });

  it("ignores hours that are not numbers rather than reading them as a low", () => {
    const series = [
      ...tide(-24, 72, curve(1.25, 0.28)),
      [now + 5 * HOUR, Number.NaN] as Point,
      [Number.NaN, 0.1] as Point,
    ];
    expect(coastalGate(series, reference, now).state).toBe("shut");
  });
});

describe("the safe-return window", () => {
  it("reads at its slow end only for a gauge the tide reaches, and only when the gate is shut", () => {
    const shut = coastalGate(tide(-24, 72, curve(1.25, 0.28)), reference, now);
    const open = coastalGate(tide(-24, 72, curve(0.7, 0.9)), reference, now);
    expect(slowReturn(shut, true)).toBe(true);
    // Above the tide's reach the gauge's own record already says how it falls back.
    expect(slowReturn(shut, false)).toBe(false);
    expect(slowReturn(open, true)).toBe(false);
    expect(slowReturn(null, true)).toBe(false);
  });
});

describe("on the dashboard", () => {
  const data = withGaugeLevels(EXAMPLE_SIGNALS, EXAMPLE_GAUGE_LEVELS);

  it("names the state in words and marks the days with no low-water window", () => {
    const { container } = render(
      <SignalsView
        data={data}
        gates={toReferences(EXAMPLE_COASTAL_GATE)}
        locale="en"
        t={translator(en.signals)}
      />,
    );
    const panel = container.querySelector("[data-signal-gate-mouth='pattani_river']")!;
    expect(panel.getAttribute("data-signal-gate")).toBe("shut");
    expect(panel.querySelector("[data-gate-state]")!.textContent).toBe(
      en.signals.gate.state.shut,
    );
    expect(panel.querySelectorAll("[data-gate-day='shut']").length).toBeGreaterThanOrEqual(2);
    // Never an alert badge and never a level: the sea cannot raise anything (safety rule 2).
    expect(panel.textContent).not.toContain(en.signals.level.evacuate);
    expect(panel.textContent).toContain("0.94");
  });

  it("names the mouth that has no warning zone", () => {
    const { container } = render(
      <SignalsView
        data={data}
        gates={toReferences(EXAMPLE_COASTAL_GATE)}
        locale="en"
        t={translator(en.signals)}
      />,
    );
    const note = container.querySelector("[data-signal-gate-nozone]")!;
    expect(note.textContent).toContain("Bang Nara River mouth");
    expect(note.textContent).toContain("Mueang Narathiwat");
  });

  it("says nothing is known when no reference has been loaded", () => {
    const { container } = render(
      <SignalsView data={data} locale="en" t={translator(en.signals)} />,
    );
    expect(container.querySelector("[data-signal-gate]")).toBeNull();
    expect(container.querySelector("[data-signal-gate-nozone]")).toBeNull();
    expect(container.textContent).toContain(en.signals.gate.none);
  });

  it("has every word it needs in all three languages", () => {
    for (const messages of [th.signals, ms.signals, en.signals]) {
      const { container } = render(
        <SignalsView
          data={data}
          gates={toReferences(EXAMPLE_COASTAL_GATE)}
          locale="en"
          t={translator(messages)}
        />,
      );
      expect(container.querySelector("[data-signal-gate='shut']")).not.toBeNull();
      expect(container.querySelector("[data-signal-gate-nozone]")).not.toBeNull();
    }
  });
});
