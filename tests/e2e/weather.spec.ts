/**
 * The weather chip in the header and the weather page, in a real browser at 360 px.
 * Open-Meteo is never called from a test: /api/public/weather and /api/public/geocode are
 * answered here, which also proves the screens read our own shape and nothing else.
 */
import { expect, type Page, test } from "@playwright/test";
import th from "../../messages/th.json";

const BANA = {
  code: "940104",
  nameTh: "บานา",
  nameEn: "Bana",
  districtTh: "เมืองปัตตานี",
  districtEn: "Mueang Pattani",
  provinceTh: "ปัตตานี",
  provinceEn: "Pattani",
  lat: 6.87821,
  lon: 101.27191,
  from: "list",
};

const HOUR = 3_600_000;

function weather(at = Date.now()) {
  const start = Math.floor(at / HOUR) * HOUR;
  return {
    lat: 6.88,
    lon: 101.27,
    timezone: "Asia/Bangkok",
    at: new Date(at).toISOString(),
    tempC: 27.4,
    feelsC: 32.1,
    humidity: 88,
    rainMm: 2.6,
    windKmh: 14,
    windFrom: "ne",
    isDay: true,
    code: 65,
    hours: Array.from({ length: 48 }, (_, i) => ({
      at: new Date(start + i * HOUR).toISOString(),
      tempC: 26 + (i % 7),
      code: i % 5 === 0 ? 61 : 3,
      rainMm: i % 5 === 0 ? 1.5 : 0,
      chance: i % 5 === 0 ? 70 : 20,
      isDay: true,
    })),
    days: Array.from({ length: 7 }, (_, d) => ({
      date: new Date(start + d * 24 * HOUR).toISOString().slice(0, 10),
      at: new Date(start + d * 24 * HOUR).toISOString(),
      code: 80,
      maxC: 30,
      minC: 24,
      rainMm: 12.5,
      chance: 80,
    })),
  };
}

const SPAN = 1.2;
const GRID_N = 9;

function grid(span = SPAN) {
  const n = span === SPAN ? GRID_N : 13;
  const start = Math.floor(Date.now() / HOUR) * HOUR;
  const hours = Array.from({ length: 24 }, (_, h) => new Date(start + h * HOUR).toISOString());
  const out = {
    lat: 6.9,
    lon: 101.25,
    span,
    n,
    step: span / (n - 1),
    timezone: "Asia/Bangkok",
    hours,
    temp: [] as number[],
    humidity: [] as number[],
    rain: [] as number[],
    wind: [] as number[],
    windDir: [] as number[],
  };
  for (let point = 0; point < n * n; point += 1) {
    for (let h = 0; h < hours.length; h += 1) {
      out.temp.push(28 + (point % 5));
      out.humidity.push(70 + (point % 20));
      out.rain.push(h === 0 && point % 3 === 0 ? 3.4 : 0);
      out.wind.push(12 + (point % 7));
      out.windDir.push((point * 23) % 360);
    }
  }
  return out;
}

const KUALA = {
  name: "ปัตตานี",
  area: "จังหวัดปัตตานี",
  country: "ไทย",
  countryCode: "TH",
  lat: 6.87,
  lon: 101.25,
  from: "search",
};

type Options = { area?: boolean; stored?: boolean; weatherFails?: boolean };

/** Everything the public endpoints would answer, so no test ever reaches the internet. */
async function serve(page: Page, options: Options = {}) {
  const calls = { weather: 0, geocode: 0, grid: 0 };
  await page.route("**/api/public/weather**", (route) => {
    calls.weather += 1;
    return options.weatherFails
      ? route.fulfill({ status: 503, json: { error: "unavailable" } })
      : route.fulfill({ json: weather() });
  });
  await page.route("**/api/public/weather/grid**", (route) => {
    calls.grid += 1;
    const span = Number(new URL(route.request().url()).searchParams.get("span") ?? SPAN);
    return route.fulfill({ json: grid(span) });
  });
  await page.route("**/api/public/geocode**", (route) => {
    calls.geocode += 1;
    return route.fulfill({ json: { places: [KUALA] } });
  });
  await page.route("**/api/public/status", (route) =>
    route.fulfill({
      json: { generatedAt: new Date().toISOString(), inService: false, alerts: [] },
    }),
  );
  await page.route("**/api/public/places*", (route) =>
    route.fulfill({ json: { people: [], parking: [] } }),
  );
  await page.route("**/api/public/map", (route) =>
    route.fulfill({ json: { places: [], reports: [], gauges: [] } }),
  );
  await page.route("**/api/public/hazards", (route) => route.fulfill({ json: { hazards: [] } }));
  if (options.area) {
    await page.addInitScript(
      (area) => window.localStorage.setItem("jaga.area", JSON.stringify(area)),
      BANA,
    );
  }
  if (options.stored) {
    await page.addInitScript(
      (reading) => window.localStorage.setItem("jaga.weather.reading", JSON.stringify(reading)),
      { key: "6.88,101.27", weather: weather(Date.now() - 30 * 60_000), fetchedAt: Date.now() },
    );
  }
  return calls;
}

const noSidewaysScroll = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

test.describe("weather", () => {
  // Requests that pass through the service worker can't be answered by a test, so it is off here.
  test.use({ serviceWorkers: "block" });

  test("the page shows now, 48 hours of rain, 24 hours and 7 days for the chosen area", async ({
    page,
  }) => {
    await serve(page, { area: true });
    await page.goto("/weather");
    await expect(page.locator('[data-weather-place="true"]')).toHaveText(BANA.nameTh);
    const now = page.locator('[data-weather-now="true"]');
    await expect(now).toContainText("27°C");
    await expect(now).toContainText(th.weather.codes.rainHeavy);
    await expect(page.locator('[data-weather-rain="true"] [role="img"] > span')).toHaveCount(48);
    await expect(page.locator('[data-weather-hours="true"] li')).toHaveCount(24);
    await expect(page.locator('[data-weather-days="true"] li')).toHaveCount(7);
    await noSidewaysScroll(page);
  });

  test("it says it is a forecast and not a Jaga alert, and credits Open-Meteo", async ({
    page,
  }) => {
    await serve(page, { area: true });
    await page.goto("/weather");
    await expect(page.locator('[data-weather-page="true"]')).toContainText(th.weather.notAnAlert);
    await expect(page.locator('[data-weather-page="true"]')).toContainText(th.weather.coverage);
    await expect(page.getByRole("link", { name: /Open-Meteo/ })).toBeVisible();
    // No level badge anywhere: this page can never read as a warning.
    await expect(page.locator("[data-level]")).toHaveCount(0);
  });

  test("the way back to the home screen works", async ({ page }) => {
    await serve(page, { area: true });
    await page.goto("/weather");
    await page.locator('[data-weather-back="true"]').first().click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("main")).toContainText(th.home.notInService.title);
  });

  test("the chip in the header carries the weather and opens the page", async ({ page }) => {
    await serve(page, { area: true });
    await page.goto("/");
    const chip = page.locator('header [data-weather-slot="row"][data-weather-chip="reading"]');
    await expect(chip).toContainText("27°");
    await expect(chip).toHaveAttribute("aria-label", new RegExp(th.weather.codes.rainHeavy));
    await noSidewaysScroll(page);
    await chip.click();
    await expect(page).toHaveURL(/\/weather$/);
    await expect(page.locator('[data-weather-now="true"]')).toBeVisible();
  });

  test("with no place chosen it asks, and a typed name finds one", async ({ page }) => {
    await serve(page);
    await page.goto("/weather");
    const picker = page.locator('[data-weather-picker="true"]');
    await expect(picker).toBeVisible();
    await expect(picker).toContainText(th.weather.place.useGps);
    await picker.locator("#weather-place").fill("ปัตตานี");
    await picker.getByRole("button", { name: th.weather.place.search }).click();
    await picker
      .getByRole("button", { name: /ปัตตานี/ })
      .first()
      .click();
    await expect(page.locator('[data-weather-place="true"]')).toHaveText("ปัตตานี");
    await expect(page.locator('[data-weather-now="true"]')).toContainText("27°C");
    // The choice is remembered on this phone, so the next visit opens on it.
    await page.reload();
    await expect(page.locator('[data-weather-place="true"]')).toHaveText("ปัตตานี");
  });

  test("with no connection the last reading is shown, with the time it is for", async ({
    page,
  }) => {
    await serve(page, { area: true, stored: true, weatherFails: true });
    await page.goto("/weather");
    await expect(page.locator('[data-weather-now="true"]')).toContainText("27°C");
    await expect(page.locator('[data-weather-page="true"]')).toContainText("เชื่อมต่อไม่ได้");
  });

  test("the maps show rain, temperature, humidity and wind around the place", async ({ page }) => {
    const calls = await serve(page, { area: true });
    await page.goto("/weather");
    const maps = page.locator('[data-weather-maps="true"]');
    await maps.scrollIntoViewIfNeeded();
    // The grid is only asked for once the section is on screen.
    await expect.poll(() => calls.grid).toBeGreaterThan(0);
    await expect(page.locator('[data-weather-map="true"]')).toBeVisible();
    await expect(maps.locator('[data-weather-legend="rain"]')).toBeVisible();
    await expect(maps.locator('[data-weather-field="rain"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await maps.locator('[data-weather-field="temp"]').click();
    await expect(maps.locator('[data-weather-legend="temp"]')).toBeVisible();
    await expect(maps.locator('[data-weather-field="temp"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // The value at the person's own place is written out, not only coloured on the map.
    await expect(maps.locator("[data-weather-map-values] li").first()).toContainText("°C");

    await maps.locator('[data-weather-field="wind"]').click();
    await expect(maps).toContainText(th.weather.map.windNote);
    await noSidewaysScroll(page);
  });

  test("the hour slider says which hour and which day the map is drawing", async ({ page }) => {
    await serve(page, { area: true });
    await page.goto("/weather");
    const maps = page.locator('[data-weather-maps="true"]');
    await maps.scrollIntoViewIfNeeded();
    const label = maps.locator("label[for='weather-map-hour']");
    await expect(label).toContainText(th.weather.days.today);
    // The hours run on their own by default; stop them before taking the slider by hand.
    await expect(maps.locator('[data-weather-play="on"]')).toBeVisible();
    await maps.locator("[data-weather-play]").click();
    await expect(maps.locator('[data-weather-play="off"]')).toBeVisible();
    const slider = maps.locator("#weather-map-hour");
    await slider.fill("23");
    await expect(maps.locator("[data-weather-hour='23']")).toHaveCount(1);
    // 23 hours past now is either later today or tomorrow, never neither.
    await expect(label).toContainText(
      new RegExp(`${th.weather.days.today}|${th.weather.days.tomorrow}`),
    );
  });

  test("the hours play round by themselves, and the button stops them", async ({ page }) => {
    await serve(page, { area: true });
    await page.goto("/weather");
    const maps = page.locator('[data-weather-maps="true"]');
    await maps.scrollIntoViewIfNeeded();
    const slider = maps.locator("#weather-map-hour");
    await expect(slider).toBeEnabled();
    const started = await slider.inputValue();
    // It moves on without anyone touching it.
    await expect.poll(async () => slider.inputValue(), { timeout: 8_000 }).not.toBe(started);
    await maps.locator("[data-weather-play]").click();
    const held = await slider.inputValue();
    await page.waitForTimeout(3_000);
    expect(await slider.inputValue()).toBe(held);
  });

  test("nothing is fetched for the weather on the SOS screen (safety rule 1)", async ({ page }) => {
    const calls = await serve(page, { area: true });
    await page.goto("/sos");
    await expect(page.locator('[data-sos-live="true"]')).toBeVisible();
    // The chip defers its request to an idle moment; give it longer than that, then check.
    await page.waitForTimeout(4_000);
    expect(calls.weather).toBe(0);
    await expect(
      page.locator('header [data-weather-slot="row"][data-weather-chip="empty"]'),
    ).toBeVisible();
  });
});
