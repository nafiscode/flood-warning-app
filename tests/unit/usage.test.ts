import { describe, expect, it } from "vitest";
import {
  alertLift,
  funnel,
  headerText,
  heatStep,
  insights,
  minutesAndSeconds,
  readAgent,
  readWindow,
  rhythmGrid,
  roughCoordinate,
  share,
  stickiness,
  toUsage,
} from "@/lib/usage";
import { continueSession, counted, newId, SESSION_GAP_MS } from "@/lib/usage-beacon";
import { exampleUsage } from "@/lib/usage-examples";

describe("readAgent", () => {
  it("reads a low-end Android phone in Chrome", () => {
    const a = readAgent(
      "Mozilla/5.0 (Linux; Android 11; SM-A022F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
    );
    expect(a).toEqual({
      device: "phone",
      os: "Android",
      osMajor: 11,
      browser: "Chrome",
      inApp: null,
    });
  });

  it("reads an iPhone in Safari, and Chrome on iPhone", () => {
    expect(
      readAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      ),
    ).toMatchObject({ device: "phone", os: "iOS", osMajor: 17, browser: "Safari" });
    expect(
      readAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1",
      ).browser,
    ).toBe("Chrome");
  });

  it("knows an iPad that asks for the desktop site by its touch points", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15";
    expect(readAgent(ua, 5)).toMatchObject({ device: "tablet", os: "iPadOS" });
    expect(readAgent(ua, 0)).toMatchObject({ device: "desktop", os: "macOS" });
  });

  it("names the app whose built-in browser it is", () => {
    expect(
      readAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Line/14.1.0")
        .inApp,
    ).toBe("LINE");
    expect(
      readAgent(
        "Mozilla/5.0 (Linux; Android 13) Chrome/119 Mobile Safari/537.36 [FB_IAB/MESSENGER;FBAV/440.0]",
      ),
    ).toMatchObject({ inApp: "Messenger", browser: "Messenger" });
    expect(
      readAgent("Mozilla/5.0 (Linux; Android 13) Chrome/119 Mobile [FB_IAB/FB4A;FBAV/440.0]").inApp,
    ).toBe("Facebook");
  });

  it("reads a Windows laptop in Edge and survives nothing at all", () => {
    expect(
      readAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120.0",
      ),
    ).toMatchObject({ device: "desktop", os: "Windows", browser: "Edge" });
    expect(readAgent("")).toEqual({
      device: "other",
      os: "other",
      osMajor: null,
      browser: "other",
      inApp: null,
    });
  });
});

describe("the rough place from Vercel's headers", () => {
  it("decodes a city and cuts a coordinate to a tenth of a degree", () => {
    expect(headerText("Hat%20Yai")).toBe("Hat Yai");
    expect(headerText(null)).toBeNull();
    expect(roughCoordinate("6.86891", 90)).toBe(6.9);
    expect(roughCoordinate("101.2501", 180)).toBe(101.3);
    expect(roughCoordinate("north", 90)).toBeNull();
    expect(roughCoordinate("200", 180)).toBeNull();
  });
});

describe("sums", () => {
  it("share never divides by nothing", () => {
    expect(share(1, 0)).toBe(0);
    expect(share(1, 3)).toBe(33);
  });

  it("the funnel is a share of the phones that opened Jaga", () => {
    const steps = funnel({
      ...exampleUsage(7).totals,
      devices: 200,
      withArea: 150,
      installed: 80,
      pushOn: 40,
      signedIn: 30,
      watching: 10,
    });
    expect(steps.map((s) => [s.key, s.share])).toEqual([
      ["opened", 100],
      ["area", 75],
      ["installed", 40],
      ["push", 20],
      ["signedIn", 15],
      ["watching", 5],
    ]);
  });

  it("the week grid is Monday first and finds its busiest hour", () => {
    const g = rhythmGrid([
      { dow: 1, hour: 7, n: 3 },
      { dow: 7, hour: 20, n: 9 },
      { dow: 9, hour: 1, n: 99 },
    ]);
    expect(g.cells[0]![7]).toBe(3);
    expect(g.cells[6]![20]).toBe(9);
    expect(g.peak).toEqual({ dow: 7, hour: 20, n: 9 });
    expect(heatStep(9, 9)).toBe(5);
    expect(heatStep(0, 9)).toBe(0);
    expect(heatStep(1, 9)).toBe(1);
  });

  it("an alert's lift compares the hour after with the three hours before", () => {
    const base = Date.parse("2026-11-24T00:00:00Z");
    const hours = [2, 2, 2, 2, 10, 6].map((n, i) => ({
      t: new Date(base + i * 3_600_000).toISOString(),
      n,
    }));
    const lift = alertLift(hours, [
      { at: new Date(base + 3.5 * 3_600_000).toISOString(), level: "warning" },
    ]);
    expect(lift).toEqual([
      expect.objectContaining({ level: "warning", before: 2, after: 10, ratio: 5 }),
    ]);
    // Too early in the series to have three hours before it: left out.
    expect(alertLift(hours, [{ at: hours[1]!.t, level: "watch" }])).toEqual([]);
  });

  it("a visit's length reads as minutes and seconds", () => {
    expect(minutesAndSeconds(125.4)).toEqual({ m: 2, s: 5 });
    expect(minutesAndSeconds(null)).toBeNull();
    expect(stickiness(20, 100)).toBe(20);
    expect(stickiness(null, 100)).toBeNull();
  });

  it("the window is one of the four offered", () => {
    expect(readWindow("30")).toBe(30);
    expect(readWindow("12")).toBe(7);
    expect(readWindow(undefined)).toBe(7);
  });
});

describe("insights", () => {
  it("say nothing until enough phones have been counted", () => {
    const d = exampleUsage(7);
    expect(insights({ ...d, totals: { ...d.totals, devices: 3 } })).toEqual([]);
  });

  it("point at slow connections, low memory and missing areas in the example", () => {
    const keys = insights(exampleUsage(30)).map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(["slowNet", "noArea", "abroad"]));
  });
});

describe("toUsage", () => {
  it("reads an empty answer as nothing, never as an error", () => {
    const d = toUsage({});
    expect(d.now.live).toBe(0);
    expect(d.series).toEqual([]);
    expect(d.engagement.medianSeconds).toBeNull();
  });

  it("the example has the shape the database returns", () => {
    const d = exampleUsage(7);
    expect(toUsage(JSON.parse(JSON.stringify(d)))).toEqual(d);
    // Its days are the window, today last, and its totals add up.
    expect(d.series).toHaveLength(7);
    expect(d.series.at(-1)!.devices).toBe(d.today.devices);
    expect(d.now.tambons.reduce((a, t) => a + t.n, 0) + d.now.noArea).toBe(d.now.live);
  });
});

describe("the phone's counter", () => {
  it("makes a valid random id", () => {
    expect(newId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("a visit goes on until 30 minutes off screen", () => {
    const id = "0f8b1c2d-1111-4222-8333-444455556666";
    const now = 1_800_000_000_000;
    expect(continueSession({ id, last: now - 60_000 }, now)).toEqual({ id, last: now });
    expect(continueSession({ id, last: now - SESSION_GAP_MS - 1 }, now)).toBeNull();
    expect(continueSession({ id: "nope", last: now }, now)).toBeNull();
    expect(continueSession(null, now)).toBeNull();
  });

  it("is not counted when the browser asks not to be tracked, or in a test browser", () => {
    expect(counted({ globalPrivacyControl: true }, true)).toBe(false);
    expect(counted({ webdriver: true }, false)).toBe(false);
    expect(counted({ webdriver: true }, true)).toBe(true);
    expect(counted({}, false)).toBe(true);
  });
});
