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

/**
 * Three points off the coast, with hours either side of now, so the sea's own card has stations
 * to step through whatever the real model is doing today.
 */
async function serveSea(page: Page) {
  const hour = 3_600_000;
  const now = Date.now();
  const hours = Array.from({ length: 30 }, (_, i) => ({
    t: now - 6 * hour + i * hour,
    wave: 0.4,
    waveFrom: 45,
    wavePeriod: 6,
    wind: 12,
    windFrom: 50,
    gust: 18,
    sea: 0.2,
  }));
  await page.route("**/api/public/sea", (route) =>
    route.fulfill({
      json: {
        fetchedAt: new Date(now).toISOString(),
        points: [
          { id: "pattani", province: "94", lat: 6.98, lon: 101.35, hours },
          { id: "saiburi", province: "94", lat: 6.78, lon: 101.7, hours },
          { id: "narathiwat", province: "96", lat: 6.52, lon: 101.92, hours },
        ],
      },
    }),
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

  /** The owner, 18 Oct: the map on its own, with only the layer pickers beside it. */
  test("opens the map on its own, keeping the layer pickers and the hotlines", async ({ page }) => {
    await serve(page);
    await page.goto("/th/map");
    await expect(page.locator("[data-map-frame]")).toBeVisible();
    const before = (await page.locator("[data-map-frame]").boundingBox())!;

    await page.locator('[data-map-full-toggle="open"]').click();
    await expect(page.locator("[data-map-full]")).toHaveCount(1);

    // The dashboard goes: no readouts, no weather bar, no legend.
    await expect(page.locator("[data-console-tiles]")).toBeHidden();
    await expect(page.locator("[data-console-sky]")).toBeHidden();
    await expect(page.locator("[data-legend]")).toBeHidden();

    // What is left beside the map is what decides what the map draws - including the two the
    // owner asked to bring over, the satellite's flood and the safe places.
    await expect(page.locator('[data-map-features="map"]')).toBeVisible();
    await expect(page.locator("[data-satellite]")).toBeVisible();
    await expect(page.locator("[data-map-layers]")).toHaveCount(1);
    // The basemap is no longer a panel in the rail; it is a button on the map itself.
    await expect(page.locator("[data-basemap] legend")).toBeHidden();
    await expect(page.locator("[data-map-basemap-picker]")).toBeVisible();
    await page.locator("[data-basemap-open]").click();
    // The same buttons as the panel's, drawn on the map; the panel's own copy stays hidden.
    await expect(
      page.locator('[data-map-basemap-picker] [data-basemap-choice="terrain"]'),
    ).toBeVisible();

    // The map is bigger than it was, and the way out is beside it.
    const after = (await page.locator("[data-map-frame]").boundingBox())!;
    expect(after.height).toBeGreaterThan(before.height);
    await expect(page.locator("[data-map-full-exit]")).toBeVisible();

    /*
     * Safety rule 4: the hotlines are one tap away, always. The bar keeps its place at the foot
     * of the screen and the map stops above it, so neither hides the other.
     */
    const hotlines = (await page.locator("footer").boundingBox())!;
    await expect(page.locator("footer")).toBeVisible();
    expect(after.y + after.height).toBeLessThanOrEqual(hotlines.y + 1);

    // Escape comes back out, as it does from anything that fills the screen.
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-map-full]")).toHaveCount(0);
    await expect(page.locator("[data-console-tiles]")).toBeVisible();
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

  /*
   * The owner, 18 Oct: the readouts small by default, opening on hover, pinned if the reader
   * wants one kept - "the idea is to have more visible on Map part".
   */
  test("the readouts are small until asked for, and a pinned one stays open", async ({ page }) => {
    await serve(page);
    await page.goto("/th/map");
    await expect(page.locator("[data-console-tiles]")).toBeVisible();

    const strip = page.locator("[data-console-tiles]");
    const small = (await strip.boundingBox())!.height;
    const map = (await page.locator("[data-map-frame]").boundingBox())!.height;
    // Small, every card still answers its own question: the figure is never what is held back.
    await expect(page.locator('[data-console-tile="gauges"]')).toContainText(
      th.map.console.gauges.over.replace("{count}", "1"),
    );
    const more = page.locator('[data-console-tile="gauges"] [data-tile-more]');
    await expect(more).toBeHidden();

    // Resting the pointer on one opens it over the map, and the map does not move under it.
    await page.locator('[data-console-tile="gauges"]').hover();
    await expect(more).toBeVisible();
    /*
     * Over the map, not behind it (the owner, 18 Oct: "it's behind the map, so the expanded
     * details can't be read"). The strip and the columns below it all sit at the same height in
     * the page, so what the browser paints at the foot of an opened card is the test.
     */
    const card = page.locator('[data-console-tile="gauges"] [data-tile-card]');
    const box = (await card.boundingBox())!;
    const onTop = await page.evaluate(
      (at: { x: number; y: number }) =>
        document
          .elementFromPoint(at.x, at.y)
          ?.closest("[data-console-tile]")
          ?.getAttribute("data-console-tile") ?? null,
      { x: box.x + box.width / 2, y: box.y + box.height - 6 },
    );
    expect(onTop).toBe("gauges");
    expect((await strip.boundingBox())!.height).toBe(small);
    expect((await page.locator("[data-map-frame]").boundingBox())!.height).toBe(map);

    // Pinned, it keeps its room in the strip and stays open with the pointer elsewhere.
    await page.locator('[data-console-tile="gauges"] [data-tile-pin]').click();
    await page.mouse.move(700, 800);
    await expect(more).toBeVisible();
    expect((await strip.boundingBox())!.height).toBeGreaterThan(small);
    // Unpinned, it is small again - once the pin itself no longer holds the keyboard, which
    // keeps a card open on purpose for anyone reading it without a mouse.
    const pin = page.locator('[data-console-tile="gauges"] [data-tile-pin]');
    await pin.click();
    await pin.blur();
    await page.mouse.move(700, 800);
    await expect(more).toBeHidden();
  });

  /** The owner, 18 Oct: the right panel folds away so the map has the room. */
  test("the side panel folds away, peeks on hover, and comes back on a tap", async ({ page }) => {
    await serve(page);
    await page.goto("/th/map");
    await expect(page.locator("[data-map-frame]")).toBeVisible();
    const wide = (await page.locator("[data-map-frame]").boundingBox())!.width;
    const basemap = page.locator('[data-console-area="side"] [data-basemap]');

    await page.locator("[data-side-toggle]").click();
    await expect(page.locator("[data-map-console]")).toHaveAttribute("data-side", "closed");
    /*
     * Folded, it is folded at once: the button that folds it is itself the strip, so the panel
     * must not stand open under the pointer that has just pressed it. The peek waits until the
     * pointer has left (data-side-peek).
     */
    await expect(basemap).toBeHidden();
    await page.mouse.move(700, 800);
    expect((await page.locator("[data-map-frame]").boundingBox())!.width).toBeGreaterThan(wide);

    // The pointer on the folded strip brings the panel back over the map for as long as wanted.
    await page.locator('[data-console-area="side"]').hover();
    await expect(basemap).toBeVisible();

    // The way back is never hidden, so the panel can always be opened again.
    await page.locator("[data-side-toggle]").click();
    await expect(page.locator("[data-map-console]")).toHaveAttribute("data-side", "open");
    await expect(basemap).toBeVisible();
  });

  /*
   * The owner, 18 Oct: pressing the rivers' or the reservoir's readout "should bring to detail
   * the same like Dam button". The other two stay readouts, which is what the whole strip was.
   */
  test("the rivers' and the reservoir's readouts open what they are about", async ({ page }) => {
    await serve(page);
    await page.goto("/th/map");
    await expect(page.locator("[data-console-tiles]")).toBeVisible();

    // The rivers: the station that matters most - here the one over its bank - with its card.
    await page.locator('[data-console-tile="gauges"] [data-tile-open]').click();
    const panel = page.locator("[data-selected-panel]");
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(th.map.gauge.above_warning);
    // And the map says which one it means, for a moment.
    const frame = page.locator("[data-map-frame] [data-map-lit]");
    await expect(frame).toHaveAttribute("data-map-lit", /.+/, { timeout: 4000 });
    await expect(frame).toHaveAttribute("data-map-lit", "", { timeout: 8000 });

    // The reservoir: the same card its own button opens.
    await page.locator('[data-console-tile="dam"] [data-tile-open]').click();
    await expect(panel).toBeVisible();
    await expect(frame).toHaveAttribute("data-map-lit", /.+/, { timeout: 4000 });

    // The other two are still readouts: nothing in them to press.
    for (const tile of ["alerts", "reports"]) {
      await expect(page.locator(`[data-console-tile="${tile}"] [data-tile-open]`)).toHaveCount(0);
    }
  });

  test("pinning a readout that opens does not open it", async ({ page }) => {
    await serve(page);
    await page.goto("/th/map");
    await expect(page.locator("[data-console-tiles]")).toBeVisible();
    const tile = page.locator('[data-console-tile="dam"]');
    await tile.hover();
    await tile.locator("[data-tile-pin]").click();
    await expect(tile).toHaveAttribute("data-tile-pinned", "true");
    await expect(page.locator("[data-selected-panel]")).toHaveCount(0);
  });

  /*
   * The owner, 18 Oct: in the full-screen map the sea's button "does not open anything when
   * clicked... it should open a dialog box with the details... within the map but at the left
   * edge", and a reader in the details should be able to step to the next station.
   */
  test("on its own, the map answers a tap in a dialog beside the pickers", async ({ page }) => {
    await serve(page);
    await serveSea(page);
    await page.goto("/en/map");
    await expect(page.locator("[data-map-frame]")).toBeVisible();
    await page.locator('[data-map-full-toggle="open"]').click();
    await expect(page.locator("[data-map-full]")).toBeVisible();

    await page.locator("[data-open-sea]:visible").first().click();
    const dialog = page.locator("[data-selected-panel]");
    await expect(dialog).toBeVisible();
    /*
     * The map lights the point being read (the owner, 18 Oct: it "should highlight the points of
     * the tide measurement"). Checked first of all, because the lighting is three pulses and
     * then over - a check made after a page full of measurements would be racing it.
     */
    const lit = page.locator("[data-map-frame] [data-map-lit]");
    await expect(lit).toHaveAttribute("data-map-lit", "pattani", { timeout: 4000 });
    // Inside the map and beside the left panel, not off in the hidden right rail.
    const panel = (await page.locator('[data-console-area="rail"]').boundingBox())!;
    const box = (await dialog.boundingBox())!;
    const map = (await page.locator("[data-map-frame]").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(panel.x + panel.width - 1);
    expect(box.x).toBeLessThan(map.x + map.width / 2);

    // One station at a time, in order along the coast, each lit as it is chosen.
    const chosen = page.locator("[data-sea-point][aria-pressed=true]");
    await expect(chosen).toContainText("Pattani");
    await page.locator('[data-sea-step="next"]').click();
    await expect(lit).toHaveAttribute("data-map-lit", "saiburi", { timeout: 4000 });
    await expect(chosen).toContainText("Sai Buri");
    await page.locator('[data-sea-step="previous"]').click();
    await expect(chosen).toContainText("Pattani");

    // Its own way out, reachable without scrolling to the end of the report, and Escape shuts
    // the dialog before it leaves the full screen.
    const close = dialog.locator("button").last();
    await expect(close).toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("[data-map-full]")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-map-full]")).toHaveCount(0);
  });

  /*
   * The owner, 18 Oct: a dam's button should bring the map to the reservoir itself, closer than
   * the dam's own view and with the lake in the middle, and light it three times.
   */
  test("a reservoir's button brings the map to the lake and lights it", async ({ page }) => {
    await serve(page);
    await page.goto("/en/map");
    await expect(page.locator("[data-map-frame]")).toBeVisible();
    const button = page.locator("[data-open-dam]:visible").first();
    await button.scrollIntoViewIfNeeded();
    await button.click();
    // It lights, and it stops lighting: three pulses and then dark again (lib/dam-map.ts).
    const frame = page.locator("[data-map-frame] [data-map-lit]");
    await expect(frame).toHaveAttribute("data-map-lit", /.+/, { timeout: 4000 });
    await expect(frame).toHaveAttribute("data-map-lit", "", { timeout: 8000 });
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
    // The full-screen map is the console's; a phone's map is already as wide as the screen.
    await expect(page.locator("[data-map-full-toggle]")).toBeHidden();
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

/*
 * The live monitoring (the owner, 17 Oct 2026). It is one card, and it is drawn in a different
 * place on each kind of screen: the console's fifth readout with a band under the dashboard, and
 * a card under the map legend on a phone and a tablet. Both halves are checked here, because the
 * pair is the promise - a change that gains the console and costs the phone is not a win.
 */
test.describe("the live monitoring card", () => {
  test.use({ serviceWorkers: "block" });

  test("sits under the map legend on a phone, with the dam buttons beneath it", async ({
    page,
  }) => {
    await serve(page);
    await serveWeather(page);
    await page.goto("/th/map");
    const card = page.locator('[data-monitoring-card="map"]');
    await expect(card).toBeVisible();

    // Under the legend, and the way into each reservoir under that (the owner's two placements).
    const legend = await page.locator("[data-legend]").boundingBox();
    const box = await card.boundingBox();
    expect(box!.y).toBeGreaterThan(legend!.y);
    const dams = page.locator("[data-dam-legend]");
    if ((await dams.count()) > 0) {
      const damBox = await dams.boundingBox();
      expect(damBox!.y).toBeGreaterThan(box!.y);
    }

    // The status in a line, with a mark that moves, and no level anywhere on it.
    await expect(card.locator("[data-monitoring-status]")).toBeVisible();
    await expect(card.locator("[data-monitoring-pulse]")).toBeVisible();
    await expect(card.locator("[data-level]")).toHaveCount(0);
    await expect(card).toContainText(th.monitoring.notAnAlert);
    await noSidewaysScrollOnMap(page);
  });

  test("keeps its detail shut until it is asked for, then shows the whole of it", async ({
    page,
  }) => {
    await serve(page);
    await serveWeather(page);
    await page.goto("/th/map");
    const card = page.locator('[data-monitoring-card="map"]');
    await expect(card).toBeVisible();
    await expect(card.locator("[data-monitoring-detail]")).toHaveCount(0);

    await card.locator("[data-monitoring-open]").click();
    const detail = card.locator("[data-monitoring-detail]");
    await expect(detail).toBeVisible();
    // Opening it has to bring the reader to it (the owner, 17 Oct), not just put it in the page.
    await expect(detail).toBeInViewport();
    // Their own level first, then the province, then the measurements, then the charts.
    await expect(
      detail.locator('[data-monitoring-part="area"] [data-level="warning"]'),
    ).toBeVisible();
    await expect(detail.locator('[data-console-level="warning"]')).toContainText("1");
    await expect(detail.locator('[data-monitoring-note="gauges"]')).toContainText(
      th.monitoring.gauges.who,
    );
    await expect(detail.locator("[data-monitoring-chart]").first()).toBeVisible();

    /*
     * And it shuts from its own foot, which puts the reader back at the top of the dashboard
     * (the owner, 17 Oct). The way in is a long way up by the time the charts have drawn.
     */
    await detail.locator("[data-monitoring-hide]").click();
    await expect(card.locator("[data-monitoring-detail]")).toHaveCount(0);
    await expect(page.locator("[data-map-console]")).toBeInViewport();
    await expect(card.locator("[data-monitoring-open]")).toBeFocused();
  });

  test("tells a visitor with no area saved, and shows them no level of their own", async ({
    page,
  }) => {
    await serve(page);
    await page.goto("/th/map");
    const card = page.locator('[data-monitoring-card="map"]');
    await expect(card).toBeVisible();
    await card.locator("[data-monitoring-open]").click();
    await expect(card.locator("[data-monitoring-noarea]")).toContainText(
      th.monitoring.detail.noArea.slice(0, 25),
    );
    await expect(card.locator('[data-monitoring-part="area"]')).toHaveCount(0);
  });

  /*
   * The rule the whole feature rests on: a feed that could not be read must say so. A reader
   * told "no resident report stands" when the request failed has an all-clear nobody wrote
   * (safety rule 10).
   */
  test("says a feed could not be read, never that there is nothing to report", async ({ page }) => {
    await serve(page);
    await serveWeather(page);
    await page.route("**/api/public/reports", (route) =>
      route.fulfill({ status: 503, json: { error: "unavailable" } }),
    );
    await page.goto("/th/map");
    const card = page.locator('[data-monitoring-card="map"]');
    await expect(card).toBeVisible();
    await card.locator("[data-monitoring-open]").click();
    const reports = card.locator('[data-monitoring-note="reports"]');
    await expect(reports).toHaveAttribute("data-monitoring-say", "unknown");
    await expect(reports).toContainText(th.monitoring.reports.unknown);
    await expect(card).not.toContainText(th.monitoring.reports.quiet.slice(0, 30));
    await expect(card.locator("[data-monitoring-incomplete]")).toBeVisible();
  });

  test.describe("on a laptop", () => {
    test.use({
      viewport: { width: 1440, height: 900 },
      isMobile: false,
      hasTouch: false,
      deviceScaleFactor: 1,
    });

    test("is the fifth readout, and its detail opens under the dashboard", async ({ page }) => {
      await serve(page);
      await serveWeather(page);
      await page.goto("/th/map");

      // Five readouts across the top, and the card itself is not drawn in either rail.
      const tile = page.locator('[data-console-tile="monitoring"]');
      await expect(tile).toBeVisible();
      await expect(page.locator("[data-console-tiles]")).toHaveAttribute("data-console-count", "5");
      await expect(page.locator('[data-monitoring-card="map"]')).toBeHidden();
      await expect(page.locator('[data-console-area="rail"] [data-monitoring-card]')).toHaveCount(
        0,
      );

      // The band is shut, the map has its height, and nothing is below the rails.
      await expect(page.locator('[data-console-area="detail"]')).toHaveCount(0);
      const frame = await page.locator("[data-map-frame]").boundingBox();
      expect(frame!.height).toBeGreaterThan(280);

      // Opened from the tile, it is a band under the three columns.
      await tile.locator("[data-monitoring-open]").click();
      const band = page.locator('[data-console-area="detail"]');
      await expect(band).toBeVisible();
      /*
       * And the page goes to it. The band opens below the three columns, so without this the
       * click looks as though it did nothing - the trap the reservoir's card fell into on
       * 14 Oct, and the reason both share lib/reveal.ts.
       */
      await expect(band).toBeInViewport();
      const [bandBox, mapBox] = await Promise.all([
        band.boundingBox(),
        page.locator('[data-console-area="map"]').boundingBox(),
      ]);
      expect(bandBox!.y).toBeGreaterThan(mapBox!.y);
      await expect(
        band.locator('[data-monitoring-part="area"] [data-level="warning"]'),
      ).toBeVisible();
      await expect(band.locator("[data-monitoring-chart]").first()).toBeVisible();

      // Shut from the foot of the band: the band goes, and the dashboard is back at the top.
      await band.locator("[data-monitoring-hide]").click();
      await expect(page.locator('[data-console-area="detail"]')).toHaveCount(0);
      await expect(page.locator("[data-console-tiles]")).toBeInViewport();
      await expect(tile.locator("[data-monitoring-open]")).toBeFocused();
    });

    test("agrees with the readout strip beside it", async ({ page }) => {
      await serve(page);
      await serveWeather(page);
      await page.goto("/th/map");
      await page.locator('[data-console-tile="monitoring"] [data-monitoring-open]').click();
      // Both count the same warning, because both count it with the same function.
      await expect(
        page.locator('[data-console-area="detail"] [data-console-level="warning"]'),
      ).toContainText("1");
      await expect(
        page.locator('[data-console-tile="alerts"] [data-console-level="warning"]'),
      ).toContainText("1");
    });
  });
});

/** No sideways scroll at 360 px, which every block above the map has to keep. */
async function noSidewaysScrollOnMap(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
}
