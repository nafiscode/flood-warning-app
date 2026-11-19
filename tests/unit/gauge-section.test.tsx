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

describe("the picture says where the river stands, and stations can be compared", () => {
  /*
   * The owner, 19 Nov 2026: stepping from one gauge to the next, "the animated cross sections looks
   * the same, just numbering under it changes". The first scale took the reading into its span, so
   * every station's water came out at the same height. The frame is the station's levels now.
   */
  const LOW = { watch: 3.2, warning: 4.1, evacuate: 4.8, bank: 4.8, value: 3.3 };
  const HIGH = { ...LOW, value: 4.7 };
  // Another station entirely - a river mouth, metres lower - standing where LOW stands.
  const OTHER = { watch: 1.6, warning: 2.0, evacuate: 2.4, bank: 2.4, value: 1.7 };

  it("draws a river near its bank far higher than one just above its watch level", () => {
    const low = riverSection(LOW).surfaceY!;
    const high = riverSection(HIGH).surfaceY!;
    expect(low - high).toBeGreaterThan(40);
  });

  it("puts two stations standing alike at about the same height, whatever their metres", () => {
    expect(Math.abs(riverSection(OTHER).surfaceY! - riverSection(LOW).surfaceY!)).toBeLessThan(10);
    // ... and their lines land in the same places, which is what makes the two comparable.
    const lines = (s: ReturnType<typeof riverSection>) => s.lines.map((l) => l.y);
    const a = lines(riverSection(LOW));
    const b = lines(riverSection(OTHER));
    a.forEach((y, i) => expect(Math.abs(y - b[i]!)).toBeLessThan(10));
  });

  it("stretches only as far as it must to hold a reading outside the levels", () => {
    const over = riverSection({ ...LOW, value: 6.2 });
    expect(over.surfaceY).toBeGreaterThan(0);
    // Over the bank, and drawn over it: above the Evacuate line, not clamped onto it.
    expect(over.surfaceY).toBeLessThan(over.lines.at(-1)!.y - 2);
    expect(over.overBank).toBe(true);

    const under = riverSection({ ...OTHER, value: -0.4 });
    expect(under.surfaceY).toBeLessThan(under.yOf(under.bedMetres));
    expect(under.surfaceY).toBeGreaterThan(under.lines[0]!.y);
  });
});

describe("the channel, where the station's own figures give one", () => {
  /*
   * The owner, 19 Nov 2026: "if we have the river bed and bank width would be nice to make the
   * illustration of the cross section more realistic". The bed and the two bank heights are
   * ThaiWater's own record and the width is measured across OpenStreetMap's water
   * (pipeline/gauge_section). What is drawn must follow them, and what is missing must stay
   * missing rather than being filled in with something plausible.
   */
  const REAL = { ...GAUGE, bed: 1.9, leftBank: 4.8, rightBank: 5.62, channelWidth: 55 };

  it("puts the bed where the station says it is, and measures the depth from the lower bank", () => {
    const s = riverSection(REAL);
    expect(s.bed).not.toBeNull();
    expect(s.bed!.metres).toBe(1.9);
    expect(s.bed!.cut).toBe(false);
    expect(s.depth).toBe(2.9);
    // The bed is the bottom of the drawing, and the water stands above it.
    expect(s.surfaceY).toBeLessThan(s.bed!.y);
  });

  it("stands each bank at its own height, so the lower one is the one the river leaves first", () => {
    const s = riverSection(REAL);
    expect(s.leftY).toBeGreaterThan(s.rightY);
    expect(s.bankMetres).toBe(4.8);
    // The ground is drawn with two different tops: it starts at the left bank's height and ends
    // at the right's. Water may then stand over the lower side while the higher one still holds,
    // which is why the clip has three shapes - the channel and one side each.
    expect(s.groundPath.startsWith(`M0 ${s.leftY}`)).toBe(true);
    expect(s.groundPath).toContain(`L ${SECTION_W} ${s.rightY}`);
    expect(s.channelPath.split("M").length - 1).toBe(3);
  });

  it("draws a narrow river narrow and a wide one wide", () => {
    const narrow = riverSection({ ...REAL, channelWidth: 12 });
    const wide = riverSection({ ...REAL, channelWidth: 220 });
    expect(wide.channel.bankR - wide.channel.bankL).toBeGreaterThan(
      narrow.channel.bankR - narrow.channel.bankL + 40,
    );
    // Without a measured width the channel keeps its middling default, never a guess.
    const unknown = riverSection({ ...REAL, channelWidth: null });
    expect(unknown.width).toBeNull();
    expect(unknown.channel.bankR - unknown.channel.bankL).toBe(248);
  });

  it("cuts the drawing rather than squeezing the levels when the channel is very deep", () => {
    // X.90 on jaga-dev: a bed 12 m below a bank whose three levels sit within a metre of it.
    const deep = riverSection({ ...REAL, bed: -8.5 });
    expect(deep.bed!.cut).toBe(true);
    expect(deep.bed!.metres).toBe(-8.5);
    // The three lines keep their room: Watch is still well inside the drawing.
    expect(deep.lines[0]!.y).toBeLessThan(SECTION_H * 0.75);
    expect(riverSection(REAL).bed!.cut).toBe(false);
  });

  it("says nothing about a channel it has no figures for", () => {
    const s = riverSection(GAUGE);
    expect(s.bed).toBeNull();
    expect(s.depth).toBeNull();
    expect(s.width).toBeNull();
    expect(s.leftMetres).toBeNull();
    expect(s.rightMetres).toBeNull();
  });

  it("names the channel's figures, and says where they came from", () => {
    const { container } = renderWithIntl(<GaugeSection gauge={REAL} />, "en");
    expect(container.textContent).toContain("Left bank");
    expect(container.textContent).toContain("Right bank");
    expect(container.textContent).toContain("River bed");
    expect(container.textContent).toContain("1.90 m MSL");
    expect(container.textContent).toContain("2.90 m below the bank");
    expect(container.textContent).toContain("about 55 m");
    // The measured channel says where its figures came from; it is not called a survey.
    expect(container.textContent).toMatch(/ThaiWater's station record/);
    expect(container.textContent).toMatch(/OpenStreetMap/);
    expect(container.textContent).toMatch(/not a survey/);
    // Both banks are marked on the drawing, each on its own side.
    expect(container.querySelectorAll("[data-section-bank-mark]").length).toBe(2);
    expect(container.querySelector("[data-section-bed]")?.getAttribute("data-section-bed")).toBe(
      "1.90",
    );
  });

  it("keeps the plain 'this shape is a drawing' for a station with no channel figures", () => {
    const { container } = renderWithIntl(<GaugeSection gauge={GAUGE} />, "en");
    expect(container.textContent).toMatch(/not a survey/);
    expect(container.textContent).not.toMatch(/ThaiWater's station record/);
    expect(container.querySelectorAll("[data-section-bank-mark]").length).toBe(1);
    expect(container.querySelector("[data-section-bed]")).toBeNull();
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
    // The bank is named last, and on this station it is the Evacuate level under another name.
    expect(find(container as HTMLElement, "data-section-level")).toEqual([
      "evacuate",
      "warning",
      "watch",
      "bank",
    ]);
    expect(container.textContent).toContain("the same as the Evacuate level");
    // Its height is on the drawing too, at the top of the ground (the owner, 19 Nov).
    expect(container.querySelector("[data-section-bank]")?.getAttribute("data-section-bank")).toBe(
      "4.80",
    );
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
