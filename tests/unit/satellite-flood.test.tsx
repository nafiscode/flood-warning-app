import { fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import { SatelliteFloodPanel } from "@/components/map/SatelliteFlood";
import { alert, brand } from "@/lib/brand/tokens";
import { HAZARD_CLASSES } from "@/lib/hazard-layer";
import { SATELLITE_SPAN, satelliteBox } from "@/lib/map-focus";
import {
  SATELLITE_COLOR,
  SATELLITE_COLOR_NIGHT,
  SATELLITE_MAX_CELLS,
  isSatelliteWindow,
  passDays,
  satelliteEdge,
  satelliteFrame,
  satelliteLayer,
  satelliteState,
  slimCell,
  toSatelliteFlood,
  type SatelliteFlood,
} from "@/lib/satellite-flood";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";

const hexagon = (fileName: string, area = 17906.13) => ({
  type: "Feature",
  id: "x",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [101.2500012345, 6.8700098765],
        [101.2512345678, 6.8712345678],
        [101.2500012345, 6.8700098765],
      ],
    ],
  },
  properties: {
    f_area: area,
    file_name: fileName,
    population: 12,
    tb_tn: "ต.สะเตง",
    _createdBy: "66b07c8034c2963abcdb9bb8",
  },
});

describe("GISTDA's recent flood, as Jaga passes it on", () => {
  it("offers 3, 7 and 30 days and nothing else", () => {
    expect([3, 7, 30, "7"].map(isSatelliteWindow)).toEqual([true, true, true, true]);
    expect([1, 0, "x", null, 14].map(isSatelliteWindow)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(satelliteLayer(3)).toBe("flood/3days");
  });

  it("reads the days of the passes out of the file names, and only real dates", () => {
    expect(passDays("S1D_20261011_1812, cm2_20261007_0603, S1C_20261011_0550")).toEqual([
      "2026-10-11",
      "2026-10-07",
    ]);
    expect(passDays("LS8_20261340_553331")).toEqual([]);
    expect(passDays(undefined)).toEqual([]);
  });

  it("keeps the shape and the water's area, and nothing else of theirs", () => {
    const cell = slimCell(hexagon("S1D_20261011_1812"))!;
    expect(cell.properties).toEqual({ m2: 17906 });
    expect((cell.geometry.coordinates as number[][][])[0]![0]).toEqual([101.25, 6.87001]);
    expect(JSON.stringify(cell)).not.toMatch(/population|tb_tn|_createdBy|file_name/);
    expect(slimCell({ geometry: { type: "Point", coordinates: [1, 2] } })).toBeNull();
    expect(slimCell(null)).toBeNull();
  });

  it("adds the provinces up, newest pass first, and never carries a key that came back in the answer", () => {
    const raw = [hexagon("S1D_20261009_0559"), hexagon("S1D_20261011_1812", 12000), { junk: true }];
    const flood = toSatelliteFlood(raw, 7, "2026-10-13T11:00:00.000Z");
    expect(flood).toMatchObject({ days: 7, cells: 2, km2: 0.03, truncated: false });
    expect(flood.passDays).toEqual(["2026-10-11", "2026-10-09"]);
    const withLinks = { ...hexagon("S1D_20261009_0559"), links: [{ href: "?api_key=SECRET" }] };
    expect(JSON.stringify(toSatelliteFlood([withLinks], 7, "x"))).not.toContain("SECRET");
  });

  it("says so when there is more than it sends", () => {
    const many = Array.from({ length: SATELLITE_MAX_CELLS + 5 }, () =>
      hexagon("S1D_20261011_1812"),
    );
    const flood = toSatelliteFlood(many, 30, "x");
    expect(flood.cells).toBe(SATELLITE_MAX_CELLS);
    expect(flood.truncated).toBe(true);
    expect(toSatelliteFlood([], 30, "x", true).truncated).toBe(true);
  });

  it("an answer for another window, or none at all, is never read as 'no flood'", () => {
    const empty = toSatelliteFlood([], 7, "x");
    expect(satelliteState(null, "ok", empty)).toBe("off");
    expect(satelliteState(7, "loading", null)).toBe("loading");
    expect(satelliteState(7, "unavailable", null)).toBe("unavailable");
    expect(satelliteState(7, "ok", null)).toBe("unavailable");
    expect(satelliteState(30, "ok", empty)).toBe("unavailable");
    expect(satelliteState(7, "ok", empty)).toBe("none");
    expect(satelliteState(7, "ok", toSatelliteFlood([hexagon("S1D_20261011_1812")], 7, "x"))).toBe(
      "some",
    );
  });

  it("is drawn in a violet that is no alert level, no hazard class and no brand colour", () => {
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const far = (a: string, b: string) => Math.hypot(...rgb(a).map((v, i) => v - rgb(b)[i]!)) > 90;
    const light = (hex: string) => {
      const [r, g, b] = rgb(hex);
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    for (const [color, night] of [
      [SATELLITE_COLOR, false],
      [SATELLITE_COLOR_NIGHT, true],
    ] as const) {
      // Violet: blue over red over green, as it has been since 13 Oct.
      const [r, g, b] = rgb(color);
      expect(b).toBeGreaterThan(r! + 20);
      expect(r).toBeGreaterThan(g! + 40);
      for (const level of Object.values(alert)) expect(far(color, level.bg)).toBe(true);
      // against the hazard shades the same map would be showing (a pink ramp)
      for (const c of HAZARD_CLASSES) expect(far(color, night ? c.night : c.color)).toBe(true);
      // ...and against the brand, which never shows a status (docs/brand.md)
      for (const c of [brand["jaga-slate"], brand["jaga-teal"], brand["jaga-teal-light"]]) {
        expect(far(color, c)).toBe(true);
      }
      /*
       * Bright enough to be found (the owner, 20 Oct 2026). The deep violet of the first build
       * was lost on the satellite picture by day and on the dark map at night; the night shade
       * has to be lighter still, because the ground it is drawn on is almost black.
       */
      expect(light(color)).toBeGreaterThan(night ? 135 : 95);
      // The edge runs the other way: dark against the day's picture, pale against the night map.
      expect(light(satelliteEdge(night))).toBeLessThan(night ? 255 : 60);
      expect(Math.abs(light(satelliteEdge(night)) - light(color))).toBeGreaterThan(50);
    }
  });

  it("frames every hexagon, however deeply the shapes are nested", () => {
    const cells = [
      slimCell(hexagon("S1D_20261011_1812"))!,
      {
        type: "Feature" as const,
        geometry: {
          type: "MultiPolygon" as const,
          coordinates: [[[[100.5, 6.1], [100.6, 6.2], [100.5, 6.1]]]],
        },
        properties: { m2: 1 },
      },
    ];
    expect(satelliteFrame(cells)).toEqual([
      { lon: 100.5, lat: 6.1 },
      { lon: 101.25123, lat: 6.87123 },
    ]);
    expect(satelliteFrame([])).toEqual([]);
    expect(satelliteFrame(null)).toEqual([]);
    expect(satelliteBox(null)).toBeUndefined();
  });

  it("gives one hexagon a neighbourhood rather than a rooftop, and a flood its own size", () => {
    const one = satelliteBox([slimCell(hexagon("S1D_20261011_1812"))!])!;
    expect(one[2] - one[0]).toBeGreaterThan(SATELLITE_SPAN.lon);
    expect(one[3] - one[1]).toBeGreaterThan(SATELLITE_SPAN.lat);
    // ...and the middle of that box is still the hexagon itself.
    expect((one[0] + one[2]) / 2).toBeCloseTo(101.25062, 3);
    const wide = satelliteBox([
      {
        type: "Feature" as const,
        geometry: {
          type: "Polygon" as const,
          coordinates: [[[100.2, 6.0], [102.0, 7.8], [100.2, 6.0]]],
        },
        properties: { m2: 1 },
      },
    ])!;
    expect(wide[2] - wide[0]).toBeGreaterThan(1.8);
  });
});

describe("the switch and what it says", () => {
  const some: SatelliteFlood = toSatelliteFlood(
    [hexagon("S1D_20261011_1812", 1_250_000)],
    7,
    "2026-10-13T04:00:00.000Z",
  );
  const panel = (
    props: Partial<Parameters<typeof SatelliteFloodPanel>[0]>,
    messages = en,
    locale = "en",
  ) =>
    render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Bangkok">
        <SatelliteFloodPanel
          days={7}
          onDays={() => {}}
          flood={null}
          load="loading"
          dark={false}
          {...props}
        />
      </NextIntlClientProvider>,
    );

  it("is off until asked for, and turns on at seven days", () => {
    const onDays = vi.fn();
    const { container } = panel({ days: null, onDays });
    expect(container.querySelector("[data-satellite]")!.getAttribute("data-satellite")).toBe("off");
    expect(container.querySelector("[data-satellite-status]")).toBeNull();
    fireEvent.click(container.querySelector("[data-satellite-toggle] input")!);
    expect(onDays).toHaveBeenCalledWith(7);
  });

  it("offers the three windows and can be switched off again", () => {
    const onDays = vi.fn();
    const { container } = panel({ onDays, load: "ok", flood: some });
    fireEvent.click(container.querySelector('[data-satellite-days="30"]')!);
    expect(onDays).toHaveBeenLastCalledWith(30);
    expect(container.querySelector('[data-satellite-days="7"]')!.getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.click(container.querySelector("[data-satellite-toggle] input")!);
    expect(onDays).toHaveBeenLastCalledWith(null);
  });

  it("closes from under its own detail, and the close button is only there while it is on", () => {
    const onDays = vi.fn();
    const { container } = panel({ onDays, load: "ok", flood: some });
    const close = container.querySelector("[data-satellite-close]")!;
    // After the detail, which is what the reader has just read.
    const status = container.querySelector("[data-satellite-status]")!;
    expect(status.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(close);
    expect(onDays).toHaveBeenLastCalledWith(null);
    expect(panel({ days: null, onDays }).container.querySelector("[data-satellite-close]")).toBeNull();
  });

  it("with flood: the area, the day of the latest image, when Jaga asked, and that it is no warning", () => {
    const { container } = panel({ load: "ok", flood: some });
    const text = container.querySelector("[data-satellite-status]")!.textContent!;
    expect(text).toContain("about 1.3 km²");
    expect(text).toContain("Oct 11");
    expect(text).toContain("Oct 13");
    expect(text).toContain("11:00");
    expect(text).toContain("This is not a warning");
    expect(text).toContain("GISTDA");
  });

  it("with none: says it is not an all-clear, in all three languages", () => {
    const none = toSatelliteFlood([], 7, "2026-10-13T04:00:00.000Z");
    for (const [messages, locale, words] of [
      [en, "en", "not an all-clear"],
      [th, "th", "ไม่ได้แปลว่าปลอดภัย"],
      [ms, "ms", "bukan bermakna selamat"],
    ] as const) {
      const { container, unmount } = panel(
        { load: "ok", flood: none },
        messages as typeof en,
        locale,
      );
      const status = container.querySelector('[data-satellite-status="none"]')!;
      expect(status.textContent).toContain(words);
      expect(status.textContent).not.toMatch(/map\.satellite|\{days\}/);
      unmount();
    }
  });

  it("when GISTDA cannot be reached: says that this tells nothing about flooding", () => {
    const { container } = panel({ load: "unavailable" });
    const status = container.querySelector('[data-satellite-status="unavailable"]')!;
    expect(status.textContent).toContain("says nothing about whether there is flooding");
    expect(status.textContent).not.toContain("no satellite pass saw");
  });
});
