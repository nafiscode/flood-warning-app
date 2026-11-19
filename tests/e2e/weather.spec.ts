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

type Options = {
  area?: boolean;
  stored?: boolean;
  weatherFails?: boolean;
  tmdWarning?: boolean;
  tmdStations?: boolean;
  tmdModel?: boolean;
};

/**
 * TMD's model answering with much more rain than the stubbed Open-Meteo forecast, which gives
 * 1.5 mm in every fifth hour - about 7 mm over 24 h against TMD's 60 mm, a gap the card must name.
 */
const tmdModelForecast = () => {
  const start = Math.floor(Date.now() / HOUR) * HOUR;
  return {
    lat: 6.88,
    lon: 101.27,
    hours: Array.from({ length: 24 }, (_, i) => ({
      at: new Date(start + i * HOUR).toISOString(),
      rainMm: 2.5,
      tempC: 26,
      group: "rain",
    })),
    rainMm: 60,
  };
};

/** A TMD warning in the shape /api/public/tmd/warnings returns. */
const TMD_WARNING = {
  issueNo: "8",
  announcedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
  startsAt: new Date(Date.now() - HOUR).toISOString(),
  endsAt: new Date(Date.now() + 12 * HOUR).toISOString(),
  titleTh: "ฝนตกหนักถึงหนักมากบริเวณภาคใต้ ฉบับที่ 8",
  headlineTh: "บริเวณภาคใต้ตอนล่างจะมีฝนตกเพิ่มขึ้น และมีฝนตกหนักถึงหนักมากบางแห่ง",
  pdfUrl: "https://tmd.go.th/media/forecast/warning_th.pdf",
};

/** Two stations near Bana, read within the hour. */
const tmdStations = () => [
  {
    id: "48580",
    nameTh: "ปัตตานี",
    nameEn: "PATTANI AIRPORT",
    provinceTh: "ปัตตานี",
    lat: 6.78333,
    lon: 101.15,
    observedAt: new Date(Date.now() - HOUR).toISOString(),
    rain24hMm: 42.6,
    tempC: 25.2,
    humidity: 95,
  },
  {
    id: "48581",
    nameTh: "ยะลา สกษ.",
    nameEn: "YALA AGROMET.",
    provinceTh: "ยะลา",
    lat: 6.51667,
    lon: 101.28333,
    observedAt: new Date(Date.now() - HOUR).toISOString(),
    rain24hMm: 0,
    tempC: 25.1,
    humidity: 96,
  },
];

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
  // TMD's two feeds (18 Nov 2026). Off unless a test asks for them, so the other tests see the
  // page exactly as it looks on a quiet day - which is the common case.
  await page.route("**/api/public/tmd/warnings", (route) =>
    options.tmdWarning
      ? route.fulfill({ json: { warnings: [TMD_WARNING], fetchedAt: new Date().toISOString() } })
      : route.fulfill({ json: { warnings: [], fetchedAt: new Date().toISOString() } }),
  );
  // TMD's own forecast model, which needs a token an environment may not have: 503 unless a test
  // asks for it, so the default here is the page without TMD's model.
  await page.route("**/api/public/tmd/forecast**", (route) =>
    options.tmdModel
      ? route.fulfill({ json: tmdModelForecast() })
      : route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.route("**/api/public/tmd/stations", (route) =>
    options.tmdStations
      ? route.fulfill({ json: { stations: tmdStations(), fetchedAt: new Date().toISOString() } })
      : route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
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
    await expect(page.locator('[data-weather-page="true"]')).toContainText("ไม่มีสัญญาณ");
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
    // The hours wait for the play button (the owner, 16 Oct).
    await expect(maps.locator('[data-weather-play="off"]')).toBeVisible();
    const slider = maps.locator("#weather-map-hour");
    await slider.fill("23");
    await expect(maps.locator("[data-weather-hour='23']")).toHaveCount(1);
    // 23 hours past now is either later today or tomorrow, never neither.
    await expect(label).toContainText(
      new RegExp(`${th.weather.days.today}|${th.weather.days.tomorrow}`),
    );
  });

  test("the hours stay still until play is pressed, then go round until it is pressed again", async ({
    page,
  }) => {
    await serve(page, { area: true });
    await page.goto("/weather");
    const maps = page.locator('[data-weather-maps="true"]');
    await maps.scrollIntoViewIfNeeded();
    const slider = maps.locator("#weather-map-hour");
    await expect(slider).toBeEnabled();
    const started = await slider.inputValue();
    // Nothing moves by itself (the owner, 16 Oct).
    await page.waitForTimeout(3_000);
    expect(await slider.inputValue()).toBe(started);
    await maps.locator("[data-weather-play]").click();
    await expect(maps.locator('[data-weather-play="on"]')).toBeVisible();
    await expect.poll(async () => slider.inputValue(), { timeout: 8_000 }).not.toBe(started);
    await maps.locator("[data-weather-play]").click();
    const held = await slider.inputValue();
    await page.waitForTimeout(3_000);
    expect(await slider.inputValue()).toBe(held);
  });

  test("on a phone the weather sits at the top right, level with the logo", async ({ page }) => {
    await serve(page, { area: true });
    await page.goto("/");
    const header = page.locator("header");
    const chip = header.locator('[data-weather-slot="row"][data-weather-chip="reading"]');
    await expect(chip).toBeVisible();
    const logo = (await header.locator("a").first().boundingBox())!;
    const pill = (await chip.boundingBox())!;
    const bar = (await header.boundingBox())!;
    // The same row as the logo, and in the far half of the bar (the owner, 13 Oct).
    expect(Math.abs(pill.y - logo.y)).toBeLessThan(12);
    // The menu button now holds the end of the row, so "the far half" is the pill's far edge.
    expect(pill.x).toBeGreaterThan(logo.x + logo.width);
    expect(pill.x + pill.width).toBeGreaterThan(bar.width / 2);
    // The header is the one row: Home, Map and Account are tabs at the foot, the languages in the menu.
    expect(bar.height).toBeLessThan(72);
    await noSidewaysScroll(page);
  });

  test("the header is no taller before a place is chosen than after", async ({ page }) => {
    // With no place the pill says "weather" in words and is twice as wide; it once pushed the
    // top row onto a fourth line, 48 px of page lost for every first-time visitor.
    await serve(page, { area: true });
    await page.goto("/");
    await expect(
      page.locator('header [data-weather-slot="row"][data-weather-chip="reading"]'),
    ).toBeVisible();
    const withReading = (await page.locator("header").boundingBox())!.height;
    await page.evaluate(() => {
      window.localStorage.removeItem("jaga.area");
      window.localStorage.removeItem("jaga.weather.reading");
      window.localStorage.removeItem("jaga.weather.place");
    });
    const fresh = await page.context().newPage();
    await serve(fresh);
    await fresh.goto("/");
    await expect(
      fresh.locator('header [data-weather-slot="row"][data-weather-chip="empty"]'),
    ).toBeVisible();
    expect((await fresh.locator("header").boundingBox())!.height).toBe(withReading);
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

  test("TMD's warning is shown as TMD's, not as a Jaga alert", async ({ page }) => {
    await serve(page, { area: true, tmdWarning: true });
    await page.goto("/weather");
    const card = page.locator("[data-tmd-warnings]");
    await expect(card).toBeVisible();
    await expect(card).toContainText(th.tmd.title);
    await expect(card).toContainText(th.tmd.notAnAlert);
    // TMD's own Thai, quoted and marked as Thai.
    await expect(card.locator('[lang="th"]').first()).toContainText(TMD_WARNING.titleTh);
    // Its own PDF, and TMD's weather line - not one of the emergency hotlines.
    await expect(card.locator("[data-tmd-pdf]")).toHaveAttribute("href", TMD_WARNING.pdfUrl);
    await expect(card.locator("[data-tmd-phone]")).toHaveAttribute("href", "tel:1182");
    await noSidewaysScroll(page);
  });

  test("the TMD card is above the forecast and carries no level badge", async ({ page }) => {
    await serve(page, { area: true, tmdWarning: true });
    await page.goto("/weather");
    const warning = (await page.locator("[data-tmd-warnings]").boundingBox())!;
    const now = (await page.locator('[data-weather-now="true"]').boundingBox())!;
    // An official warning outranks a model's forecast on the page.
    expect(warning.y).toBeLessThan(now.y);
    // Nothing on it may look like one of Jaga's four levels.
    await expect(page.locator("[data-tmd-warnings] [data-level]")).toHaveCount(0);
  });

  test("on the home screen TMD's paragraph waits behind a tap", async ({ page }) => {
    /*
     * The owner, 19 Nov 2026: "Long TMD text on the home page. Show the headline, affected period
     * and one summary line, and put the full paragraph behind 'อ่านเพิ่ม'." Open, TMD writes enough
     * to push the alert, SOS and the hotlines down the page - on the one screen where those three
     * are the whole point of the page.
     *
     * Folded is not shortened: what the reader sees is TMD's own title, the period TMD gave it and
     * TMD's own opening lines ended by the box. The weather screen, where someone has gone looking
     * for exactly this, still opens it - the test above.
     */
    await serve(page, { area: true, tmdWarning: true });
    await page.goto("/");
    const box = page.locator("[data-tmd-warnings] details[data-tmd-compact]").first();
    await expect(box).toBeVisible();
    await expect(box).toContainText(TMD_WARNING.titleTh);
    await expect(box.locator("[data-tmd-more]")).toContainText(th.tmd.readMore);
    const lead = box.locator("[data-tmd-lead]");
    await expect(lead).toBeVisible();
    const folded = (await box.boundingBox())!;
    // The whole notice, and its PDF, one tap away.
    await box.locator("summary").click();
    await expect(box.locator("[data-tmd-pdf]")).toBeVisible();
    // Opened, the clamped copy gets out of the way rather than saying it all twice.
    await expect(lead).toBeHidden();
    expect((await box.boundingBox())!.height).toBeGreaterThan(folded.height);
    await noSidewaysScroll(page);
  });

  test("on a quiet day there is no TMD card at all", async ({ page }) => {
    await serve(page, { area: true });
    await page.goto("/weather");
    await expect(page.locator('[data-weather-now="true"]')).toBeVisible();
    await expect(page.locator("[data-tmd-warnings]")).toHaveCount(0);
  });

  test("the measured rain names the station, its distance and its hour", async ({ page }) => {
    await serve(page, { area: true, tmdStations: true });
    await page.goto("/weather");
    const card = page.locator("[data-tmd-rain]");
    await expect(card).toBeVisible();
    await expect(card).toContainText(th.tmdRain.title);
    // 42.6 mm at Pattani airport, about 13 km from Bana; and Yala's measured zero, shown as zero.
    await expect(card.locator('[data-tmd-station="48580"]')).toContainText("42.6");
    await expect(card.locator('[data-tmd-station="48580"]')).toContainText("กม.");
    await expect(card.locator('[data-tmd-station="48581"]')).toContainText("0");
    await noSidewaysScroll(page);
  });

  test("the forecast still works when TMD cannot be reached", async ({ page }) => {
    // TMD down must look like a quiet day and touch nothing else (safety rule 7).
    await serve(page, { area: true });
    await page.route("**/api/public/tmd/**", (route) =>
      route.fulfill({ status: 503, json: { error: "unavailable" } }),
    );
    await page.goto("/weather");
    await expect(page.locator('[data-weather-now="true"]')).toContainText("27°C");
    await expect(page.locator("[data-tmd-warnings]")).toHaveCount(0);
    await expect(page.locator("[data-tmd-rain]")).toHaveCount(0);
  });

  test("the two models are shown side by side, and the gap between them is named", async ({
    page,
  }) => {
    await serve(page, { area: true, tmdModel: true });
    await page.goto("/weather");
    const card = page.locator("[data-two-forecasts]");
    await expect(card).toBeVisible();
    await expect(card).toContainText(th.twoForecasts.title);
    // Both figures, each against its own model's name.
    await expect(card.locator('[data-model="tmd"]')).toContainText("60");
    await expect(card.locator('[data-model="openMeteo"]')).toBeVisible();
    // 7 mm against 60 mm: far apart, and the card must point at the higher number.
    await expect(card.locator("[data-verdict]")).toHaveAttribute("data-verdict", "farApart");
    await expect(card.locator("[data-verdict]")).toContainText("60");
    await noSidewaysScroll(page);
  });

  test("without TMD's model the page is exactly as it was", async ({ page }) => {
    // A deployment with no `TMD_NWP_TOKEN` set: the route reports itself unavailable and the page
    // is exactly what it was before TMD's model existed - no gap, no error, no mention of TMD.
    // Still worth holding after the token arrived, because a preview build or a fresh environment
    // without the secret must degrade this way and not break the weather page (safety rule 7).
    await serve(page, { area: true });
    await page.goto("/weather");
    await expect(page.locator('[data-weather-now="true"]')).toContainText("27°C");
    await expect(page.locator('[data-weather-days="true"] li')).toHaveCount(7);
    await expect(page.locator("[data-two-forecasts]")).toHaveCount(0);
  });
});
