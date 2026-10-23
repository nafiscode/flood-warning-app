/**
 * The laptop's home screen, one thing at a time (the owner, 23 Oct 2026: options A and C). The
 * other home tests run on a 360x640 phone, which keeps its own layout; these run at 1440x900.
 */
import { expect, type Page, test } from "@playwright/test";
import th from "../../messages/th.json";

// A laptop: a wide window and a mouse. The project's phone device is switched off for these.
test.use({
  serviceWorkers: "block",
  viewport: { width: 1440, height: 900 },
  isMobile: false,
  hasTouch: false,
});

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

const minutes = (n: number) => new Date(Date.now() + n * 60_000).toISOString();

function alert(level: string, more: Record<string, unknown> = {}) {
  return {
    id: `e2e-${level}`,
    hazard: "flood",
    level,
    reason: "ระดับน้ำที่สถานีทดสอบสูงขึ้น",
    messages: { th: "ข้อความทดสอบ" },
    issuedAt: minutes(-60),
    nextUpdateAt: minutes(120),
    onset: null,
    returnWindow: null,
    source: null,
    tambons: [BANA.code],
    ...more,
  };
}

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
    description: { th: "จุดความร้อนจากดาวเทียม" },
    placeholder: {
      th: "ยังไม่มีการเตือนภัยนี้ ไม่ได้แปลว่าไม่มีความเสี่ยง หากเกิดเหตุ กด SOS หรือโทร 199",
    },
    hotline: "199",
  },
];

const AREAS = {
  provinces: [
    { code: "10", nameTh: "กรุงเทพมหานคร", nameEn: "Bangkok", status: "coming_soon" },
    { code: "94", nameTh: "ปัตตานี", nameEn: "Pattani", status: "active" },
  ],
  tambons: [
    {
      code: BANA.code,
      nameTh: BANA.nameTh,
      nameEn: BANA.nameEn,
      districtCode: "9401",
      districtTh: BANA.districtTh,
      districtEn: BANA.districtEn,
      provinceCode: "94",
      lat: BANA.lat,
      lon: BANA.lon,
    },
  ],
};

/** Serve made-up public data. `status: null` makes the status endpoint fail. */
async function serve(
  page: Page,
  status: { inService: boolean; alerts: unknown[] } | null,
  area: typeof BANA | null = BANA,
) {
  await page.route("**/api/public/status", (route) =>
    status
      ? route.fulfill({ json: { generatedAt: new Date().toISOString(), ...status } })
      : route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.route("**/api/public/places*", (route) =>
    route.fulfill({ json: { people: [], parking: [] } }),
  );
  await page.route("**/api/public/map", (route) =>
    route.fulfill({ json: { places: [], reports: [], gauges: [] } }),
  );
  await page.route("**/api/public/hazards", (route) =>
    route.fulfill({ json: { hazards: HAZARDS } }),
  );
  await page.route("**/api/geo/areas", (route) => route.fulfill({ json: AREAS }));
  // The weather chip in the header would otherwise send our server to Open-Meteo for real;
  // the weather itself is tested in weather.spec.ts.
  await page.route("**/api/public/weather**", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  if (area) {
    await page.addInitScript(
      (stored) => window.localStorage.setItem("jaga.area", JSON.stringify(stored)),
      area,
    );
  }
}

const noSidewaysScroll = async (page: Page) =>
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

test.describe("laptop home", () => {
  test("a first visit is asked one question, with SOS and the hotlines in view", async ({
    page,
  }) => {
    await serve(page, { inService: true, alerts: [] }, null);
    await page.goto("/");
    await expect(page.locator("[data-home-first]")).toBeVisible();
    await expect(page.getByRole("heading", { name: th.homeFlow.firstTitle })).toBeVisible();
    await expect(page.locator("[data-no-status]")).toHaveText(th.homeFlow.firstEmpty);
    // SOS is one tap away and the hotlines are in the bar.
    await expect(page.locator("a[href$='/sos']").first()).toBeInViewport();
    await expect(page.locator("footer a[href='tel:1784']")).toBeInViewport();
    // The three quiet ways in, the team's among them, and the same one in the header.
    await expect(page.locator("[data-quiet-link]")).toHaveCount(3);
    await expect(page.locator("[data-quiet-link='teams']")).toBeVisible();
    await expect(page.locator("header [data-teams-nav]")).toBeVisible();
    // Nothing else asks for a tap: no report, no sign-in card, no install card.
    for (const gone of [
      "a[href$='/report']",
      "[data-sign-in-offer]",
      "[data-install]",
      "[data-setup-steps]",
    ]) {
      await expect(page.locator(gone), gone).toHaveCount(0);
    }
    await noSidewaysScroll(page);
  });

  test("food and water is folded under 'other ways to ask for help'", async ({ page }) => {
    await serve(page, { inService: true, alerts: [] }, null);
    await page.goto("/");
    const supplies = page.locator("[data-supplies-link]");
    await expect(supplies).toBeHidden();
    await page.locator("[data-other-help] summary").click();
    await expect(supplies).toBeVisible();
  });

  test("choosing an area turns the page into the status, with one setup card", async ({ page }) => {
    await serve(page, { inService: true, alerts: [] }, null);
    await page.goto("/");
    await page.getByRole("button", { name: th.home.area.fromList }).click();
    await page.selectOption("#area-province", "94");
    await page.selectOption("#area-district", "9401");
    await page.selectOption("#area-tambon", BANA.code);
    await page.getByRole("button", { name: th.home.area.use }).click();

    await expect(page.locator("[data-home-first]")).toHaveCount(0);
    await expect(page.locator("[data-area]")).toHaveText(/บานา/);
    const card = page.locator("[data-setup-steps]");
    await expect(card).toBeVisible();
    // Only the sign-in step carries a button; install waits behind it.
    await expect(card.locator("[data-setup-step='signIn'] [data-line-link]")).toBeVisible();
    await expect(card.locator("[data-setup-step='install']")).toHaveAttribute("data-state", "wait");
    await expect(page.locator("[data-map-cta]")).toContainText("บานา");
    // The old cards are gone, and 'Report flood' waits for sign-in.
    for (const gone of [
      "[data-new-to-jaga]",
      "[data-join-jaga]",
      "[data-install]",
      "a[href$='/report']",
    ]) {
      await expect(page.locator(gone), gone).toHaveCount(0);
    }
    await noSidewaysScroll(page);
  });

  test("a first visitor can paste exact coordinates instead of using the list", async ({
    page,
  }) => {
    await serve(page, { inService: true, alerts: [] }, null);
    // What the position check answers for a point in Bana.
    await page.route("**/api/geo/locate**", (route) =>
      route.fulfill({ json: { kind: "tambon", area: BANA } }),
    );
    await page.goto("/");
    await page.locator("[data-area-find]").click();
    await page.getByPlaceholder(th.locationFinder.placeholder).fill("6.87821, 101.27191");
    await page.locator("[data-finder-search]").click();
    await expect(page.locator("[data-home-first]")).toHaveCount(0);
    await expect(page.locator("[data-area]")).toHaveText(/บานา/);
  });

  test("a first visitor can search a tambon by name", async ({ page }) => {
    await serve(page, { inService: true, alerts: [] }, null);
    await page.goto("/");
    await page.locator("[data-area-find]").click();
    await page.getByPlaceholder(th.locationFinder.placeholder).fill("บานา");
    await page.locator("[data-finder-search]").click();
    await page.locator(`[data-finder-result="${BANA.code}"]`).click();
    await expect(page.locator("[data-home-first]")).toHaveCount(0);
    await expect(page.locator("[data-area]")).toHaveText(/บานา/);
  });

  test("an area already chosen skips the first screen", async ({ page }) => {
    await serve(page, { inService: true, alerts: [] });
    await page.goto("/");
    await expect(page.locator("[data-home-first]")).toHaveCount(0);
    await expect(page.locator("[data-setup-steps]")).toBeVisible();
  });

  test("a place at Warning gets the alert and what to do, and nobody is invited to anything", async ({
    page,
  }) => {
    await serve(page, { inService: true, alerts: [alert("warning")] });
    await page.goto("/");
    await expect(page.locator("[data-hero='alert']")).toBeVisible();
    await expect(page.locator("[data-checklist='warning']")).toBeVisible();
    for (const gone of [
      "[data-setup-steps]",
      "[data-map-cta]",
      "[data-install]",
      "[data-home-first]",
    ]) {
      await expect(page.locator(gone), gone).toHaveCount(0);
    }
    await expect(page.locator("a[href$='/sos']").first()).toBeInViewport();
  });
});
