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

test.describe("home", () => {
  // Requests that pass through the service worker can't be answered by a test, so it is off here.
  test.use({ serviceWorkers: "block" });

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

  /*
   * The two ways in under the hero (the owner, 18 Oct). The register button is the thing this
   * whole change exists for, so the test says where it is, that a thumb can hit it, and that
   * tapping it really does reach the way into the form.
   */
  test("a rescue unit and a resident both find their way in, under the hero", async ({ page }) => {
    await serve(page, { inService: true, alerts: [] });
    await page.goto("/");
    const card = page.locator('[data-unit-way="card"]');
    await expect(card).toBeVisible();
    const register = card.locator('a[data-unit-register="home"]');
    await expect(register).toBeVisible();
    expect((await register.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    // The resident's own way in, beside it, with its LINE button.
    await expect(page.locator('[data-sign-in-offer="compact"] [data-line-link]')).toBeVisible();
    // Under the hero, and above the checklist.
    const hero = (await page.locator("[data-hero]").boundingBox())!;
    const pair = (await page.locator("[data-join-jaga]").boundingBox())!;
    expect(pair.y).toBeGreaterThan(hero.y);
    await noSidewaysScroll(page);
    await register.click();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("after a few visits the invitation to register is one quiet line", async ({ page }) => {
    await serve(page, { inService: true, alerts: [] });
    await page.addInitScript(() =>
      window.localStorage.setItem("jaga.unitWay", JSON.stringify({ visits: 9 })),
    );
    await page.goto("/");
    await expect(page.locator('[data-join-jaga="line"]')).toBeVisible();
    await expect(page.locator('[data-unit-way="card"]')).toHaveCount(0);
    await expect(page.locator('a[data-unit-register="home"]')).toBeVisible();
    await noSidewaysScroll(page);
  });

  test("the header has Home, Map and Sign in as words, and nothing scrolls sideways", async ({
    page,
  }) => {
    await serve(page, { inService: true, alerts: [] });
    await page.goto("/map");
    const header = page.locator("header");
    // Home as a link of its own: a logo is not what people tap to go back.
    await expect(header.locator('a[href="/"]', { hasText: th.nav.home })).toBeVisible();
    // A phone gets the short name: the full one wrapped every link onto two lines (16 Oct).
    await expect(header.getByRole("link", { name: th.nav.mapShort })).toBeVisible();
    const homeLink = (await header.locator('a[href="/"]', { hasText: th.nav.home }).boundingBox())!;
    expect(homeLink.height).toBeLessThan(56);
    // A visitor is invited to sign in where a signed-in person sees Account (15 Oct, 012ec5a).
    await expect(header.locator('[data-account-link="sign-in"]')).toHaveText(th.nav.signIn);
    const home = (await header.locator('a[href="/"]', { hasText: th.nav.home }).boundingBox())!;
    expect(home.height).toBeGreaterThanOrEqual(44);
    await noSidewaysScroll(page);
  });

  test("the header stays put while the page scrolls, and so does the hotline bar", async ({
    page,
  }) => {
    await serve(page, { inService: true, alerts: [alert("warning")] });
    await page.goto("/");
    const header = page.locator("header");
    const before = (await header.boundingBox())!;
    await page.evaluate(() => window.scrollBy(0, 600));
    await page.waitForFunction(() => window.scrollY > 0);
    const after = (await header.boundingBox())!;
    // Still at the top of the screen, not scrolled away with the page.
    expect(after.y).toBeCloseTo(before.y, 0);
    await expect(header.getByRole("link", { name: th.nav.home })).toBeInViewport();
    await expect(page.locator("footer a[href='tel:1784']")).toBeInViewport();
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
    // The SOS screen itself: one confirmation screen (tests/e2e/sos.spec.ts covers sending) with
    // the numbers to call on it. Before launch this address shows the call-first page instead,
    // which tests/unit/sos.test.tsx checks, because the test server has sending switched on.
    await expect(page.locator("[data-sos-send], [data-sos-soon]")).toBeVisible();
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

test.describe("home offline (safety rule 7)", () => {
  test("the last alert received is still shown, with when it was received", async ({
    page,
    context,
  }) => {
    // Visit once so the service worker has the page, as shell.spec.ts does.
    await page.goto("/");
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.reload();
    await page.waitForLoadState("networkidle");
    // What the phone holds from its last check, two minutes ago: a warning for the chosen area.
    await page.evaluate(
      ([area, status]) => {
        window.localStorage.setItem("jaga.area", JSON.stringify(area));
        window.localStorage.setItem(
          "jaga.status",
          JSON.stringify({ status, checkedAt: Date.now() - 120_000 }),
        );
      },
      [BANA, { generatedAt: minutes(-2), inService: true, alerts: [alert("warning")] }] as const,
    );
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('[data-hero="alert"] [data-level="warning"]')).toBeVisible();
    await expect(page.locator(`[data-area="${BANA.code}"]`)).toBeVisible();
    await expect(page.locator('[data-checked="old"]')).toBeVisible();
    await expect(page.locator('a[href="tel:1784"]').first()).toBeVisible();
  });
});

test.describe("map", () => {
  test.use({ serviceWorkers: "block" });

  test("a coming-soon hazard shows no map, no level and no green, only SOS and its hotline", async ({
    page,
  }) => {
    await serve(page, { inService: true, alerts: [alert("watch")] });
    await page.goto("/map");
    await expect(page.locator("[data-map]")).toBeVisible();
    await expect(page.locator('#map-province option[value="10"]')).toBeDisabled();
    await expect(page.locator("[data-not-covered-note]")).toContainText("1784");
    await noSidewaysScroll(page);

    /*
     * On a phone the hazards that are still to come wait behind one button (the owner, 16 Oct),
     * so the fold has to be opened before fire can be chosen. On a laptop they are all on show
     * and the button is not there at all.
     */
    const more = page.locator("[data-more-hazards]");
    if (await more.isVisible()) await more.click();
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

test.describe("the install card", () => {
  test.use({ serviceWorkers: "block" });

  test("opens the browser's install dialog, then shows the steps, and 'Not now' is remembered", async ({
    page,
  }) => {
    await serve(page, { inService: true, alerts: [] });
    await page.goto("/");
    const card = page.locator("[data-install]");
    await expect(card).toBeVisible();

    // The owner, 19 Oct: nobody noticed it. One line high on the page brings the card into view,
    // and the card says what installing is good for before it says how.
    const line = page.locator("[data-install-line]");
    await expect(line).toBeVisible();
    await expect(card.locator("[data-install-why] li")).toHaveCount(3);
    await line.locator("[data-install-show]").click();
    await expect(card).toBeInViewport();

    // What Chrome and Edge hand a page they are willing to install; the person says no here.
    await page.evaluate(() => {
      const offer = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(offer, {
        prompt: async () => {
          document.body.dataset.asked = "yes";
        },
        userChoice: Promise.resolve({ outcome: "dismissed" }),
      });
      window.dispatchEvent(offer);
    });
    await card.locator("[data-install-button]").click();
    await expect(page.locator("body")).toHaveAttribute("data-asked", "yes");
    await expect(card.locator("[data-install-guide]")).toHaveCount(0);

    // An offer can be used once. After it, the button shows where the browser's own menu is.
    await card.locator("[data-install-button]").click();
    await expect(card.locator("[data-install-guide] li").first()).toBeVisible();
    await noSidewaysScroll(page);

    await card.locator("[data-install-later]").click();
    await expect(card).toHaveCount(0);
    await page.reload();
    await expect(page.locator("[data-hero]")).toBeVisible();
    await expect(page.locator('a[href="/map"]').last()).toBeVisible();
    await expect(card).toHaveCount(0);
  });

  test("is not on the home screen while the tambon is at Warning", async ({ page }) => {
    await serve(page, { inService: true, alerts: [alert("warning")] });
    await page.goto("/");
    await expect(page.locator('[data-hero="alert"]')).toBeVisible();
    await expect(page.locator("[data-install]")).toHaveCount(0);
  });
});

/*
 * "What the monitoring shows now" on the home screen (the owner, 17 Oct 2026). The two things
 * checked here are the two the feature rests on: at Warning and Evacuate it must not come
 * between a person and what to do, and a feed that failed must say so rather than read as
 * "nothing is happening" (safety rules 2 and 10).
 */
test.describe("what the monitoring shows now, on the home screen", () => {
  test.use({ serviceWorkers: "block" });

  /** The gauge counts and the standing reports the section counts from. */
  async function serveMonitoring(
    page: Page,
    options: { gauges?: "ok" | "fail"; reports?: "ok" | "fail" | "empty" } = {},
  ) {
    const gauges = options.gauges ?? "ok";
    const reports = options.reports ?? "ok";
    await page.route("**/api/public/gauges/summary", (route) =>
      gauges === "fail"
        ? route.fulfill({ status: 503, json: { error: "unavailable" } })
        : route.fulfill({
            json: {
              generatedAt: new Date().toISOString(),
              gauges: [
                { lat: 6.9, lon: 101.3, status: "above_warning", observedAt: minutes(-25) },
                { lat: 6.85, lon: 101.25, status: "normal", observedAt: minutes(-25) },
              ],
            },
          }),
    );
    await page.route("**/api/public/reports", (route) =>
      reports === "fail"
        ? route.fulfill({ status: 503, json: { error: "unavailable" } })
        : route.fulfill({
            json: {
              generatedAt: new Date().toISOString(),
              tambons:
                reports === "empty"
                  ? []
                  : [
                      {
                        tambon: BANA.code,
                        nameTh: BANA.nameTh,
                        nameEn: BANA.nameEn,
                        district: BANA.code.slice(0, 4),
                        districtTh: "เมืองปัตตานี",
                        districtEn: "Mueang Pattani",
                        lat: BANA.lat,
                        lon: BANA.lon,
                        reports: 3,
                        people: 2,
                        deepest: "knee",
                        worstRoad: "motorbike_only",
                        trend: "rising",
                        firstAt: minutes(-200),
                        latestAt: minutes(-40),
                        confirmed: true,
                      },
                    ],
            },
          }),
    );
    await page.route("**/api/public/dam", (route) =>
      route.fulfill({ status: 503, json: { error: "unavailable" } }),
    );
  }

  test("sits under the hero on a quiet day, as measurements and not as a level", async ({
    page,
  }) => {
    await serve(page, { inService: true, alerts: [] });
    await serveMonitoring(page);
    await page.goto("/");
    const card = page.locator('[data-monitoring-card="home"]');
    await expect(card).toBeVisible();

    // Under the hero, which stays the one place that says what level is in force.
    const hero = await page.locator("[data-hero]").boundingBox();
    const box = await card.boundingBox();
    expect(box!.y).toBeGreaterThan(hero!.y);

    // The status in a line; the measurements wait behind a tap.
    await expect(card.locator("[data-monitoring-status]")).toBeVisible();
    await expect(card.locator("[data-monitoring-pulse]")).toBeVisible();
    await card.locator("[data-monitoring-open]").click();
    const section = card.locator('[data-monitoring="home"]');
    await expect(section).toBeVisible();
    // The button brings the reader to the detail, not just into the page (the owner, 17 Oct).
    await expect(card.locator("[data-monitoring-detail]")).toBeInViewport();

    // One river over its bank, in words, with its own source named.
    const rivers = section.locator('[data-monitoring-note="gauges"]');
    await expect(rivers).toHaveAttribute("data-monitoring-say", "active");
    await expect(rivers).toContainText(th.monitoring.gauges.who);

    // Nothing in it wears an alert hue or a level badge (safety rule 2).
    await expect(section.locator("[data-level]")).toHaveCount(0);
    expect(
      await section.evaluate((el) =>
        [...el.querySelectorAll("*")].some((e) =>
          /alert-(normal|watch|warning|evacuate|return|stale)/.test(e.className ?? ""),
        ),
      ),
    ).toBe(false);

    // And it shuts from its own foot, back at the card that opened it (the owner, 17 Oct).
    await card.locator("[data-monitoring-hide]").click();
    await expect(card.locator("[data-monitoring-detail]")).toHaveCount(0);
    await expect(card).toBeInViewport();
    await expect(card.locator("[data-monitoring-open]")).toBeFocused();
    await noSidewaysScroll(page);
  });

  test("waits until after the checklist at Evacuate", async ({ page }) => {
    await serve(page, { inService: true, alerts: [alert("evacuate")] });
    await serveMonitoring(page);
    await page.goto("/");
    const card = page.locator('[data-monitoring-card="home"]');
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    const checklist = await page.locator("[data-checklist]").boundingBox();
    const sos = await page.locator('a[href="/sos"]').first().boundingBox();
    expect(box!.y).toBeGreaterThan(checklist!.y);
    expect(box!.y).toBeGreaterThan(sos!.y);
  });

  test("says the rivers could not be read, never that they are below their bank", async ({
    page,
  }) => {
    await serve(page, { inService: true, alerts: [] });
    await serveMonitoring(page, { gauges: "fail" });
    await page.goto("/");
    await page.locator('[data-monitoring-card="home"] [data-monitoring-open]').click();
    const rivers = page.locator('[data-monitoring-note="gauges"]');
    await expect(rivers).toBeVisible();
    await expect(rivers).toHaveAttribute("data-monitoring-say", "unknown");
    await expect(rivers).toContainText(th.monitoring.gauges.unknown);
    // The quiet sentence claims every station is below its bank: it must not appear.
    await expect(page.locator('[data-monitoring="home"]')).not.toContainText("ต่ำกว่าระดับตลิ่ง");
    await expect(page.locator("[data-monitoring-incomplete]")).toBeVisible();
  });

  test("says residents' reports could not be loaded, never that none stand", async ({ page }) => {
    await serve(page, { inService: true, alerts: [] });
    await serveMonitoring(page, { reports: "fail" });
    await page.goto("/");
    await page.locator('[data-monitoring-card="home"] [data-monitoring-open]').click();
    const reports = page.locator('[data-monitoring-note="reports"]');
    await expect(reports).toBeVisible();
    await expect(reports).toHaveAttribute("data-monitoring-say", "unknown");
    await expect(page.locator('[data-monitoring="home"]')).not.toContainText(
      th.monitoring.reports.quiet.slice(0, 30),
    );
  });

  test("says nothing could be read at all, and no quiet line, when every feed fails", async ({
    page,
  }) => {
    await serve(page, { inService: true, alerts: [] });
    await serveMonitoring(page, { gauges: "fail", reports: "fail" });
    await page.goto("/");
    const card = page.locator('[data-monitoring-card="home"]');
    await expect(card).toBeVisible();
    await card.locator("[data-monitoring-open]").click();
    const section = card.locator('[data-monitoring="home"]');
    await expect(section).toBeVisible();
    await expect(section.locator('[data-monitoring-say="allUnknown"]')).toContainText(
      th.monitoring.allUnknown.slice(0, 30),
    );
    await expect(section.locator("[data-monitoring-note]")).toHaveCount(0);
  });
});
