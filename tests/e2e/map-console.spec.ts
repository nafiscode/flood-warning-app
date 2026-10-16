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
    // One tambon at Warning: the badge carries the word, and the count is beside it.
    const warning = page.locator('[data-console-level="warning"]');
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

  test("a hazard still to come is a placeholder, never an empty console", async ({ page }) => {
    await serve(page);
    await page.goto("/th/map");
    await page.locator("[data-hazard=fire]").click();
    // Safety rule 10: no data layer, no all-clear, and no dashboard dressing either.
    await expect(page.locator("[data-map-console]")).toHaveCount(0);
    await expect(page.locator("[data-console-tiles]")).toHaveCount(0);
    await expect(page.locator("[data-map-frame]")).toHaveCount(0);
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

    // The readout strip is a laptop's; a 360 px screen never pays a pixel for it.
    await expect(page.locator("[data-console-tiles]")).toBeHidden();
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
