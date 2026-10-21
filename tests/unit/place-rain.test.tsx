import { describe, expect, it } from "vitest";
import { cloudElement } from "@/components/map/PlaceRain";
import {
  CLOUD_LOOKS,
  cloudLift,
  dropAt,
  MAX_POINTS,
  nowUrl,
  pointsQuery,
  RAIN_KINDS,
  rainClouds,
  rainKind,
  rainPoints,
  readPointsQuery,
  toPointWeather,
  type RainCloud,
} from "@/lib/place-rain";
import { isWet, weatherGroup } from "@/lib/weather";

const home = { id: "home", lat: 6.8691, lon: 101.2501, home: true };
const mum = { id: "w1", lat: 6.5412, lon: 101.2803, home: false };

describe("rain over the person's own places (owner, 15 Oct)", () => {
  it("draws a cloud for every rain group of the weather widget, and for nothing else", () => {
    for (let code = 0; code < 100; code++) {
      const wet = isWet(weatherGroup(code));
      expect(rainKind(code) !== null, `code ${code}`).toBe(wet);
    }
    expect(rainKind(null)).toBeNull();
    expect(rainKind(51)).toBe("drizzle");
    expect(rainKind(61)).toBe("light");
    expect(rainKind(63)).toBe("rain");
    expect(rainKind(65)).toBe("heavy");
    expect(rainKind(80)).toBe("showers");
    expect(rainKind(82)).toBe("showersHeavy");
    expect(rainKind(95)).toBe("thunder");
    expect(rainKind(99)).toBe("hail");
  });

  it("gets heavier from drizzle to a downpour, with lightning only in a storm", () => {
    const drops = (k: keyof typeof CLOUD_LOOKS) => CLOUD_LOOKS[k].drops;
    expect(drops("light")).toBeLessThan(drops("rain"));
    expect(drops("rain")).toBeLessThan(drops("heavy"));
    expect(CLOUD_LOOKS.drizzle.fall).toBeGreaterThan(CLOUD_LOOKS.heavy.fall);
    for (const kind of RAIN_KINDS) {
      expect(CLOUD_LOOKS[kind].bolt).toBe(kind === "thunder" || kind === "hail");
    }
    expect(CLOUD_LOOKS.hail.hail).toBeGreaterThan(0);
  });

  it("asks about each place once, rounded to about a kilometre, a dozen at most", () => {
    const points = rainPoints([home, { ...home, id: "twin" }, mum]);
    expect(points).toEqual([
      { lat: 6.87, lon: 101.25 },
      { lat: 6.54, lon: 101.28 },
    ]);
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      lat: i,
      lon: i,
      home: false,
    }));
    expect(rainPoints(many)).toHaveLength(MAX_POINTS);
    const query = pointsQuery(points);
    expect(query).toBe("6.87,101.25;6.54,101.28");
    expect(readPointsQuery(query)).toEqual(points);
    expect(readPointsQuery("x,1;91,1;1,2,3;6.871,101.249")).toEqual([{ lat: 6.87, lon: 101.25 }]);
    expect(readPointsQuery(null)).toEqual([]);
    const url = new URL(nowUrl(points));
    expect(url.searchParams.get("latitude")).toBe("6.87,6.54");
    expect(url.searchParams.get("current")).toBe("weather_code,is_day");
  });

  it("reads one point or many, and never guesses for a point with no answer", () => {
    const points = [
      { lat: 6.87, lon: 101.25 },
      { lat: 6.54, lon: 101.28 },
    ];
    expect(toPointWeather(points, [{ current: { weather_code: 95, is_day: 0 } }])).toEqual([
      { lat: 6.87, lon: 101.25, code: 95, isDay: false },
      { lat: 6.54, lon: 101.28, code: null, isDay: true },
    ]);
    expect(
      toPointWeather(points.slice(0, 1), { current: { weather_code: 61, is_day: 1 } }),
    ).toEqual([{ lat: 6.87, lon: 101.25, code: 61, isDay: true }]);
    expect(toPointWeather(points, "junk").every((p) => p.code === null)).toBe(true);
  });

  it("puts clouds only over the places where rain is falling", () => {
    const clouds = rainClouds(
      [home, mum],
      [
        { lat: 6.87, lon: 101.25, code: 3, isDay: true },
        { lat: 6.54, lon: 101.28, code: 82, isDay: false },
      ],
    );
    expect(clouds).toEqual([{ ...mum, reservoir: false, kind: "showersHeavy", isDay: false }]);
    expect(rainClouds([home], [])).toEqual([]);
    expect(cloudLift({ home: true })).toBeGreaterThan(cloudLift({ home: false }));
    // A reservoir has no pin to clear: the cloud sits on the water.
    expect(cloudLift({ home: false, reservoir: true })).toBe(0);
  });

  it("spreads the drops across the cloud the same way every time", () => {
    const n = 7;
    const xs = Array.from({ length: n }, (_, i) => dropAt(i, n, 0.9));
    expect(xs).toEqual(Array.from({ length: n }, (_, i) => dropAt(i, n, 0.9)));
    for (const { x, delay } of xs) {
      expect(x).toBeGreaterThan(5);
      expect(x).toBeLessThan(90);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThan(0.9);
    }
  });
});

describe("the cloud on the map", () => {
  const cloud = (kind: RainCloud["kind"], isDay = true): RainCloud => ({
    ...mum,
    reservoir: false,
    kind,
    isDay,
  });

  it("carries its rain, its lightning and its hail, and takes no taps", () => {
    const storm = cloudElement(cloud("hail"));
    expect(storm.dataset.placeRain).toBe("hail");
    expect(storm.getAttribute("aria-hidden")).toBe("true");
    expect(storm.style.pointerEvents).toBe("none");
    expect(storm.querySelectorAll("[data-drop]")).toHaveLength(CLOUD_LOOKS.hail.drops);
    expect(storm.querySelectorAll("[data-hail]")).toHaveLength(CLOUD_LOOKS.hail.hail);
    expect(storm.querySelector("[data-bolt]")).not.toBeNull();

    const drizzle = cloudElement(cloud("drizzle"));
    expect(drizzle.querySelector("[data-bolt]")).toBeNull();
    expect(drizzle.querySelectorAll("[data-drop]")).toHaveLength(CLOUD_LOOKS.drizzle.drops);
  });

  it("lets the sun peek behind a shower by day, and the moon at night", () => {
    expect(
      cloudElement(cloud("showers", true)).querySelector("[data-peek]")?.getAttribute("data-peek"),
    ).toBe("sun");
    expect(
      cloudElement(cloud("showers", false)).querySelector("[data-peek]")?.getAttribute("data-peek"),
    ).toBe("moon");
    expect(cloudElement(cloud("rain")).querySelector("[data-peek]")).toBeNull();
  });
});
