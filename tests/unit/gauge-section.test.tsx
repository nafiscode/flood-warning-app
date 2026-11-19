import { describe, expect, it } from "vitest";
import { GaugeSection } from "@/components/map/GaugeSection";
import {
  hasSection,
  riverSection,
  SECTION_H,
  SECTION_W,
  wavePath,
  WAVE_BANDS,
} from "@/lib/gauge-section";
import type { Gauge } from "@/lib/map-data";
import { renderWithIntl } from "./render";

/*
 * The cross-section in a river gauge's details card (the owner, 19 Nov 2026). Two things are being
 * kept honest here: every figure a station has must be inside the frame, because a line that fell
 * off the top would read as "not reached"; and a station that has gone quiet must not be drawn
 * with water standing in it.
 */

const GAUGE: Gauge = {
  id: "g1",
  name: { th: "สถานีตัวอย่าง", en: "Example gauge" },
  lat: 6.8,
  lon: 101.2,
  value: 3.42,
  observedAt: "2026-11-19T09:00:00Z",
  status: "above_watch",
  watch: 3.2,
  warning: 4.1,
  evacuate: 4.8,
  bank: 4.8,
  provisionalLevels: true,
};

describe("the vertical scale", () => {
  it("holds every figure the station has, inside the frame", () => {
    const s = riverSection(GAUGE);
    for (const y of [s.surfaceY!, s.bankY, ...s.lines.map((l) => l.y)]) {
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(SECTION_H);
    }
    // Higher metres are further up the drawing.
    expect(s.yOf(4.8)).toBeLessThan(s.yOf(3.2));
    expect(s.bedMetres).toBeLessThan(3.2);
    expect(s.top).toBeGreaterThan(4.8);
  });

  it("still holds a reading far above every level", () => {
    const s = riverSection({ ...GAUGE, value: 9.1 });
    expect(s.surfaceY).toBeGreaterThan(0);
    expect(s.surfaceY).toBeLessThan(s.lines[0]!.y);
    expect(s.top).toBeGreaterThan(9.1);
  });

  it("orders the lines lowest first, and knows when the water is over the bank", () => {
    const s = riverSection(GAUGE);
    expect(s.lines.map((l) => l.key)).toEqual(["watch", "warning", "evacuate"]);
    expect(s.overBank).toBe(false);
    expect(riverSection({ ...GAUGE, value: 4.9 }).overBank).toBe(true);
    expect(riverSection({ ...GAUGE, value: 4.8 }).overBank).toBe(true);
  });

  it("takes Evacuate as the bank when the station has no bank of its own", () => {
    const s = riverSection({ ...GAUGE, bank: null });
    expect(s.bankMetres).toBe(4.8);
    expect(riverSection({ ...GAUGE, bank: null, evacuate: null }).bankMetres).toBeNull();
  });

  it("draws no water, and no rise, without a reading", () => {
    const s = riverSection({ ...GAUGE, value: null });
    expect(s.surfaceY).toBeNull();
    expect(s.riseFrom).toBe(0);
    expect(s.lines).toHaveLength(3);
  });

  it("is left out altogether when there is nothing at all to draw", () => {
    expect(hasSection({ value: null })).toBe(false);
    expect(hasSection({ value: null, watch: 1.2 })).toBe(true);
    expect(hasSection({ value: 0 })).toBe(true);
  });
});

describe("the water surface", () => {
  it("runs wider than the drawing and closes, so the drift shows no seam", () => {
    const d = wavePath(170, 2.6);
    expect(d.startsWith(`M${-SECTION_W} `)).toBe(true);
    expect(d.trimEnd().endsWith("Z")).toBe(true);
    expect(d).toContain(`L${SECTION_W * 2} `);
  });

  it("has every band's length divide the drawing, which is what makes the loop seamless", () => {
    for (const band of WAVE_BANDS) {
      const periods = SECTION_W / band.length;
      expect(Math.abs(periods - Math.round(periods))).toBeLessThan(0.01);
    }
  });
});

describe("the details card", () => {
  const find = (root: HTMLElement, attr: string) =>
    [...root.querySelectorAll(`[${attr}]`)].map((n) => n.getAttribute(attr));

  it("draws the three levels, names each one and prints its metres", () => {
    const { container, getByText } = renderWithIntl(<GaugeSection gauge={GAUGE} />, "en");
    expect(find(container as HTMLElement, "data-section-line")).toEqual([
      "watch",
      "warning",
      "evacuate",
    ]);
    expect(find(container as HTMLElement, "data-section-level")).toEqual([
      "evacuate",
      "warning",
      "watch",
    ]);
    getByText("Watch");
    getByText("Warning");
    getByText("Evacuate");
    expect(container.textContent).toContain("4.80 m MSL");
    // How far the river has to go to each level, from the reading.
    expect(container.textContent).toContain("0.68 m to go");
    // The drawing is never passed off as a survey, and provisional levels say so.
    expect(container.textContent).toMatch(/not a survey/i);
    expect(container.textContent).toMatch(/Provisional levels/i);
  });

  it("marks a level the river has reached", () => {
    const { container } = renderWithIntl(<GaugeSection gauge={{ ...GAUGE, value: 4.2 }} />, "en");
    expect(find(container as HTMLElement, "data-section-gap")).toEqual([
      "below",
      "reached",
      "reached",
    ]);
  });

  it("draws the water live, and a quiet station's last reading as a grey line instead", () => {
    const live = renderWithIntl(<GaugeSection gauge={GAUGE} />, "en");
    expect(live.container.querySelector('[data-section-now="live"]')).not.toBeNull();

    const quiet = renderWithIntl(
      <GaugeSection gauge={{ ...GAUGE, status: "no_recent_data" }} />,
      "en",
    );
    expect(quiet.container.querySelector('[data-section-now="quiet"]')).not.toBeNull();
    expect(quiet.container.querySelector('[data-section-now="live"]')).toBeNull();
    expect(quiet.container.textContent).toMatch(/not the water now/i);
  });

  it("says so when the station has no levels, rather than drawing an empty frame", () => {
    const { container } = renderWithIntl(
      <GaugeSection
        gauge={{ ...GAUGE, watch: null, warning: null, evacuate: null, status: "no_levels" }}
      />,
      "en",
    );
    expect(find(container as HTMLElement, "data-section-line")).toEqual(["bank"]);
    expect(container.textContent).toMatch(/no reference levels/i);
  });

  it("works in Thai, the source language", () => {
    const { container } = renderWithIntl(<GaugeSection gauge={GAUGE} />, "th");
    expect(container.textContent).toContain("เฝ้าระวัง");
    expect(container.textContent).toContain("อพยพ");
    expect(container.textContent).toContain("ม.รทก.");
  });
});
