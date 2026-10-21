import { fireEvent } from "@testing-library/react";
import { useState } from "react";
import { withCoast } from "@/lib/sea";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardView, type DashboardViewProps } from "@/components/map/DashboardView";
import { ProvinceSelect } from "@/components/ProvinceSelect";
import { alert as alertColors_ } from "@/lib/brand/tokens";
import { MINE_COLORS, mineColor } from "@/lib/mine-colors";
import { mineLabel, minePlaceFeature } from "@/lib/mine-label";
import {
  BANA,
  EXAMPLE_DIRECTORY,
  EXAMPLE_HAZARDS,
  EXAMPLE_MAP,
  EXAMPLE_ME,
  EXAMPLE_NOW,
  exampleAlert,
  exampleDamDaily,
  exampleDamDays,
  exampleDamSignal,
  exampleStatus,
} from "@/lib/dev-examples";
import { damFrame, type Dam } from "@/lib/dam";
import { CONSOLE_QUERY } from "@/lib/console-view";
import { layersFor } from "@/lib/hazards";
import {
  boundsAround,
  MARGIN,
  MIN_SPAN,
  PROVINCE_BOUNDS,
  provincesBox,
  SERVICE_BOUNDS,
} from "@/lib/map";
import { RESERVOIR_SPAN, reservoirBox } from "@/lib/map-focus";
import type { SatelliteWindow } from "@/lib/satellite-flood";
import { alertFillColor, staleTambons } from "@/lib/map-style";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

// The real map needs WebGL; here it reports which layers and which of the person's own places
// it was asked to draw.
vi.mock("@/components/map/MapView", () => ({
  MapView: ({
    layers,
    mine = [],
    showMine = false,
    onSelect,
    bounds,
    basemap = "streets",
    showDam = true,
    showDamZone = true,
    satellite = null,
    flashSatellite = 0,
    flashDam = null,
    onView,
  }: {
    flashDam?: { kind: string; codes: string[] } | null;
    satellite?: { properties: { m2: number } }[] | null;
    flashSatellite?: number;
    onView?: (box: [number, number, number, number]) => void;
    basemap?: string;
    showDam?: boolean;
    showDamZone?: boolean;
    onSelect?: (s: { kind: "mine"; id: string }) => void;
    bounds?: [number, number, number, number];
    layers: string[];
    mine?: {
      id: string;
      label: string;
      home: boolean;
      color: string;
      lines: string[];
      call: { tel: string; label: string } | null;
    }[];
    showMine?: boolean;
  }) => (
    <div
      data-map="true"
      data-basemap={basemap}
      data-mine={showMine ? mine.map((p) => p.id).join(",") : ""}
      data-mine-count={mine.length}
      data-mine-colors={mine.map((p) => p.color).join(",")}
      data-mine-labels={mine.map((p) => [p.label, ...p.lines].join(" | ")).join(" / ")}
      data-mine-calls={mine.map((p) => `${p.id}:${p.call ? p.call.tel : "-"}`).join(",")}
      data-bounds={bounds ? bounds.map((n) => n.toFixed(2)).join(",") : ""}
      data-show-dam={showDam ? "1" : "0"}
      data-show-zone={showDamZone ? "1" : "0"}
      data-satellite-cells={satellite ? satellite.length : 0}
      data-flash-satellite={flashSatellite}
      data-flash-kind={flashDam?.kind ?? ""}
      data-flash-codes={(flashDam?.codes ?? []).join(",")}
    >
      {/* Stands in for the reader panning the map, which the real one reports on moveend. */}
      <button
        type="button"
        data-panned="true"
        onClick={() => onView?.([100.1, 6.1, 100.3, 6.3])}
      />
      {layers.join(",")}
      {/* Stands in for tapping the first pin, which the real map answers with onSelect. */}
      {mine[0] && (
        <button
          type="button"
          data-select-mine="true"
          onClick={() => onSelect?.({ kind: "mine", id: mine[0]!.id })}
        />
      )}
    </div>
  ),
}));

/** The least a dam needs to be drawn and opened: the geometry is the real one in the app. */
const EXAMPLE_DAM: Dam = {
  code: "bang_lang",
  name: { th: "เขื่อนบางลาง", en: "Bang Lang Dam" },
  river: { th: "แม่น้ำปัตตานี", en: "Pattani River" },
  operator: "EGAT",
  feed: "hourly" as const,
  point: { type: "Point", coordinates: [101.2721, 6.1551] },
  spillwayPoint: null,
  outletPoint: null,
  reservoir: null,
  storageMaxMcm: 1589.8,
  storageNormalMcm: 1454.4,
  geometrySource: "osm",
  geometryNote: { source: "osm" },
  reaches: [],
  tambons: [],
  signal: exampleDamSignal("watch"),
  daily: exampleDamDaily("watch"),
  days: exampleDamDays("watch"),
  arrivals: [],
};

function dashboard(more: Partial<DashboardViewProps> = {}) {
  return renderWithIntl(
    <DashboardView
      status={exampleStatus([exampleAlert("warning", [BANA.code])])}
      checkedAt={EXAMPLE_NOW - 60_000}
      failed={false}
      hazards={EXAMPLE_HAZARDS}
      hazardsState="ok"
      directory={EXAMPLE_DIRECTORY}
      directoryState="ok"
      data={EXAMPLE_MAP}
      dataState="ok"
      now={EXAMPLE_NOW}
      transparency={false}
      {...more}
    />,
  ).container;
}

const green = /47, ?122, ?37/; // --alert-normal as rgb

/*
 * The dam's card opened only by tapping the dam itself, which on a phone at the four-province
 * view is a mark a few pixels across: measured on the live map, 2 taps in 361 found it, and the
 * owner could not find it at all. The legend names the dam, so the legend opens it.
 */
/*
 * Opening the dam's figures also frames the map on the dam and the places this person saved
 * (the owner, 12 Oct), so the distance between them is something they can see rather than work
 * out. The box is the pure part; MapView already flies to whatever `bounds` it is given.
 */
describe("the view that opening the dam asks for", () => {
  const DAM_POINT = { lon: 101.2721, lat: 6.1551 };

  it("holds every point it is given", () => {
    const box = boundsAround([DAM_POINT, { lon: 101.25, lat: 6.87 }])!;
    const [west, south, east, north] = box;
    expect(west).toBeLessThanOrEqual(101.25);
    expect(east).toBeGreaterThanOrEqual(101.2721);
    expect(south).toBeLessThanOrEqual(6.1551);
    expect(north).toBeGreaterThanOrEqual(6.87);
  });

  /*
   * A dam with nobody's places beside it is one point, and a box around one point is a rooftop.
   * The reader needs the country around it to see where it is.
   */
  it("a single point still gets a neighbourhood around it", () => {
    const [west, south, east, north] = boundsAround([DAM_POINT])!;
    // The floor, plus the margin that keeps a pin off the edge of the screen.
    expect(east - west).toBeCloseTo(MIN_SPAN.lon * (1 + 2 * MARGIN), 6);
    expect(north - south).toBeCloseTo(MIN_SPAN.lat * (1 + 2 * MARGIN), 6);
    // Centred on the point, not hanging off one side of it.
    expect((west + east) / 2).toBeCloseTo(DAM_POINT.lon, 6);
    expect((south + north) / 2).toBeCloseTo(DAM_POINT.lat, 6);
  });

  it("ignores a place with no usable position, and asks for nothing when there is none", () => {
    const box = boundsAround([DAM_POINT, { lon: 0, lat: 0 }, { lon: NaN, lat: 6 }])!;
    expect(box[0]).toBeGreaterThan(100);
    expect(boundsAround([])).toBeUndefined();
    expect(boundsAround([{ lon: 0, lat: 0 }])).toBeUndefined();
  });

  /*
   * The owner, 18 Oct 2026: the button takes the map to the **reservoir**, in the middle of the
   * frame and closer than the dam's own view. This supersedes the view of 12 Oct, which held the
   * dam, its outlets and the person's own places together - that one is a step out from this.
   */
  it("the button hands the map the reservoir, in the middle and close", () => {
    const c = dashboard({ dams: [EXAMPLE_DAM], me: EXAMPLE_ME });
    const before = c.querySelector("[data-map]")!.getAttribute("data-bounds");
    fireEvent.click(c.querySelector(`[data-open-dam="${EXAMPLE_DAM.code}"]`)!);
    const after = c.querySelector("[data-map]")!.getAttribute("data-bounds")!;
    expect(after).not.toBe(before);
    const [west, south, east, north] = after.split(",").map(Number);
    const asked = reservoirBox(EXAMPLE_DAM)!;
    // The mock rounds the box to two decimals, about a kilometre, hence the slack.
    const slack = 0.011;
    for (const [got, want] of [
      [west!, asked[0]],
      [south!, asked[1]],
      [east!, asked[2]],
      [north!, asked[3]],
    ] as const) {
      expect(Math.abs(got - want)).toBeLessThanOrEqual(slack);
    }
    // Closer than the view that also had to hold this person's saved places.
    const saved = (EXAMPLE_ME.signedIn ? EXAMPLE_ME.places : [])
      .filter((place) => place.area)
      .map((place) => ({ lon: place.area!.lon, lat: place.area!.lat }));
    const wide = boundsAround([...damFrame(EXAMPLE_DAM), ...saved])!;
    expect(east! - west!).toBeLessThan(wide[2] - wide[0]);
  });

  /*
   * Framing the dam's point alone cut the reservoir off the bottom of the screen (seen in a
   * browser). The lake is what makes the view read as a dam.
   */
  it("the frame holds the reservoir, not only the dam's point", () => {
    const withLake = {
      ...EXAMPLE_DAM,
      reservoir: {
        type: "MultiPolygon" as const,
        coordinates: [
          [
            [
              [101.2, 5.95],
              [101.35, 5.95],
              [101.35, 6.15],
              [101.2, 6.15],
              [101.2, 5.95],
            ],
          ],
        ],
      },
    };
    const points = damFrame(withLake);
    expect(points.length).toBeGreaterThan(1);
    const [west, south, east, north] = boundsAround(points)!;
    expect(south).toBeLessThanOrEqual(5.95);
    expect(north).toBeGreaterThanOrEqual(6.1551);
    expect(west).toBeLessThanOrEqual(101.2);
    expect(east).toBeGreaterThanOrEqual(101.35);
  });

  /*
   * Bang Lang's lake comes back from PostGIS as a **Polygon** with 13 holes, not a MultiPolygon.
   * The frame walked it one level too deep and threw in the browser ("`.for` is not iterable"),
   * which is why the walk is depth-blind now.
   */
  it("reads the lake whether it is a Polygon or a MultiPolygon", () => {
    const ring = [
      [101.2, 5.95],
      [101.35, 5.95],
      [101.35, 6.15],
      [101.2, 6.15],
      [101.2, 5.95],
    ];
    const asPolygon = damFrame({
      ...EXAMPLE_DAM,
      reservoir: { type: "Polygon", coordinates: [ring] },
    });
    const asMulti = damFrame({
      ...EXAMPLE_DAM,
      reservoir: { type: "MultiPolygon", coordinates: [[ring]] },
    });
    expect(boundsAround(asPolygon)).toEqual(boundsAround(asMulti));
    expect(boundsAround(asPolygon)![1]).toBeLessThanOrEqual(5.95);
  });

  it("asks for the same view whether or not the person has saved anywhere", () => {
    const alone = dashboard({ dams: [EXAMPLE_DAM] });
    fireEvent.click(alone.querySelector(`[data-open-dam="${EXAMPLE_DAM.code}"]`)!);
    const box = alone.querySelector("[data-map]")!.getAttribute("data-bounds")!;
    const [west, south, east, north] = box.split(",").map(Number);
    // The reservoir's own floor, not the map's wider one.
    expect(east! - west!).toBeLessThan(MIN_SPAN.lon);
    expect(north! - south!).toBeLessThan(MIN_SPAN.lat);
    expect(east! - west!).toBeGreaterThanOrEqual(RESERVOIR_SPAN.lon);
  });
});

describe("the dam's card can be opened without hitting a two-pixel mark", () => {
  it("the legend has a button that opens it, and the card carries the charts", () => {
    const c = dashboard({ dams: [EXAMPLE_DAM] });
    const open = c.querySelector(`[data-open-dam="${EXAMPLE_DAM.code}"]`) as HTMLButtonElement;
    expect(open).not.toBeNull();
    // A button to look at and aim for, not an underlined line of text (the owner, 12 Oct).
    expect(open.tagName).toBe("BUTTON");
    expect(open.className).toContain("border");
    expect(open.className).toContain("min-h-tap");
    expect(open.className).not.toContain("underline");
    expect(open.querySelector("svg")).toBeTruthy();
    /*
     * A tint of the brand teal, and an answer to the pointer on a laptop (the owner, 12 Oct).
     * Tailwind puts `hover:` behind `@media (hover: hover)`, so a phone never keeps the colour
     * after a tap - checked in the compiled stylesheet, which is where that media query lives.
     */
    expect(open.className).toContain("bg-jaga-teal-ink/10");
    expect(open.className).toContain("hover:bg-jaga-teal-ink/20");
    // The label is the brand ink: teal text on its own tint falls to 3.89:1 once the pointer
    // deepens it, under the 4.5 body text needs.
    expect(open.className).toContain("text-jaga-ink");
    expect(open.className).not.toContain("text-jaga-teal-ink");
    expect(c.querySelector("[data-selected='dam']")).toBeNull();
    fireEvent.click(open);
    const card = c.querySelector("[data-selected='dam']")!;
    expect(card).not.toBeNull();
    expect(card.querySelector("[data-dam-history]")).not.toBeNull();
  });

  it("takes the page to the card it opens, and the card can take the keyboard", () => {
    /*
     * The card opens under the map, above the legend, so on a laptop the button in the legend
     * opened it off the top of the screen and nothing seemed to happen (the owner, 14 Oct). The
     * page goes to it, the panel is given the keyboard, and it rings for a moment so the eye
     * lands on it.
     *
     * This is the laptop's answer, so the laptop is what the width says here: on a phone the
     * card is under a map that has made room for it, and the test below holds that case.
     */
    const was = window.matchMedia;
    window.matchMedia = ((q: string) =>
      ({
        matches: q === CONSOLE_QUERY,
        media: q,
        addEventListener() {},
        removeEventListener() {},
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
    const asked: { top?: number }[] = [];
    const had = Object.getOwnPropertyDescriptor(window, "scrollTo");
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: (to: { top?: number }) => asked.push(to),
    });
    vi.useFakeTimers();
    try {
      const c = dashboard({ dams: [EXAMPLE_DAM] });
      fireEvent.click(c.querySelector(`[data-open-dam="${EXAMPLE_DAM.code}"]`)!);
      const panel = c.querySelector("[data-selected-panel]") as HTMLElement;
      expect(panel).not.toBeNull();
      expect(panel.getAttribute("tabindex")).toBe("-1");
      vi.advanceTimersByTime(100);
      // The page is taken to the panel, and never to a negative offset.
      expect(asked).toHaveLength(1);
      expect(asked[0]!.top).toBeGreaterThanOrEqual(0);
      expect(panel.dataset.justOpened).toBe("true");
      // ...and it stops ringing by itself.
      vi.advanceTimersByTime(2_500);
      expect(panel.dataset.justOpened).toBeUndefined();
    } finally {
      vi.useRealTimers();
      window.matchMedia = was;
      if (had) Object.defineProperty(window, "scrollTo", had);
    }
  });

  it("on a phone the same press brings back the map, not the card under it", () => {
    /*
     * The owner's option C (20 Oct): the map is at the top of the page and gives up height for
     * what a tap answers with, so both are on the screen together. Bringing the *card* to the
     * top - what a laptop wants - would push the map off the screen to show a card that is
     * already on it. So the map is what is brought back, without a ring on it, and the card
     * still takes the keyboard so a screen reader is moved to the answer.
     */
    const asked: { top?: number }[] = [];
    const had = Object.getOwnPropertyDescriptor(window, "scrollTo");
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: (to: { top?: number }) => asked.push(to),
    });
    vi.useFakeTimers();
    try {
      const c = dashboard({ dams: [EXAMPLE_DAM] });
      fireEvent.click(c.querySelector(`[data-open-dam="${EXAMPLE_DAM.code}"]`)!);
      const panel = c.querySelector("[data-selected-panel]") as HTMLElement;
      const frame = c.querySelector("[data-map-frame]") as HTMLElement;
      vi.advanceTimersByTime(100);
      expect(asked).toHaveLength(1);
      expect(asked[0]!.top).toBeGreaterThanOrEqual(0);
      expect(panel.dataset.justOpened).toBeUndefined();
      expect(frame.dataset.justOpened).toBeUndefined();
      expect(document.activeElement).toBe(panel);
    } finally {
      vi.useRealTimers();
      if (had) Object.defineProperty(window, "scrollTo", had);
    }
  });

  it("says nothing about a dam when there is none on the map", () => {
    const c = dashboard();
    expect(c.querySelector("[data-open-dam]")).toBeNull();
  });
});

describe("a placeholder hazard never draws a layer or a normal state (safety rule 10)", () => {
  it("layersFor gives no layers for a hazard that is not active", () => {
    expect(layersFor({ status: "coming_soon" }, "risk")).toEqual([]);
    expect(layersFor({ status: "coming_soon" }, "live")).toEqual([]);
    expect(layersFor(null, "live")).toEqual([]);
    expect(layersFor({ status: "active" }, "live")).toContain("alerts");
  });

  it("choosing a coming-soon hazard removes the map and shows the card with SOS and its hotline", () => {
    const c = dashboard();
    expect(c.querySelector("[data-map]")).not.toBeNull();
    fireEvent.click(c.querySelector('[data-hazard="fire"]')!);
    expect(c.querySelector("[data-map]")).toBeNull();
    expect(c.querySelector("[data-level]")).toBeNull();
    expect(c.querySelector("[data-legend]")).toBeNull();
    expect(c.querySelector("[data-alerts-list]")).toBeNull();
    const card = c.querySelector('[data-hazard-placeholder="fire"]')!;
    expect(card.textContent).toContain("ไม่ได้แปลว่าไม่มีความเสี่ยง");
    expect(card.textContent).toContain(th.map.hazard.comingSoon);
    expect(card.querySelector('a[href="/sos"]')).not.toBeNull();
    expect(card.querySelector('a[href="tel:199"]')).not.toBeNull();
    expect(c.innerHTML).not.toMatch(/alert-normal/);
  });
});

describe("a coming-soon province never gets a normal state (safety rule 10)", () => {
  it("is listed disabled, with the note and the numbers to call", () => {
    const { container: c } = renderWithIntl(
      <ProvinceSelect
        id="p"
        provinces={EXAMPLE_DIRECTORY.provinces}
        value=""
        onChange={() => {}}
        emptyLabel="all"
      />,
    );
    const soon = [...c.querySelectorAll<HTMLOptionElement>("option[data-coming-soon]")];
    expect(soon.map((o) => o.value)).toEqual(["10"]);
    expect(soon.every((o) => o.disabled)).toBe(true);
    expect(c.querySelectorAll("option:not([disabled])")).toHaveLength(5);
    expect(c.querySelector("[data-not-covered-note]")?.textContent).toMatch(/1784.*1669/);
    expect(c.querySelector("[data-level]")).toBeNull();
    expect(c.innerHTML).not.toMatch(/alert-normal/);
  });
});

describe("tambon colors on the map", () => {
  it("before launch a tambon without an alert gets no color at all", () => {
    expect(alertFillColor(exampleStatus([], false))).toBe("rgba(0, 0, 0, 0)");
    expect(alertFillColor(null)).toBe("rgba(0, 0, 0, 0)");
    const withAlert = JSON.stringify(
      alertFillColor(exampleStatus([exampleAlert("evacuate", [BANA.code])], false)),
    );
    expect(withAlert).not.toMatch(green);
    expect(withAlert).toContain("198, 40, 40");
    expect(alertColors_.normal.bg).toBe("#2F7A25");
  });

  it("in service, a tambon without an alert is light green and one with an alert has its level's color", () => {
    const fill = alertFillColor(exampleStatus([exampleAlert("watch", [BANA.code])]));
    expect(JSON.stringify(fill)).toMatch(green);
    expect(JSON.stringify(fill)).toContain(BANA.code);
  });

  it("the newest alert wins for a tambon, and a late one is outlined, not recolored", () => {
    const late = exampleAlert("warning", [BANA.code], {
      nextUpdateAt: new Date(EXAMPLE_NOW - 60_000).toISOString(),
    });
    expect(staleTambons(exampleStatus([late]), EXAMPLE_NOW)).toEqual([BANA.code]);
    const fill = alertFillColor(exampleStatus([late, exampleAlert("watch", [BANA.code])]));
    expect(JSON.stringify(fill)).toContain("240, 127, 26");
    expect(JSON.stringify(fill)).not.toContain("242, 194, 48");
  });
});

describe("map dashboard (spec 4.2)", () => {
  it("opens on the live view when an alert is in force, and on the risk view when none is", () => {
    expect(dashboard().querySelector("[data-map]")?.textContent).toContain("alerts");
    const quiet = dashboard({ status: exampleStatus([]) });
    // Safe places are drawn only once the person asks for them (the owner, 12 Oct).
    expect(quiet.querySelector("[data-map]")?.textContent).toBe("hazard,gauges");
    expect(quiet.querySelector('[data-pending-layer="hazard"]')).not.toBeNull();
  });

  it("the hazard classes are named in the legend with their disclaimer once there are tiles to draw", () => {
    const without = dashboard({ status: exampleStatus([]) });
    expect(without.querySelector('[data-pending-layer="hazard"]')).not.toBeNull();
    expect(without.querySelector("[data-hazard-class]")).toBeNull();
    const c = dashboard({
      status: exampleStatus([]),
      hazardTiles: "pmtiles://https://tiles.example/h.pmtiles",
    });
    expect(c.querySelector('[data-pending-layer="hazard"]')).toBeNull();
    const names = [...c.querySelectorAll("[data-hazard-class]")].map((el) => el.textContent);
    expect(names).toEqual([
      th.map.risk.level.high,
      th.map.risk.level.medium,
      th.map.risk.level.low,
    ]);
    // The lowest class is not drawn, so the words under the legend have to say what no colour means.
    expect(c.querySelector("[data-hazard-note]")?.textContent).toBe(th.map.risk.note);
    expect(th.map.risk.note).toContain("ไม่ได้แปลว่าไม่มีความเสี่ยง");
  });

  it("the flood-risk areas start on and its chip switches them off and on (no second switch)", () => {
    const c = dashboard({
      status: exampleStatus([]),
      hazardTiles: "pmtiles://https://tiles.example/h.pmtiles",
    });
    // The chips above the map do this now (owner, 15 Oct); the old switch under the map is gone.
    expect(c.querySelector("[data-hazard-toggle]")).toBeNull();
    expect(c.querySelector("[data-sea-toggle]")).toBeNull();
    const toggle = c.querySelector<HTMLButtonElement>("[data-map-chip='risk']")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(c.querySelector("[data-map]")?.textContent).toBe("hazard,gauges");
    fireEvent.click(toggle);
    expect(c.querySelector("[data-map]")?.textContent).toBe("gauges");
    expect(c.querySelector("[data-hazard-class]")).toBeNull();
    fireEvent.click(toggle);
    expect(c.querySelector("[data-map]")?.textContent).toBe("hazard,gauges");
  });

  it("offers four map backgrounds, opens on satellite + terrain, and says what the picture is", () => {
    const c = dashboard({ status: exampleStatus([]) });
    const choices = [...c.querySelectorAll<HTMLButtonElement>("[data-basemap-choice]")];
    expect(choices.map((b) => b.dataset.basemapChoice)).toEqual([
      "streets",
      "terrain",
      "satellite",
      "satelliteTerrain",
    ]);
    expect(choices.map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "false",
      "false",
      "false",
      "true",
    ]);
    expect(choices[3]!.textContent).toBe(th.map.basemap.satelliteTerrain);
    expect(c.querySelector("[data-map]")?.getAttribute("data-basemap")).toBe("satelliteTerrain");
    // The default is a photograph, so the note on what the picture is shows from the start.
    expect(c.textContent).toContain(th.map.basemap.satelliteNote);
    fireEvent.click(choices[1]!);
    expect(c.querySelector("[data-map]")?.getAttribute("data-basemap")).toBe("terrain");
    expect(c.textContent).not.toContain(th.map.basemap.satelliteNote);
    fireEvent.click(choices[2]!);
    expect(c.querySelector("[data-map]")?.getAttribute("data-basemap")).toBe("satellite");
    expect(c.textContent).toContain(th.map.basemap.satelliteNote);
  });

  it("My places tours the person's own places one by one, and Reset goes back", () => {
    const c = dashboard({ me: EXAMPLE_ME });
    const bounds = () => c.querySelector("[data-map]")!.getAttribute("data-bounds");
    const opening = bounds();
    const places = EXAMPLE_ME.signedIn ? EXAMPLE_ME.places.filter((p) => p.area) : [];
    expect(places.length).toBeGreaterThan(1);
    const near = (area: { lon: number; lat: number }) =>
      [area.lon - 0.025, area.lat - 0.02, area.lon + 0.025, area.lat + 0.02]
        .map((n) => n.toFixed(2))
        .join(",");
    fireEvent.click(c.querySelector("[data-zoom-mine]")!);
    // The first place: the map comes close to it and its card opens.
    expect(c.querySelector("[data-tour]")?.getAttribute("data-tour")).toBe(places[0]!.id);
    expect(bounds()).toBe(near(places[0]!.area!));
    expect(c.querySelector('[data-selected="mine"]')?.textContent).toContain(places[0]!.label);
    // The two buttons on the map give way to the tour while it is open.
    expect(c.querySelector("[data-zoom-all]")).toBeNull();
    fireEvent.click(c.querySelector('[data-tour-step="next"]')!);
    expect(c.querySelector("[data-tour]")?.getAttribute("data-tour")).toBe(places[1]!.id);
    expect(bounds()).toBe(near(places[1]!.area!));
    // Previous from the first goes round to the last.
    fireEvent.change(c.querySelector("[data-tour-pick]")!, { target: { value: "0" } });
    expect(c.querySelector("[data-tour]")?.getAttribute("data-tour")).toBe(places[0]!.id);
    fireEvent.click(c.querySelector('[data-tour-step="back"]')!);
    expect(c.querySelector("[data-tour]")?.getAttribute("data-tour")).toBe(
      places[places.length - 1]!.id,
    );
    // The list names each place with its number.
    const options = [...c.querySelectorAll("[data-tour-pick] option")].map((o) => o.textContent);
    expect(options[0]).toBe(`${places[0]!.label} (1/${places.length})`);
    // Reset: the first view again, no card, and the two buttons are back.
    fireEvent.click(c.querySelector("[data-tour-reset]")!);
    expect(c.querySelector("[data-tour]")).toBeNull();
    expect(bounds()).toBe(opening === "" ? "99.95,5.55,102.25,8.00" : opening);
    expect(c.querySelector('[data-selected="mine"]')).toBeNull();
    expect(c.querySelector("[data-zoom-all]")).not.toBeNull();
  });

  it("has a 2D / 3D switch on the map, flat by default, and says what 3D draws", () => {
    const c = dashboard({ status: exampleStatus([]) });
    const frame = c.querySelector("[data-map-frame]")!;
    const choices = [...frame.querySelectorAll<HTMLButtonElement>("[data-scene-choice]")];
    expect(choices.map((b) => b.textContent)).toEqual([th.map.scene.flat, th.map.scene.threeD]);
    expect(choices.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    expect(c.querySelector("[data-scene-note]")).toBeNull();
    fireEvent.click(choices[1]!);
    expect(frame.querySelector("[data-scene-switch]")?.getAttribute("data-scene-switch")).toBe(
      "3d",
    );
    expect(c.querySelector("[data-scene-note]")?.textContent).toContain("1.5");
    fireEvent.click(choices[0]!);
    expect(c.querySelector("[data-scene-note]")).toBeNull();
  });

  it("safe places wait behind a switch that says how many there are", () => {
    const c = dashboard({ status: exampleStatus([]) });
    const toggle = c.querySelector<HTMLInputElement>("[data-places-toggle] input")!;
    expect(toggle.checked).toBe(false);
    expect(c.querySelector("[data-places-toggle]")?.textContent).toContain(
      String(EXAMPLE_MAP.places.length),
    );
    expect(c.querySelector('[data-layer="places"]')).toBeNull();
    fireEvent.click(toggle);
    expect(c.querySelector("[data-map]")?.textContent).toBe("hazard,gauges,places");
    expect(c.querySelector('[data-layer="places"]')?.textContent).toContain(th.map.layers.places);
    expect(c.textContent).toContain(th.map.places.hint);
    fireEvent.click(toggle);
    expect(c.querySelector("[data-map]")?.textContent).toBe("hazard,gauges");
    // With no place to show there is nothing to switch on.
    const none = dashboard({ status: exampleStatus([]), data: { ...EXAMPLE_MAP, places: [] } });
    expect(none.querySelector("[data-places-toggle]")).toBeNull();
  });

  it("the list of alerts keeps a stale alert's level and adds the marker", () => {
    const c = dashboard({
      status: exampleStatus([
        exampleAlert("warning", [BANA.code], {
          nextUpdateAt: new Date(EXAMPLE_NOW - 60_000).toISOString(),
        }),
      ]),
    });
    const list = c.querySelector("[data-alerts-list]")!;
    expect(list.querySelector('[data-level="warning"]')).not.toBeNull();
    expect(list.querySelector("[data-stale]")).not.toBeNull();
    expect(list.textContent).toContain("บานา");
  });

  it("before launch the legend has no Normal and says why", () => {
    const c = dashboard({ status: exampleStatus([exampleAlert("watch", [BANA.code])], false) });
    expect(c.querySelector('[data-legend] [data-level="normal"]')).toBeNull();
    expect(c.querySelector('[data-pending-layer="alerts"]')).not.toBeNull();
  });

  it("has no Transparency tab while donations are off, and Map opens first when they are on", () => {
    expect(dashboard().querySelector('[role="tablist"]')).toBeNull();
    const c = dashboard({ transparency: true });
    const tabs = [...c.querySelectorAll('[role="tab"]')];
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    expect(c.querySelector("[data-map]")).not.toBeNull();
  });
});

describe("the places I watch, on the map", () => {
  it("a visitor has none, and nothing personal is asked for", () => {
    const c = dashboard();
    expect(c.querySelector("[data-map]")?.getAttribute("data-mine-count")).toBe("0");
    expect(c.querySelector("[data-mine-toggle]")).toBeNull();
    expect(c.querySelector('[data-layer="mine"]')).toBeNull();
  });

  it("a signed-in person sees their own places, with a switch and a legend row", () => {
    const c = dashboard({ me: EXAMPLE_ME });
    const map = c.querySelector("[data-map]")!;
    // Both watched places of the example; a place pinned outside the covered tambons is left out.
    expect(map.getAttribute("data-mine")).toBe("w1,w2");
    expect(c.querySelector("[data-mine-toggle]")?.textContent).toContain("2");
    expect(c.querySelector('[data-layer="mine"]')?.textContent).toContain(th.map.layers.mine);
  });

  it("the switch takes them off the map again", () => {
    const c = dashboard({ me: EXAMPLE_ME });
    fireEvent.click(c.querySelector("[data-mine-toggle] input")!);
    expect(c.querySelector("[data-map]")?.getAttribute("data-mine")).toBe("");
    expect(c.querySelector('[data-layer="mine"]')).toBeNull();
  });

  it("a home saved in the account is one of them", () => {
    const withHome = EXAMPLE_ME.signedIn ? { ...EXAMPLE_ME, home: BANA } : EXAMPLE_ME;
    const c = dashboard({ me: withHome });
    expect(c.querySelector("[data-map]")?.getAttribute("data-mine")).toBe("home,w1,w2");
  });

  it("the places are never part of the public map data", () => {
    // What the map draws for everyone comes from /api/public/map (EXAMPLE_MAP); the person's own
    // places arrive separately, from their own session.
    expect(JSON.stringify(EXAMPLE_MAP)).not.toContain("w1");
    expect(JSON.stringify(EXAMPLE_MAP)).not.toContain("บ้านแม่");
  });
});

describe("telling the watched places apart", () => {
  it("every place has its own colour, none of them an alert colour", () => {
    const withHome = EXAMPLE_ME.signedIn ? { ...EXAMPLE_ME, home: BANA } : EXAMPLE_ME;
    const colors = dashboard({ me: withHome })
      .querySelector("[data-map]")!
      .getAttribute("data-mine-colors")!
      .split(",");
    expect(colors).toHaveLength(3);
    expect(new Set(colors).size).toBe(3);
    // The alert palette belongs to alert levels alone (docs/brand.md).
    const alertColors = Object.values(alertColors_).map((c) => c.bg.toLowerCase());
    for (const color of colors) expect(alertColors).not.toContain(color.toLowerCase());
  });

  it("the legend names each place beside its colour", () => {
    const c = dashboard({ me: EXAMPLE_ME });
    const rows = [...c.querySelectorAll("[data-mine-legend]")];
    expect(rows.map((r) => r.textContent)).toEqual(["บ้านแม่", "ร้านที่ตลาด"]);
    // Each with the same shape the map draws: brackets in the place's own colour for a watched
    // place (lib/mine-marks.ts), never a plain dot like a gauge.
    const glyph = c.querySelector('[data-mine-legend="w1"] [data-mine-glyph]');
    expect(glyph?.getAttribute("data-mine-glyph")).toBe("watch");
    expect(glyph?.innerHTML).toContain(`stroke="${MINE_COLORS[0]}"`);
  });

  it("a pin's label carries the name, the person there and the address", () => {
    const labels = dashboard({ me: EXAMPLE_ME })
      .querySelector("[data-map]")!
      .getAttribute("data-mine-labels")!;
    // "Mum's house", the person there, then tambon, district and province in Thai.
    expect(labels).toContain("บ้านแม่");
    expect(labels).toContain("ติดต่อ: แม่");
    expect(labels).toContain("ต.ตะลุโบะ อ.เมืองปัตตานี จ.ปัตตานี");
    // A place with nobody stored shows only its name and address.
    expect(labels).toContain("ร้านที่ตลาด | ต.สะบารัง");
    // The address and the person are in the label; the number travels separately, as a button.
    expect(labels).not.toContain("0800000000");
  });

  it("ten places get ten different colours", () => {
    expect(new Set(MINE_COLORS).size).toBe(10);
    expect(MINE_COLORS.map((_, i) => mineColor(i))).toEqual([...MINE_COLORS]);
    // An eleventh would start again from the top rather than have no colour at all.
    expect(mineColor(10)).toBe(MINE_COLORS[0]);
  });
});

describe("the label on a pin", () => {
  const place = {
    id: "w1",
    label: "บ้านแม่",
    lat: 6.87,
    lon: 101.27,
    home: false,
    color: "#7FD1C9",
    lines: ["ติดต่อ: แม่", "ต.ตะลุโบะ อ.เมืองปัตตานี จ.ปัตตานี"],
    call: { tel: "0800000000", label: "โทรหา แม่" },
  };

  it("shows the name, the person there and the address", () => {
    const box = mineLabel(place);
    expect(box.querySelector("b")?.textContent).toBe("บ้านแม่");
    expect([...box.querySelectorAll("span")].map((s) => s.textContent)).toEqual([
      "ติดต่อ: แม่",
      "ต.ตะลุโบะ อ.เมืองปัตตานี จ.ปัตตานี",
    ]);
  });

  it("carries a button that dials the person there, with the number written out", () => {
    const call = mineLabel(place).querySelector("a")!;
    expect(call.getAttribute("href")).toBe("tel:0800000000");
    expect(call.textContent).toContain("โทรหา แม่");
    expect(call.textContent).toContain("0800000000");
    // Big enough to hit, like every other call button (CLAUDE.md).
    expect(call.className).toContain("min-h-tap");
  });

  it("a place with no number stored has no call button", () => {
    const box = mineLabel({ ...place, call: null, lines: ["ต.สะบารัง"] });
    expect(box.querySelector("a")).toBeNull();
  });

  it("the name travels with the feature, so the map can write it beside the pin", () => {
    const f = minePlaceFeature(place);
    expect(f.properties.label).toBe("บ้านแม่");
    expect(f.properties.color).toBe("#7FD1C9");
    expect(f.properties.home).toBe(0);
    expect(f.geometry.coordinates).toEqual([101.27, 6.87]);
    // The person, their number and the address stay off the map face itself: they are in the
    // label that hover or a tap opens.
    expect(JSON.stringify(f)).not.toContain("ติดต่อ");
    expect(JSON.stringify(f)).not.toContain("0800000000");
  });

  it("puts what the person typed on the map as text, never as HTML", () => {
    const box = mineLabel({
      ...place,
      label: "<img src=x onerror=alert(1)>",
      lines: ["<b>not bold</b>"],
      call: null,
    });
    expect(box.querySelector("img")).toBeNull();
    expect(box.querySelectorAll("b")).toHaveLength(1); // only the name's own <b>
    expect(box.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(box.textContent).toContain("<b>not bold</b>");
  });
});

describe("the hazard switcher on a small screen", () => {
  it("the chosen hazard keeps its size; the others are smaller until chosen", () => {
    const c = dashboard();
    const flood = c.querySelector('[data-hazard="flood"]')!;
    const fire = c.querySelector('[data-hazard="fire"]')!;
    expect(flood.getAttribute("aria-pressed")).toBe("true");
    expect(flood.className).toContain("min-h-tap");
    expect(fire.className).toContain("min-h-9");
    // Smaller to look at, but still a full 48 px target: the box after it makes up the rest.
    expect(fire.className).toContain("after:-inset-y-1.5");
    // On a laptop every chip keeps its usual size.
    expect(fire.className).toContain("lg:min-h-tap");
  });

  it("choosing one gives it the full size and shrinks the one left behind", () => {
    const c = dashboard();
    fireEvent.click(c.querySelector('[data-hazard="fire"]')!);
    const flood = c.querySelector('[data-hazard="flood"]')!;
    const fire = c.querySelector('[data-hazard="fire"]')!;
    expect(fire.className).toContain("min-h-tap");
    expect(fire.className).not.toContain("min-h-9");
    expect(flood.className).toContain("min-h-9");
  });

  it("on a phone or tablet only the chosen hazard shows until 'Other hazards' is opened (owner, 16 Oct)", () => {
    const c = dashboard();
    const item = (code: string) => c.querySelector(`[data-hazard="${code}"]`)!.closest("li")!;
    expect(item("flood").className).not.toContain("max-lg:hidden");
    expect(item("fire").className).toContain("max-lg:hidden");
    const more = c.querySelector<HTMLButtonElement>("[data-more-hazards]")!;
    expect(more.closest("li")!.className).toContain("lg:hidden");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    // Every other hazard is still to come, so the button says so, and how many.
    const others = c.querySelectorAll("[data-hazard]").length - 1;
    expect(more.textContent).toBe(th.map.hazard.moreSoon.replace("{count}", String(others)));
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(item("fire").className ?? "").not.toContain("max-lg:hidden");
    // A coming-soon hazard picked from the list stays in view after the list is closed again.
    fireEvent.click(c.querySelector('[data-hazard="fire"]')!);
    fireEvent.click(more);
    expect(item("fire").className ?? "").not.toContain("max-lg:hidden");
    expect(item("flood").className).toContain("max-lg:hidden");
  });

  it("a hazard that is still coming says so, chosen or not (safety rule 10)", () => {
    const c = dashboard();
    expect(c.querySelector('[data-hazard="fire"]')?.textContent).toContain(
      th.map.hazard.comingSoon,
    );
    fireEvent.click(c.querySelector('[data-hazard="fire"]')!);
    expect(c.querySelector('[data-hazard="fire"]')?.textContent).toContain(
      th.map.hazard.comingSoon,
    );
  });
});

describe("calling the person at a watched place, from the map", () => {
  it("a place with a number stored gets one to dial; one without does not", () => {
    // The owner asked for this on 9 Oct; before that the number was kept off the map entirely.
    const calls = dashboard({ me: EXAMPLE_ME })
      .querySelector("[data-map]")!
      .getAttribute("data-mine-calls");
    // บ้านแม่ has แม่ and her number; ร้านที่ตลาด has nobody stored.
    expect(calls).toBe("w1:0800000000,w2:-");
  });

  it("a home saved in the account has nobody to call", () => {
    const withHome = EXAMPLE_ME.signedIn ? { ...EXAMPLE_ME, home: BANA } : EXAMPLE_ME;
    const calls = dashboard({ me: withHome })
      .querySelector("[data-map]")!
      .getAttribute("data-mine-calls");
    expect(calls?.startsWith("home:-")).toBe(true);
  });

  it("the card under the map dials the same number", () => {
    const c = dashboard({ me: EXAMPLE_ME });
    fireEvent.click(c.querySelector("[data-select-mine]")!);
    const card = c.querySelector('[data-selected="mine"]')!;
    expect(card.textContent).toContain("บ้านแม่");
    const call = card.querySelector('a[href^="tel:"]')!;
    expect(call.getAttribute("href")).toBe("tel:0800000000");
    expect(call.textContent).toContain("โทรหา แม่");
  });
});

describe("the map opens where the person already is", () => {
  it("one button pulls back from their own area to all four provinces (owner, 13 Oct)", () => {
    const c = dashboard({ area: BANA });
    const map = () => c.querySelector("[data-map]")!.getAttribute("data-bounds")!;
    expect(map()).not.toBe("99.95,5.55,102.25,8.00");
    const button = c.querySelector("[data-zoom-all]") as HTMLButtonElement;
    expect(button.textContent).toBe(th.map.zoomAll);
    fireEvent.click(button);
    expect(map()).toBe("99.95,5.55,102.25,8.00");
  });

  it("their area decides the province, where the map looks, and the alert shown first", () => {
    const c = dashboard({ area: BANA });
    // The province selector is already on theirs (Pattani, 94), not "all four".
    expect((c.querySelector("#map-province") as HTMLSelectElement).value).toBe("94");
    // The map looks at the whole of their province (the owner, 15 Oct).
    expect(c.querySelector("[data-map]")?.getAttribute("data-bounds")).toBe(
      // The province, and the wave points off its own coast (owner, 15 Oct).
      withCoast(PROVINCE_BOUNDS["94"]!, ["94"])
        .map((n) => n.toFixed(2))
        .join(","),
    );
    // And their tambon's alert is the one shown, without tapping anything.
    expect(c.querySelector("[data-selected-panel]")?.textContent).toContain("บานา");
  });

  it("a watched place in another province brings that province into the opening view", () => {
    const nara = { ...BANA, code: "960101", lat: 6.42, lon: 101.82 };
    const c = dashboard({
      area: BANA,
      me: {
        signedIn: true,
        home: null,
        places: [{ id: "p1", label: "Mum", area: nara, contactName: null, contactPhone: null }],
      },
    });
    expect(c.querySelector("[data-map]")?.getAttribute("data-bounds")).toBe(
      withCoast(provincesBox(["940101", "960101"])!, ["94", "96"])
        .map((n) => n.toFixed(2))
        .join(","),
    );
  });

  it("a visitor with no area chosen still sees all four provinces", () => {
    const c = dashboard();
    expect((c.querySelector("#map-province") as HTMLSelectElement).value).toBe("");
    expect(c.querySelector("[data-map]")?.getAttribute("data-bounds")).toBe("");
    expect(c.querySelector("[data-selected-panel]")).toBeNull();
  });

  it("choosing another province takes over from the area", () => {
    const c = dashboard({ area: BANA });
    fireEvent.change(c.querySelector("#map-province")!, { target: { value: "95" } });
    expect((c.querySelector("#map-province") as HTMLSelectElement).value).toBe("95");
    // Now the whole of that province, not a box around the old tambon.
    expect(c.querySelector("[data-map]")?.getAttribute("data-bounds")).not.toBe("");
    expect(c.querySelector("[data-selected-panel]")).toBeNull();
  });

  it("closing the first card leaves it closed", () => {
    const c = dashboard({ area: BANA });
    expect(c.querySelector("[data-selected-panel]")).not.toBeNull();
    fireEvent.click(c.querySelector("[data-selected-panel] button")!);
    expect(c.querySelector("[data-selected-panel]")).toBeNull();
  });
});

describe("river gauges on the public map (A8 item 4)", () => {
  it("names the look, the trend and the words beside a gauge near or over its bank", async () => {
    const { gaugeLook, trendOf, gaugeLabels } = await import("@/lib/gauge-marks");
    // The gauge's own three levels (A10): Evacuate is its bank, Warning is close to it, and Watch
    // is only above the level the river normally runs at.
    expect(gaugeLook("above_evacuate")).toBe("over");
    expect(gaugeLook("above_warning")).toBe("near");
    expect(gaugeLook("above_watch")).toBe("high");
    expect(gaugeLook("normal")).toBe("normal");
    expect(gaugeLook("no_recent_data")).toBe("quiet");
    expect(trendOf(0.3, "normal")).toBe("up");
    expect(trendOf(-0.3, "near")).toBe("down");
    expect(trendOf(0.02, "normal")).toBe("flat");
    // A silent gauge has no trend to show, whatever its last two readings did.
    expect(trendOf(0.5, "quiet")).toBe("flat");
    const words = { near: "near bank", over: "over bank" };
    expect(gaugeLabels({ value: 16.62, status: "above_evacuate" }, words)).toEqual({
      short: "over bank",
      long: "16.62 m · over bank",
    });
    expect(gaugeLabels({ value: 15.4, status: "above_warning" }, words)).toEqual({
      short: "near bank",
      long: "15.40 m · near bank",
    });
    // Above its normal level is a long way below the bank: the glass and the card say it, the map
    // does not shout it.
    expect(gaugeLabels({ value: 9.2, status: "above_watch" }, words)).toEqual({
      short: "",
      long: "9.20 m",
    });
    expect(gaugeLabels({ value: 3.1, status: "normal" }, words)).toEqual({
      short: "",
      long: "3.10 m",
    });
    expect(gaugeLabels({ value: 3.1, status: "no_recent_data" }, words).long).toBe("");
  });

  it("draws gauges in water colour, far from every alert colour", async () => {
    const { gaugePaint } = await import("@/lib/gauge-marks");
    const { alert } = await import("@/lib/brand/tokens");
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    for (const dark of [false, true]) {
      const water = rgb(gaugePaint(dark).water);
      for (const level of ["normal", "watch", "warning", "evacuate", "return"] as const) {
        const other = rgb(alert[level].bg);
        const distance = Math.hypot(...water.map((v, k) => v - other[k]!));
        // The map's own water colour (the dam's river): nearest to Return's blue, ~69 apart by day. The
        // glass shape and the written state carry the meaning, never the colour alone.
        expect(distance, level).toBeGreaterThan(60);
      }
    }
  });
});

describe("the chips above the map (owner, 15 Oct)", () => {
  const chip = (c: HTMLElement, f: string) =>
    c.querySelector<HTMLButtonElement>(`[data-map-chip='${f}']`)!;
  const bounds = (c: HTMLElement) => c.querySelector("[data-map]")!.getAttribute("data-bounds");

  it("are switches in their order, several on at once, and none of them moves the map", () => {
    const c = dashboard({ dams: [EXAMPLE_DAM], area: BANA });
    const order = [...c.querySelectorAll("[data-map-chip]")].map((b) =>
      b.getAttribute("data-map-chip"),
    );
    expect(order).toEqual(["risk", "gauges", "sea", "dam", "damzone", "places"]);
    // What the map draws today starts on; the thousands of safe places start off.
    const on = (f: string) => chip(c, f).getAttribute("aria-pressed");
    expect(["risk", "gauges", "sea", "dam", "damzone"].map(on)).toEqual([
      "true",
      "true",
      "true",
      "true",
      "true",
    ]);
    expect(on("places")).toBe("false");
    const before = bounds(c);
    fireEvent.click(chip(c, "places"));
    fireEvent.click(chip(c, "gauges"));
    fireEvent.click(chip(c, "damzone"));
    expect(on("places")).toBe("true");
    expect(on("gauges")).toBe("false");
    expect(on("risk")).toBe("true");
    const map = c.querySelector("[data-map]")!;
    expect(map.textContent).toContain("places");
    expect(map.textContent).not.toContain("gauges");
    expect(map.getAttribute("data-show-zone")).toBe("0");
    expect(map.getAttribute("data-show-dam")).toBe("1");
    expect(bounds(c)).toBe(before);
  });

  it("the dam's chip, switched on, opens the dam's report as before; off, hides the dam", () => {
    const c = dashboard({ dams: [EXAMPLE_DAM], area: BANA });
    fireEvent.click(chip(c, "dam"));
    expect(c.querySelector("[data-map]")!.getAttribute("data-show-dam")).toBe("0");
    fireEvent.click(chip(c, "dam"));
    expect(c.querySelector("[data-map]")!.getAttribute("data-show-dam")).toBe("1");
    expect(c.querySelector("[data-selected-panel]")?.textContent).toContain(EXAMPLE_DAM.name.th!);
  });
});

describe("the background follows the time of day (owner, 15 Oct)", () => {
  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });
  it("is Satellite + terrain by day and Terrain at night; a pick lasts until day and night change", () => {
    document.documentElement.dataset.theme = "light";
    const day = dashboard({ status: exampleStatus([]) });
    expect(day.querySelector("[data-map]")?.getAttribute("data-basemap")).toBe("satelliteTerrain");
    document.documentElement.dataset.theme = "dark";
    const night = dashboard({ status: exampleStatus([]) });
    expect(night.querySelector("[data-map]")?.getAttribute("data-basemap")).toBe("terrain");
    fireEvent.click(night.querySelector("[data-basemap-choice='streets']")!);
    expect(night.querySelector("[data-map]")?.getAttribute("data-basemap")).toBe("streets");
  });
});

/*
 * Switching on the flood a satellite saw (the owner, 20 Oct 2026). Four things happen together,
 * and closing it undoes all of them: the risk classes come off, the map travels to the hexagons,
 * they blink, and the frame the reader had is remembered.
 *
 * Driven here the way the page drives it: a holder that keeps the window and hands the answer
 * back, which is what components/map/Dashboard.tsx does with the fetch.
 */
describe("what the satellite saw, switched on and off", () => {
  const CELLS = [101.78, 101.82].map((lon) => ({
    type: "Feature" as const,
    geometry: {
      type: "Polygon" as const,
      coordinates: [
        [
          [lon, 6.4],
          [lon + 0.01, 6.4],
          [lon + 0.01, 6.41],
          [lon, 6.4],
        ],
      ],
    },
    properties: { m2: 120_000 },
  }));

  function Holder({ cells = CELLS }: { cells?: typeof CELLS }) {
    const [days, setDays] = useState<SatelliteWindow | null>(null);
    return (
      <DashboardView
        status={exampleStatus([])}
        checkedAt={EXAMPLE_NOW - 60_000}
        failed={false}
        hazards={EXAMPLE_HAZARDS}
        hazardsState="ok"
        directory={EXAMPLE_DIRECTORY}
        directoryState="ok"
        data={EXAMPLE_MAP}
        dataState="ok"
        now={EXAMPLE_NOW}
        transparency={false}
        satelliteDays={days}
        onSatelliteDays={setDays}
        satelliteLoad={days === null ? "loading" : "ok"}
        satellite={
          days === null
            ? null
            : {
                days,
                fetchedAt: "2026-10-20T04:00:00.000Z",
                cells: cells.length,
                km2: 0.24,
                passDays: ["2026-10-18"],
                truncated: false,
                features: cells,
              }
        }
      />
    );
  }

  const onMap = (c: HTMLElement) => c.querySelector("[data-map]")!;
  const risk = (c: HTMLElement) =>
    c.querySelector<HTMLButtonElement>('[data-map-features="map"] [data-map-chip="risk"]')!;

  it("takes the risk classes off, frames the hexagons and blinks them", () => {
    const c = renderWithIntl(<Holder />).container;
    const opening = onMap(c).getAttribute("data-bounds");
    expect(risk(c).getAttribute("aria-pressed")).toBe("true");
    expect(onMap(c).getAttribute("data-flash-satellite")).toBe("0");

    fireEvent.click(c.querySelector("[data-satellite-toggle] input")!);

    expect(risk(c).getAttribute("aria-pressed")).toBe("false");
    expect(onMap(c).getAttribute("data-satellite-cells")).toBe("2");
    expect(onMap(c).getAttribute("data-flash-satellite")).toBe("1");
    const at = onMap(c).getAttribute("data-bounds")!;
    expect(at).not.toBe(opening);
    const [west, , east] = at.split(",").map(Number);
    expect(west).toBeLessThan(101.78);
    expect(east).toBeGreaterThan(101.83);
  });

  it("closing it puts back the frame the reader was looking at, and the risk classes", () => {
    const c = renderWithIntl(<Holder />).container;
    // Where they were: a frame of their own, not the one the map opened on.
    fireEvent.click(c.querySelector("[data-panned]")!);
    fireEvent.click(c.querySelector("[data-satellite-toggle] input")!);
    expect(onMap(c).getAttribute("data-bounds")).not.toBe("100.10,6.10,100.30,6.30");

    fireEvent.click(c.querySelector("[data-satellite-close]")!);
    expect(onMap(c).getAttribute("data-bounds")).toBe("100.10,6.10,100.30,6.30");
    expect(risk(c).getAttribute("aria-pressed")).toBe("true");
    expect(onMap(c).getAttribute("data-satellite-cells")).toBe("0");
    expect(c.querySelector("[data-satellite-close]")).toBeNull();
  });

  it("an empty answer moves nothing and hides nothing: it is no all-clear", () => {
    const c = renderWithIntl(<Holder cells={[]} />).container;
    const opening = onMap(c).getAttribute("data-bounds");
    fireEvent.click(c.querySelector("[data-satellite-toggle] input")!);
    expect(onMap(c).getAttribute("data-bounds")).toBe(opening);
    expect(risk(c).getAttribute("aria-pressed")).toBe("true");
    expect(onMap(c).getAttribute("data-flash-satellite")).toBe("0");
    // ...and it says so in words (lib/satellite-flood.ts, satelliteState).
    expect(c.querySelector("[data-satellite-status]")!.textContent).toContain(
      th.map.satellite.none.replace("{days}", "7"),
    );
  });

  it("the reset button goes back to the first view and the layers it opens with", () => {
    const c = renderWithIntl(<Holder />).container;
    // Nothing is asked for at first, so the map is left to its own default (the four provinces).
    expect(onMap(c).getAttribute("data-bounds")).toBe("");
    fireEvent.click(c.querySelector('[data-map-features="map"] [data-map-chip="gauges"]')!);
    fireEvent.click(c.querySelector("[data-satellite-toggle] input")!);
    expect(onMap(c).textContent).not.toContain("gauges");

    fireEvent.click(c.querySelector("[data-map-reset]")!);
    // ...and reset asks for that same view by name, this reader having chosen no area.
    expect(onMap(c).getAttribute("data-bounds")).toBe(
      SERVICE_BOUNDS.map((n) => n.toFixed(2)).join(","),
    );
    expect(onMap(c).textContent).toContain("hazard");
    expect(onMap(c).textContent).toContain("gauges");
    expect(onMap(c).getAttribute("data-satellite-cells")).toBe("0");
    expect(c.querySelector("[data-satellite]")!.getAttribute("data-satellite")).toBe("off");
  });
});

/*
 * The owner, 20 Oct 2026, of the two readouts that open: "for the case that there are 3 gauges
 * that says '3 near the bank', when clicked it should show the worst 3 first, regardless they
 * are near or not, also the map should zoom the extents of the 3 not only one, also make it
 * blip for 3 times. Same should work for the dams card... I want them to be able to click next
 * to see different one as well in the detail section."
 *
 * So: what the readout counts is what it opens, the frame holds all of them, every one of them
 * is lit, and the card walks through the rest.
 */
describe("what the rivers' and the reservoirs' readouts open (20 Oct)", () => {
  const riverGauge = (over: Partial<(typeof EXAMPLE_MAP)["gauges"][number]>) => ({
    ...EXAMPLE_MAP.gauges[0]!,
    ...over,
  });
  // Three at their banks, spread across the four provinces, and one quiet river next door.
  const NEAR_THREE = [
    riverGauge({ id: "a", lat: 6.2, lon: 101.1, status: "above_evacuate" as const }),
    riverGauge({ id: "b", lat: 7.1, lon: 100.4, status: "above_warning" as const }),
    riverGauge({ id: "c", lat: 6.6, lon: 101.8, status: "above_warning" as const }),
    riverGauge({ id: "calm", lat: 6.84, lon: 101.26, status: "normal" as const }),
  ];
  const openGauges = (c: Element) =>
    fireEvent.click(c.querySelector('[data-console-tile="gauges"] [data-tile-open]')!);
  const flash = (c: Element) => c.querySelector("[data-map]")!.getAttribute("data-flash-codes");

  it("lights every river at or near its bank, worst first, and frames all of them", () => {
    const c = dashboard({ data: { ...EXAMPLE_MAP, gauges: NEAR_THREE } });
    openGauges(c);
    // The worst one opened; the quiet river next door is not among the marks being pointed at.
    expect(c.querySelector("[data-selected='gauge'] [data-gauge-state]")).toBeTruthy();
    expect(flash(c)).toBe("a,b,c");
    expect(c.querySelector("[data-map]")!.getAttribute("data-flash-kind")).toBe("gauge");
    const [west, south, east, north] = c
      .querySelector("[data-map]")!
      .getAttribute("data-bounds")!
      .split(",")
      .map(Number);
    for (const g of NEAR_THREE.slice(0, 3)) {
      expect(west!).toBeLessThanOrEqual(g.lon);
      expect(east!).toBeGreaterThanOrEqual(g.lon);
      expect(south!).toBeLessThanOrEqual(g.lat);
      expect(north!).toBeGreaterThanOrEqual(g.lat);
    }
  });

  it("walks through the other stations from inside the card, one at a time", () => {
    const c = dashboard({ data: { ...EXAMPLE_MAP, gauges: NEAR_THREE } });
    openGauges(c);
    const steps = c.querySelector("[data-selected='gauge'] [data-card-steps]")!;
    fireEvent.click(steps.querySelector('[data-card-step="next"]')!);
    // One station now, framed and lit on its own: the group has been left behind.
    expect(flash(c)).toBe("b");
    fireEvent.click(
      c.querySelector("[data-selected='gauge'] [data-card-step='previous']")!,
    );
    expect(flash(c)).toBe("a");
  });

  /*
   * The owner, 20 Oct: "like the GISTDA details, when clicked on close button should bring the
   * map to the default extent". Only a card that moved the map moves it back.
   */
  it("closing the card the readout opened puts the map back where it was", () => {
    const c = dashboard({ data: { ...EXAMPLE_MAP, gauges: NEAR_THREE } });
    const bounds = () => c.querySelector("[data-map]")!.getAttribute("data-bounds");
    openGauges(c);
    const atStations = bounds();
    expect(atStations).not.toBe("");
    const close = [...c.querySelectorAll("[data-selected-panel] button")].at(-1)!;
    fireEvent.click(close);
    expect(c.querySelector("[data-selected-panel]")).toBeNull();
    expect(bounds()).toBe(SERVICE_BOUNDS.map((n) => n.toFixed(2)).join(","));
    expect(bounds()).not.toBe(atStations);
  });

  /*
   * The owner, 20 Oct: "these 2 cards should show the blinking situation light on the default
   * folded card, no need to hover on to see the blinking light". It waited in the part of the
   * card that only opens on hover, which is the one glance it is there for.
   */
  it("pulses on the folded card, and only while the readings are current", () => {
    const c = dashboard({ data: { ...EXAMPLE_MAP, gauges: NEAR_THREE }, dams: [EXAMPLE_DAM] });
    for (const tile of ["gauges", "dam"]) {
      expect(
        c.querySelector(`[data-console-tile="${tile}"] [data-tile-brief] [data-live-dot]`),
      ).toBeTruthy();
    }
    // A feed that has stopped says so in words and does not pulse: that would claim live figures.
    const stale: Dam = {
      ...EXAMPLE_DAM,
      signal: { ...exampleDamSignal("watch")!, stale: true },
    };
    const old = dashboard({ dams: [stale] });
    expect(
      old.querySelector('[data-console-tile="dam"] [data-tile-brief] [data-live-dot]'),
    ).toBeNull();
  });

  it("with no river near its bank, opens the one station it names", () => {
    const c = dashboard({ data: EXAMPLE_MAP });
    openGauges(c);
    expect(flash(c)).toBe(EXAMPLE_MAP.gauges[0]!.id);
  });

  it("lights every reservoir doing something, and walks through the dams as well", () => {
    const spilling: Dam = {
      ...EXAMPLE_DAM,
      code: "other_dam",
      name: { th: "เขื่อนอื่น", en: "Other dam" },
      // Spilling, which comes before a reservoir merely above the level it is held at.
      signal: exampleDamSignal("releasing"),
    };
    const c = dashboard({ dams: [EXAMPLE_DAM, spilling] });
    fireEvent.click(c.querySelector('[data-console-tile="dam"] [data-tile-open]')!);
    expect(c.querySelector("[data-map]")!.getAttribute("data-flash-kind")).toBe("reservoir");
    // Both are doing something - this one is spilling, Bang Lang is above its normal high water.
    expect(flash(c)).toBe("other_dam,bang_lang");
    const steps = c.querySelector("[data-selected='dam'] [data-card-steps]")!;
    fireEvent.click(steps.querySelector('[data-card-step="next"]')!);
    expect(flash(c)).toBe(EXAMPLE_DAM.code);
  });
});
