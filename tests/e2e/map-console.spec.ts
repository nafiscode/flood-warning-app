/**
 * The laptop console (the owner, 16 Oct 2026): on a wide screen with a mouse the live map is an
 * operations dashboard, and on every phone and tablet it is exactly the single column it always
 * was. Both halves of that promise are checked here, in one file, because it is the pair that
 * matters: a change that gains the console and costs the phone is not a win.
 */
import { expect, type Page, test } from "@playwright/test";
import th from "../../messages/th.json";

const BANA = { code: "940104", nameTh: "บานา", nameEn: "Bana" };

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

const HAZARDS = [
  {
    code: "flood",
    status: "active",
    name: { th: "น้ำท่วม" },
    description: {},
    placeholder: {},
    hotline: "1784",
  },
  {
    code: "fire",
    status: "coming_soon",
    name: { th: "ไฟไหม้" },
    description: {},
    placeholder: { th: "ยังไม่มีการเตือนภัยนี้ ไม่ได้แปลว่าไม่มีความเสี่ยง" },
    hotline: "199",
  },
];

const AREAS = {
  provinces: [{ code: "94", nameTh: "ปัตตานี", nameEn: "Pattani", status: "active" }],
  tambons: [
    {
      code: BANA.code,
      nameTh: BANA.nameTh,
      nameEn: BANA.nameEn,
      districtCode: "9401",
      districtTh: "เมืองปัตตานี",
      districtEn: "Mueang Pattani",
      provinceCode: "94",
      lat: 6.87821,
      lon: 101.27191,
    },
  ],
};

const GAUGES = [
  {
    id: "g-over",
    name: { th: "สถานีหนึ่ง" },
    lat: 6.8,
    lon: 101.2,
    value: 9.1,
    observedAt: minutes(-20),
    status: "above_warning",
    bank: 8.8,
  },
  {
    id: "g-ok",
    name: { th: "สถานีสอง" },
    lat: 6.6,
    lon: 101.4,
    value: 2.1,
    observedAt: minutes(-20),
    status: "normal",
    bank: 8,
  },
];

const ALERT = {
  id: "e2e-console",
  hazard: "flood",
  level: "warning",
  reason: "ระดับน้ำสูงขึ้น",
  messages: { th: "ข้อความทดสอบ" },
  issuedAt: minutes(-60),
  nextUpdateAt: minutes(120),
  onset: null,
  returnWindow: null,
  source: null,
  tambons: [BANA.code],
};

async function serve(page: Page) {
  await page.route("**/api/public/status", (route) =>
    route.fulfill({
      json: { generatedAt: new Date().toISOString(), inService: true, alerts: [ALERT] },
    }),
  );
  await page.route("**/api/public/map", (route) =>
    route.fulfill({ json: { places: [], reports: [], gauges: GAUGES } }),
  );
  await page.route("**/api/public/gauges", (route) => route.fulfill({ json: { gauges: GAUGES } }));
  await page.route("**/api/public/places*", (route) =>
    route.fulfill({ json: { people: [], parking: [] } }),
  );
  await page.route("**/api/public/hazards", (route) =>
    route.fulfill({ json: { hazards: HAZARDS } }),
  );
  await page.route("**/api/geo/areas", (route) => route.fulfill({ json: AREAS }));
  await page.route("**/api/public/reports", (route) =>
    route.fulfill({ json: { generatedAt: new Date().toISOString(), tambons: [] } }),
  );
  await page.route("**/api/public/weather**", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
}

/** A clear day over Bana, and the area chosen on this device, so the console has a sky to draw. */
async function serveWeather(page: Page) {
  await page.addInitScript(
    (area) => window.localStorage.setItem("jaga.area", JSON.stringify(area)),
    {
      code: BANA.code,
      nameTh: BANA.nameTh,
      nameEn: BANA.nameEn,
      districtTh: "เมืองปัตตานี",
      districtEn: "Mueang Pattani",
      provinceTh: "ปัตตานี",
      provinceEn: "Pattani",
      lat: 6.87821,
      lon: 101.27191,
      from: "list",
    },
  );
  await page.route("**/api/public/weather?**", (route) =>
    route.fulfill({
      json: {
        lat: 6.87821,
        lon: 101.27191,
        timezone: "Asia/Bangkok",
        at: new Date().toISOString(),
        tempC: 28.2,
        feelsC: 34,
        humidity: 80,
        rainMm: 0,
        windKmh: 5,
        windFrom: "se",
        isDay: true,
        code: 0,
        hours: [],
        days: [],
      },
    }),
  );
}

/** Where a block sits on the page, so two layouts can be compared without reading pixels by eye. */
const boxOf = (page: Page, selector: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top + window.scrollY), left: Math.round(r.left) };
  }, selector);

const BLOCKS = [
  "#map-province",
  '[data-map-features="map"]',
  "[data-mode=risk]",
  "[data-map-frame]",
  "[data-basemap]",
  "[data-legend]",
];

test.describe("the live map on a laptop", () => {
  test.use({
    serviceWorkers: "block",
    viewport: { width: 1440, height: 900 },
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
  });

  test("is a dashboard: a rail, the map and a rail, edge to edge", async ({ page }) => {
    await serve(page);
    await page.goto("/th/map");
    await expect(page.locator("[data-map-frame]")).toBeVisible();

    const shell = page.locator("[data-map-console]");
    await expect(shell).toHaveCSS("display", "grid");
    // The page runs the full width of the screen: no empty margins beside the console.
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector("#main")!).maxWidth),
    ).toBe("none");

    // Three columns: the rail, the map and the rail, left to right.
    const [rail, map, side] = await Promise.all([
      boxOf(page, '[data-console-area="rail"]'),
      boxOf(page, '[data-console-area="map"]'),
      boxOf(page, '[data-console-area="side"]'),
    ]);
    expect(rail!.left).toBeLessThan(map!.left);
    expect(map!.left).toBeLessThan(side!.left);

    // Each rail scrolls by itself, so the map never leaves the screen while a card is read.
    for (const area of ["rail", "side"]) {
      await expect(page.locator(`[data-console-area="${area}"]`)).toHaveCSS("overflow-y", "auto");
    }

    // The map is given real height, not a strip.
    const frame = await page.locator("[data-map-frame]").boundingBox();
    expect(frame!.height).toBeGreaterThan(280);
  });

  test("reads out the four figures, and says the level in words, not by colour", async ({
    page,
  }) => {
    await serve(page);
    await page.goto("/th/map");
    await expect(page.locator("[data-console-tiles]")).toBeVisible();

    for (const tile of ["alerts", "gauges", "dam", "reports"]) {
      await expect(page.locator(`[data-console-tile="${tile}"]`)).toBeVisible();
    }
    /*
     * One tambon at Warning: the badge carries the word, and the count is beside it. Scoped to
     * the alerts tile, because the summary above the map counts the same levels with the same
     * component (17 Oct) - which is the point of sharing it, and makes a page-wide locator two.
     */
    const warning = page.locator('[data-console-tile="alerts"] [data-console-level="warning"]');
    await expect(warning).toContainText(th.alert.level.warning);
    await expect(warning).toContainText("1");
    // A measurement is never dressed as an alert level (safety rule 2).
    await expect(page.locator('[data-console-tile="gauges"] [data-level]')).toHaveCount(0);
    await expect(page.locator('[data-console-tile="gauges"]')).toContainText(
      th.map.console.gauges.over.replace("{count}", "1"),
    );
    // Every tile says how far it reaches and how old it is.
    await expect(page.locator('[data-console-tile="gauges"]')).toContainText(
      th.map.console.scope.all,
    );
  });

  test("the readouts never blink for anyone but an admin", async ({ page }) => {
    await serve(page);
    await page.goto("/th/map");
    await expect(page.locator("[data-console-tiles]")).toBeVisible();
    /*
     * This visitor is signed out, and a warning is in force with a gauge over its bank - the very
     * state that makes an admin's console ask for a look. For everyone else the figures are the
     * same and the screen is still (the owner, 16 Oct: these only appear for an admin).
     */
    await expect(page.locator('[data-console-tile="alerts"]')).toContainText(
      th.alert.level.warning,
    );
    await expect(page.locator("[data-console-tile][data-console-alarm]")).toHaveCount(0);
  });

  test("a hazard still to come is a placeholder, never an empty console", async ({ page }) => {
    await serve(page);
    await page.goto("/th/map");
    await page.locator("[data-hazard=fire]").click();
    // Safety rule 10: no data layer, no all-clear, and no dashboard dressing either.
    await expect(page.locator("[data-map-console]")).toHaveCount(0);
    await expect(page.locator("[data-console-tiles]")).toHaveCount(0);
    await expect(page.locator("[data-map-frame]")).toHaveCount(0);
  });

  test("carries the weather behind it, and says what it is, under a veil that keeps the words readable", async ({
    page,
  }) => {
    await serve(page);
    await serveWeather(page);
    await page.goto("/th/map");
    await expect(page.locator("[data-map-frame]")).toBeVisible();

    // The same sky the weather page and the header's pill draw, for the weather where they are.
    const sky = page.locator("[data-console-sky]");
    // Clear weather; whether that is a day sky or a night one is the clock's business, and this
    // test must pass after sunset as well as before it.
    await expect(sky).toHaveAttribute("data-console-sky", /^clear(Day|Night)$/);
    await expect(sky.locator("[data-weather-scene]")).toHaveCount(1);
    // It is decoration and says so.
    await expect(sky).toHaveAttribute("aria-hidden", "true");
    // The grid of lines it replaced is gone (the owner, 16 Oct).
    await expect(page.locator("[data-map-console]")).toHaveCSS("background-image", "none");

    /*
     * It is a bar across the top and no further (the owner, 16 Oct): the title, the weather and
     * the hazard buttons sit on it, and the readouts and the rails below it do not. It runs the
     * full width of the screen.
     */
    const box = async (selector: string) => await page.locator(selector).boundingBox();
    const [bar, chips, tiles, rail] = await Promise.all([
      box("[data-console-sky]"),
      box('[data-console-area="hazard"]'),
      box("[data-console-tiles]"),
      box('[data-console-area="rail"]'),
    ]);
    expect(bar!.x).toBe(0);
    expect(Math.round(bar!.width)).toBe(page.viewportSize()!.width);
    // It reaches past the hazard buttons, and stops before the readouts and the rails.
    expect(bar!.y + bar!.height).toBeGreaterThan(chips!.y + chips!.height);
    expect(bar!.y + bar!.height).toBeLessThanOrEqual(tiles!.y);
    expect(bar!.y + bar!.height).toBeLessThan(rail!.y);

    // The province list rides in the bar with the hazard buttons (the owner, 16 Oct), not at the
    // top of the left rail, and the note that explains it stays beside it (safety rule 10).
    const prov = await box("[data-console-province]");
    expect(prov!.y).toBeGreaterThanOrEqual(bar!.y);
    expect(prov!.y + prov!.height).toBeLessThanOrEqual(bar!.y + bar!.height + 2);
    expect(prov!.y).toBeLessThan(rail!.y);
    await expect(page.locator("[data-console-province] [data-not-covered-note]")).toBeVisible();

    // The weather in words, in the empty half of the first line.
    const readout = page.locator("[data-console-weather]");
    await expect(readout).toBeVisible();
    await expect(readout).toContainText("28");
    await expect(readout).toContainText(th.weather.codes.clear);
  });

  test("the frozen chip row stays off: the rail already keeps the switches in view", async ({
    page,
  }) => {
    await serve(page);
    await page.goto("/th/map");
    await expect(page.locator("[data-map-frame]")).toBeVisible();
    await page.mouse.wheel(0, 1200);
    await page.waitForTimeout(300);
    const float = page.locator("[data-map-chips-float]");
    if ((await float.count()) > 0) await expect(float).toBeHidden();
  });
});

test.describe("the live map on a phone is untouched", () => {
  // The project's own 360x640 Android, which is what this must not change.
  test.use({ serviceWorkers: "block" });

  test("has no console: one column, in the order it has always been in", async ({ page }) => {
    await serve(page);
    await page.goto("/th/map");
    await expect(page.locator("[data-map-frame]")).toBeVisible();

    // The readout strip and the weather sky are a laptop's; a 360 px screen never pays a pixel
    // for either, and the sky is display:none so it is not even animated there.
    await expect(page.locator("[data-console-tiles]")).toBeHidden();
    const sky = page.locator("[data-console-sky]");
    if ((await sky.count()) > 0) await expect(sky).toBeHidden();
    const readout = page.locator("[data-console-weather]");
    if ((await readout.count()) > 0) await expect(readout).toBeHidden();
    // The wrappers that make the console vanish entirely here.
    for (const area of ["rail", "map", "side"]) {
      await expect(page.locator(`[data-console-area="${area}"]`)).toHaveCSS("display", "contents");
    }

    const tops: number[] = [];
    const lefts: number[] = [];
    for (const selector of BLOCKS) {
      const box = await boxOf(page, selector);
      if (!box) continue;
      tops.push(box.top);
      lefts.push(box.left);
    }
    expect(tops.length).toBeGreaterThan(4);
    // Straight down the page, one block after another, and all in the same column.
    expect([...tops].sort((a, b) => a - b)).toEqual(tops);
    expect(new Set(lefts).size).toBe(1);
  });
});

/*
 * The overview summary above the map (the owner, 17 Oct 2026). Its whole reason for existing is
 * the phone: until now a 360 px screen saw no overall status on this page at all until it tapped
 * a subdistrict. So it is checked on a phone first, and then on a laptop for agreement with the
 * readout strip beside it.
 */
test.describe("where things stand, above the map", () => {
  test.use({ serviceWorkers: "block" });

  test("gives a phone its own level and the province, above the map", async ({ page }) => {
    await serve(page);
    await serveWeather(page);
    await page.goto("/th/map");
    const summary = page.locator("[data-map-summary]");
    await expect(summary).toBeVisible();

    // Above the map, which is the gap it was added to fill.
    const card = await summary.boundingBox();
    const frame = await page.locator("[data-map-frame]").boundingBox();
    expect(card!.y).toBeLessThan(frame!.y);

    // Their own subdistrict first, with the level and everything it must carry (safety rule 3).
    const mine = summary.locator('[data-map-summary-part="area"]');
    await expect(mine).toContainText(BANA.nameTh);
    await expect(mine.locator('[data-level="warning"]')).toBeVisible();
    await expect(mine).toContainText(th.home.nextUpdate);

    // Then the province around them.
    await expect(summary.locator('[data-console-level="warning"]')).toContainText("1");

    // And no horizontal scroll at 360 px.
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });

  test("tells a visitor with no area saved, and shows them no level", async ({ page }) => {
    await serve(page);
    await page.goto("/th/map");
    const summary = page.locator("[data-map-summary]");
    await expect(summary).toBeVisible();
    await expect(summary.locator("[data-map-summary-noarea]")).toContainText(
      th.map.summary.noArea.slice(0, 25),
    );
    // Nobody has said where they are: there is nothing to grade, so no level is drawn.
    await expect(summary.locator('[data-map-summary-part="area"] [data-level]')).toHaveCount(0);
  });

  test("says what the monitoring shows, as measurements and not as a level", async ({ page }) => {
    await serve(page);
    await serveWeather(page);
    await page.goto("/th/map");
    const section = page.locator('[data-monitoring="map"]');
    await expect(section).toBeVisible();

    // One gauge over its bank, of the two served: a measurement, in words.
    await expect(section.locator('[data-monitoring-note="gauges"]')).toContainText(
      th.monitoring.gauges.who,
    );
    // Nothing in the section wears an alert hue, a badge or a pill (safety rule 2).
    await expect(section.locator("[data-level]")).toHaveCount(0);
    await expect(section.locator("[data-dam-chip]")).toHaveCount(0);
    expect(
      await section.evaluate((el) =>
        [...el.querySelectorAll("*")].some((e) =>
          /alert-(normal|watch|warning|evacuate|return|stale)/.test(e.className ?? ""),
        ),
      ),
    ).toBe(false);
    // It says whose figures these are, and that a level comes only from a person.
    await expect(section).toContainText(th.monitoring.caption.slice(0, 30));
  });

  /*
   * The rule the whole feature rests on: a feed that could not be read must say so. A reader
   * who is told "no resident report stands" when the request failed has been given an all-clear
   * nobody wrote (safety rule 10).
   */
  test("says a feed could not be read, never that there is nothing to report", async ({ page }) => {
    await serve(page);
    await serveWeather(page);
    await page.route("**/api/public/reports", (route) =>
      route.fulfill({ status: 503, json: { error: "unavailable" } }),
    );
    await page.goto("/th/map");
    const reports = page.locator('[data-monitoring-note="reports"]');
    await expect(reports).toBeVisible();
    await expect(reports).toHaveAttribute("data-monitoring-say", "unknown");
    await expect(reports).toContainText(th.monitoring.reports.unknown);
    // And not the quiet sentence, which would read as "the water has gone".
    await expect(page.locator('[data-monitoring="map"]')).not.toContainText(
      th.monitoring.reports.quiet.slice(0, 30),
    );
    // The section also warns that the list is short of something.
    await expect(page.locator("[data-monitoring-incomplete]")).toBeVisible();
  });

  test.describe("on a laptop", () => {
    test.use({
      viewport: { width: 1440, height: 900 },
      isMobile: false,
      hasTouch: false,
      deviceScaleFactor: 1,
    });

    test("agrees with the readout strip beside it, and leaves the map its height", async ({
      page,
    }) => {
      await serve(page);
      await serveWeather(page);
      await page.goto("/th/map");
      await expect(page.locator("[data-map-summary]")).toBeVisible();
      await expect(page.locator("[data-console-tiles]")).toBeVisible();

      // Both count the same warning, because both count it with the same function.
      await expect(
        page.locator('[data-map-summary] [data-console-level="warning"]'),
      ).toContainText("1");
      await expect(
        page.locator('[data-console-tile="alerts"] [data-console-level="warning"]'),
      ).toContainText("1");

      // The card lives in the rail, which scrolls by itself, so the map keeps its height.
      const frame = await page.locator("[data-map-frame]").boundingBox();
      expect(frame!.height).toBeGreaterThan(280);
    });
  });
});
