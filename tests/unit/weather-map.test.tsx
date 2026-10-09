import { describe, expect, it } from "vitest";
import { WeatherMapsView } from "@/components/weather/WeatherMapsView";
import { alert as alertPalette } from "@/lib/brand/tokens";
import { EXAMPLE_GRID, EXAMPLE_PINS } from "@/lib/dev-examples";
import th from "@/messages/th.json";
import {
  cellRing,
  fieldColor,
  GRIDS,
  gridPoints,
  nearestPoint,
  RAMPS,
  snapCentre,
  valueAt,
  WEATHER_FIELDS,
  windArrow,
  wrapLon,
} from "@/lib/weather-grid";
import { renderWithIntl } from "./render";

describe("the grid asked for", () => {
  it("snaps the centre, so everyone nearby shares one cached answer", () => {
    // Two phones a few hundred metres apart ask for exactly the same grid.
    expect(snapCentre(6.8782, 101.2719, 1.2)).toEqual(snapCentre(6.8801, 101.2694, 1.2));
    const snapped = snapCentre(6.8782, 101.2719, 1.2);
    expect(snapped.lat % 0.3).toBeCloseTo(0, 6);
    expect(snapped.lon % 0.3).toBeCloseTo(0, 6);
  });

  it("lays the points out square, from the south-west corner", () => {
    const size = GRIDS[0];
    const points = gridPoints({ lat: 7, lon: 101 }, size);
    expect(points).toHaveLength(size.n * size.n);
    expect(points[0]).toEqual({ lat: 7 - size.span / 2, lon: 101 - size.span / 2 });
    expect(points[points.length - 1]).toEqual({
      lat: 7 + size.span / 2,
      lon: 101 + size.span / 2,
    });
  });

  it("keeps longitude in range across the date line", () => {
    expect(wrapLon(181)).toBe(-179);
    expect(wrapLon(-181)).toBe(179);
    expect(wrapLon(101.2)).toBeCloseTo(101.2, 6);
    expect(gridPoints({ lat: 0, lon: 179.8 }, { span: 1.2, n: 3 }).map((p) => p.lon)).toEqual([
      179.2, 179.8, -179.6, 179.2, 179.8, -179.6, 179.2, 179.8, -179.6,
    ]);
  });
});

describe("the colours of the weather maps", () => {
  it("uses no alert colour anywhere (docs/brand.md: the alert palette is for levels alone)", () => {
    const alerts = Object.values(alertPalette).map((c) => c.bg.toLowerCase());
    for (const field of WEATHER_FIELDS) {
      for (const [, color] of RAMPS[field]) {
        expect(alerts).not.toContain(color.toLowerCase());
      }
    }
  });

  it("has no red, orange, yellow or green anywhere: a cell can't read as a level", () => {
    for (const field of WEATHER_FIELDS) {
      for (const [, color] of RAMPS[field]) {
        const r = Number.parseInt(color.slice(1, 3), 16);
        const g = Number.parseInt(color.slice(3, 5), 16);
        const b = Number.parseInt(color.slice(5, 7), 16);
        // Every colour of every ramp keeps at least as much blue as red: the warm half of the
        // wheel, where the alert palette lives, is left alone.
        expect(b).toBeGreaterThanOrEqual(r - 8);
        // And no colour is a strong green either.
        expect(g).toBeLessThan(Math.max(r, b) + 40);
      }
    }
  });

  it("draws nothing for a dry hour, and darkens as the rain gets heavier", () => {
    expect(fieldColor("rain", 0)).toBeNull();
    expect(fieldColor("rain", 0.05)).toBeNull();
    expect(fieldColor("rain", null)).toBeNull();
    expect(fieldColor("rain", 0.2)).toBe(RAMPS.rain[0]![1]);
    expect(fieldColor("rain", 7)).toBe(RAMPS.rain[3]![1]);
    expect(fieldColor("rain", 999)).toBe(RAMPS.rain[RAMPS.rain.length - 1]![1]);
  });

  it("colours cold temperatures too, which start below the first real stop", () => {
    expect(fieldColor("temp", 12)).toBe(RAMPS.temp[0]![1]);
    expect(fieldColor("temp", 33)).toBe(RAMPS.temp[4]![1]);
    expect(fieldColor("temp", null)).toBeNull();
  });
});

describe("reading a place off the grid", () => {
  it("finds the nearest point, and says nothing when the place is off the grid", () => {
    const point = nearestPoint(EXAMPLE_GRID, EXAMPLE_GRID.lat, EXAMPLE_GRID.lon);
    expect(point).not.toBeNull();
    const points = gridPoints(
      { lat: EXAMPLE_GRID.lat, lon: EXAMPLE_GRID.lon },
      { span: EXAMPLE_GRID.span, n: EXAMPLE_GRID.n },
    );
    expect(points[point!]!.lat).toBeCloseTo(EXAMPLE_GRID.lat, 6);
    expect(nearestPoint(EXAMPLE_GRID, 13.75, 100.5)).toBeNull(); // Bangkok, far away
  });

  it("reads a value at a point and hour", () => {
    const value = valueAt(EXAMPLE_GRID, "temp", 0, 0);
    expect(typeof value).toBe("number");
    expect(valueAt(EXAMPLE_GRID, "temp", 0, 0)).not.toBe(valueAt(EXAMPLE_GRID, "temp", 80, 0));
  });
});

describe("the shapes drawn", () => {
  it("closes each cell's ring around its point", () => {
    const ring = cellRing(7, 101, 0.2);
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    expect(ring[0]).toEqual([100.9, 6.9]);
    expect(ring[2]).toEqual([101.1, 7.1]);
  });

  it("points the wind arrow where the wind is going, not where it comes from", () => {
    // A wind "from 0°" is a northerly: it blows towards the south.
    const [tail, head] = windArrow(7, 101, 0, 0.2);
    expect(head![1]).toBeLessThan(tail![1]);
    // From the east blows towards the west.
    const west = windArrow(7, 101, 90, 0.2);
    expect(west[1]![0]).toBeLessThan(west[0]![0]);
    // Shaft plus two barbs, drawn as one line.
    expect(west).toHaveLength(5);
  });
});

function maps(more: Partial<Parameters<typeof WeatherMapsView>[0]> = {}) {
  return renderWithIntl(
    <WeatherMapsView
      grid={EXAMPLE_GRID}
      state="ok"
      field="rain"
      onField={() => {}}
      hour={0}
      onHour={() => {}}
      places={EXAMPLE_PINS}
      canvas={<div data-canvas="stub" />}
      {...more}
    />,
  ).container;
}

describe("the weather maps section", () => {
  it("offers rain, temperature, humidity and wind, one at a time", () => {
    const c = maps();
    const buttons = [...c.querySelectorAll("[data-weather-field]")];
    expect(buttons.map((b) => b.getAttribute("data-weather-field"))).toEqual([
      "rain",
      "temp",
      "humidity",
      "wind",
    ]);
    expect(buttons.filter((b) => b.getAttribute("aria-checked") === "true")).toHaveLength(1);
    expect(c.textContent).toContain(th.weather.map.fields.rain);
    expect(c.textContent).toContain(th.weather.map.fields.wind);
  });

  it("says which hour it is drawing, with the day, and steps through the grid", () => {
    const c = maps({ hour: 5 });
    const slider = c.querySelector("input[type=range]") as HTMLInputElement;
    expect(slider.max).toBe(String(EXAMPLE_GRID.hours.length - 1));
    expect(slider.value).toBe("5");
    const label = c.querySelector("label[for='weather-map-hour']")!.textContent!;
    expect(label).toMatch(/\d{2}:\d{2}/);
    expect(label).toContain(th.weather.days.today);
  });

  it("says how wide a cell is and that these are model values, not measurements", () => {
    expect(maps().textContent).toContain("แบบจำลอง");
    expect(maps().querySelector('[data-weather-legend="rain"]')).not.toBeNull();
  });

  it("writes the value at each of the person's places, for anyone who can't read a colour", () => {
    const rows = [...maps({ field: "temp" }).querySelectorAll("[data-weather-map-values] li")];
    expect(rows).toHaveLength(EXAMPLE_PINS.length);
    expect(rows[0]!.textContent).toContain(EXAMPLE_PINS[0]!.label);
    expect(rows[0]!.textContent).toMatch(/\d+ °C/);
  });

  it("marks a place that is off the grid instead of guessing a value", () => {
    const far = [{ ...EXAMPLE_PINS[1]!, id: "far", label: "ไกล", lat: 13.75, lon: 100.5 }];
    expect(maps({ places: far }).textContent).toContain(th.weather.map.offGrid);
  });

  it("says so when the grid can't be loaded", () => {
    const c = maps({ grid: null, state: "unavailable" });
    expect(c.querySelector('[role="alert"]')!.textContent).toBe(th.weather.map.unavailable);
    expect((c.querySelector("input[type=range]") as HTMLInputElement).disabled).toBe(true);
  });

  it("carries no alert level or badge, like the rest of the weather page", () => {
    const c = maps();
    expect(c.querySelector("[data-level]")).toBeNull();
    expect(c.innerHTML).not.toMatch(/alert-(normal|watch|warning|evacuate|return)/);
  });
});
