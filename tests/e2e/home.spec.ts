/**
 * A3: the home screen and the public map in a real browser at 360 px. The alert status and map
 * data are made up here and served in place of the public endpoints, so no alert is ever put in
 * a database for a test. The last block reads the real endpoints and checks what they give out.
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

test.describe("home", () => {
  test("a stale alert keeps its level badge and shows 'not updated since'", async ({ page }) => {
    await serve(page, {
      inService: true,
      alerts: [alert("warning", { issuedAt: minutes(-300), nextUpdateAt: minutes(-30) })],
    });
    await page.goto("/");
    const hero = page.locator('[data-hero="alert"]');
    await expect(hero.locator('[data-level="warning"]')).toHaveText(th.alert.level.warning);
    await expect(hero.locator("[data-stale]")).toContainText("ไม่ได้อัปเดตตั้งแต่");
    await expect(hero).toContainText("ต.บานา");
    await expect(hero).toContainText(th.home.issuer);
    await expect(page.locator('[data-checklist="warning"]')).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("at Evacuate, SOS sits under the hero and leads to the numbers to call", async ({
    page,
  }) => {
    await serve(page, { inService: true, alerts: [alert("evacuate")] });
    await page.goto("/");
    await expect(page.locator('[data-hero="alert"] [data-level="evacuate"]')).toBeVisible();
    const sos = page.locator('main a[href="/sos"]');
    const sosBox = (await sos.boundingBox())!;
    const listBox = (await page.locator("[data-checklist]").boundingBox())!;
    expect(sosBox.y).toBeLessThan(listBox.y);
    expect(sosBox.height).toBeGreaterThanOrEqual(48);
    await sos.click();
    await expect(page.locator("[data-sos-soon]")).toContainText(th.soon.sosTitle);
    await expect(page.locator('main a[href="tel:1784"]')).toBeVisible();
    await expect(page.locator('main a[href="tel:1669"]')).toBeVisible();
  });

  test("before launch a tambon without an alert shows no level", async ({ page }) => {
    await serve(page, { inService: false, alerts: [] });
    await page.goto("/");
    await expect(page.locator('[data-hero="notInService"]')).toContainText(
      th.home.notInService.title,
    );
    await expect(page.locator("[data-level]")).toHaveCount(0);
    await noSidewaysScroll(page);
  });

  test("when the status can't be loaded, no level is shown", async ({ page }) => {
    await serve(page, null);
    await page.goto("/");
    await expect(page.locator('[data-hero="unknown"]')).toBeVisible();
    await expect(page.locator("[data-level]")).toHaveCount(0);
  });

  test("a visitor chooses an area from the list; it is remembered and ticks are kept", async ({
    page,
  }) => {
    await serve(page, { inService: true, alerts: [alert("watch")] }, null);
    await page.goto("/");
    await expect(page.locator('[data-hero="choose"]')).toBeVisible();
    await expect(page.locator("[data-level]")).toHaveCount(0);
    await page.getByRole("button", { name: th.home.area.fromList }).click();
    // A province Jaga doesn't cover is listed but can't be chosen.
    await expect(page.locator('#area-province option[value="10"]')).toBeDisabled();
    await page.selectOption("#area-province", "94");
    await page.selectOption("#area-district", "9401");
    await page.selectOption("#area-tambon", BANA.code);
    await page.getByRole("button", { name: th.home.area.use }).click();
    await expect(page.locator('[data-hero="alert"] [data-level="watch"]')).toBeVisible();
    const first = page.locator("[data-checklist] input").first();
    await first.check();
    await page.reload();
    await expect(page.locator(`[data-area="${BANA.code}"]`)).toBeVisible();
    await expect(page.locator("[data-checklist] input").first()).toBeChecked();
  });

  test("offline, the last alert received is still shown, with when it was received", async ({
    page,
    context,
  }) => {
    await serve(page, { inService: true, alerts: [alert("warning")] });
    await page.goto("/");
    await expect(page.locator('[data-level="warning"]')).toBeVisible();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.reload();
    await expect(page.locator('[data-level="warning"]')).toBeVisible();
    await page.unroute("**/api/public/status");
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('[data-hero="alert"] [data-level="warning"]')).toBeVisible();
    await expect(page.locator('[data-checked="old"]')).toBeVisible();
    await expect(page.locator('a[href="tel:1784"]').first()).toBeVisible();
  });

  test("the home screen never downloads the map", async ({ page }) => {
    const mapFiles: string[] = [];
    page.on("request", (request) => {
      if (/maplibre|openfreemap|\/api\/geo\/tambons/.test(request.url()))
        mapFiles.push(request.url());
    });
    await serve(page, { inService: true, alerts: [alert("watch")] });
    await page.goto("/");
    await expect(page.locator('[data-level="watch"]')).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(mapFiles).toEqual([]);
  });
});

test.describe("map", () => {
  test("a coming-soon hazard shows no map, no level and no green, only SOS and its hotline", async ({
    page,
  }) => {
    await serve(page, { inService: true, alerts: [alert("watch")] });
    await page.goto("/map");
    await expect(page.locator("[data-map]")).toBeVisible();
    await expect(page.locator('#map-province option[value="10"]')).toBeDisabled();
    await expect(page.locator("[data-not-covered-note]")).toContainText("1784");
    await noSidewaysScroll(page);

    await page.locator('[data-hazard="fire"]').click();
    await expect(page.locator('[data-hazard-placeholder="fire"]')).toContainText(
      "ไม่ได้แปลว่าไม่มีความเสี่ยง",
    );
    await expect(page.locator("[data-map]")).toHaveCount(0);
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.locator("[data-level]")).toHaveCount(0);
    await expect(page.locator('main a[href="tel:199"]')).toBeVisible();
    await expect(page.locator('main a[href="/sos"]')).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("lists the alerts in force, and has no Transparency tab", async ({ page }) => {
    await serve(page, { inService: true, alerts: [alert("warning")] });
    await page.goto("/map");
    const list = page.locator("[data-alerts-list]");
    await expect(list.locator('[data-level="warning"]')).toBeVisible();
    await expect(list).toContainText("บานา");
    await expect(page.locator('[role="tablist"]')).toHaveCount(0);
  });
});

test.describe("what the public endpoints give out (safety rule 6)", () => {
  const FORBIDDEN = /point|reporter|phone|sos|issued_?by|device|requester|household|contact/i;
  const keys = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.flatMap(keys)
      : value && typeof value === "object"
        ? Object.entries(value).flatMap(([k, v]) => [k, ...keys(v)])
        : [];

  for (const path of [
    "/api/public/status",
    "/api/public/map",
    "/api/public/places?lat=6.878&lon=101.272",
    "/api/public/hazards",
  ]) {
    test(`${path} has no exact report, SOS or personal field`, async ({ request }) => {
      const response = await request.get(path);
      test.skip(response.status() === 503, "needs a Supabase project");
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"]).toContain("s-maxage=");
      const body = await response.json();
      expect(keys(body).filter((k) => FORBIDDEN.test(k))).toEqual([]);
      if (path === "/api/public/map") {
        for (const bin of body.reports) {
          expect(Object.keys(bin).sort()).toEqual(["count", "deepest", "hex", "latest"]);
          expect(bin.hex.type).toBe("Polygon");
        }
      }
    });
  }

  test("the status endpoint says the service is not running until the launch switch is on", async ({
    request,
  }) => {
    const response = await request.get("/api/public/status");
    test.skip(response.status() === 503, "needs a Supabase project");
    expect((await response.json()).inService).toBe(false);
  });
});
