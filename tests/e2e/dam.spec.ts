import { expect, test, type Page } from "@playwright/test";

/**
 * The dam on the map, and the quiet notice (spec section 15).
 *
 * What these hold, which the unit tests cannot: that the notice really reaches the screen of
 * somebody on the river and nobody else, that it never promises a time, and that the public
 * answer carries no arrival estimate for the app to find.
 */

const BANA = {
  code: "940104",
  nameTh: "บานา",
  nameEn: "Bana",
  districtCode: "9401",
  districtNameTh: "เมืองปัตตานี",
  districtNameEn: "Mueang Pattani",
  provinceCode: "94",
  provinceNameTh: "ปัตตานี",
  provinceNameEn: "Pattani",
  lat: 6.87821,
  lon: 101.27191,
  from: "list",
};

/** A tambon in Songkhla, nowhere near the Pattani river. */
const OFF_PATH = {
  ...BANA,
  code: "900101",
  nameTh: "บ่อยาง",
  nameEn: "Bo Yang",
  provinceCode: "90",
};

const line = (coords: number[][]) => ({ type: "LineString", coordinates: coords });

function damAnswer(grade: "quiet" | "watchful" | "releasing") {
  return {
    dams: [
      {
        code: "bang_lang",
        name: { th: "เขื่อนบางลาง", en: "Bang Lang Dam" },
        river: { th: "แม่น้ำปัตตานี", en: "Pattani River" },
        operator: "EGAT",
        point: { type: "Point", coordinates: [101.2721, 6.1551] },
        spillwayPoint: { type: "Point", coordinates: [101.2764, 6.1501] },
        outletPoint: { type: "Point", coordinates: [101.273, 6.1536] },
        reservoir: null,
        storageMaxMcm: 1589.8,
        storageNormalMcm: 1454.4,
        geometrySource: "osm",
        geometryNote: { source: "osm", spillway_channel_mapped: false, mapped_tributaries: 10 },
        reaches: [
          {
            kind: "main",
            seq: 0,
            name: {},
            kmFromDam: 0,
            lengthKm: 134.3,
            line: line([
              [101.27, 6.15],
              [101.24, 6.9],
            ]),
          },
        ],
        tambons: [{ code: "940104", via: "main", kmFromDam: 128 }],
        signal: {
          observedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          fetchedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
          storageMcm: grade === "quiet" ? 745 : 1504,
          percentFull: grade === "quiet" ? 46.9 : 94.6,
          levelM: 99.5,
          inflowCms: 100,
          releasedCms: grade === "releasing" ? 140 : 100,
          spilledCms: grade === "releasing" ? 648 : 0,
          outflowCms: grade === "releasing" ? 788 : 100,
          riseMcmPerH: 0,
          riseWindowH: 6,
          grade,
          reasons: grade === "releasing" ? ["spilling", "above_turbines"] : [],
          awaiting: [],
          readings: 10,
          stale: false,
          confirmedOver: 2,
        },
      },
    ],
  };
}

async function serve(
  page: Page,
  options: { grade?: "quiet" | "watchful" | "releasing"; area?: typeof BANA } = {},
) {
  const { grade = "releasing", area = BANA } = options;
  await page.route("**/api/public/status", (route) =>
    route.fulfill({ json: { generatedAt: new Date().toISOString(), inService: true, alerts: [] } }),
  );
  await page.route("**/api/public/places*", (route) =>
    route.fulfill({ json: { people: [], parking: [] } }),
  );
  await page.route("**/api/public/map", (route) =>
    route.fulfill({ json: { places: [], reports: [], gauges: [] } }),
  );
  await page.route("**/api/public/hazards", (route) =>
    route.fulfill({
      json: {
        hazards: [
          {
            code: "flood",
            status: "active",
            name: { th: "น้ำท่วม", en: "Flood" },
            description: {},
            placeholder: {},
            hotline: "1784",
          },
        ],
      },
    }),
  );
  await page.route("**/api/geo/areas", (route) =>
    route.fulfill({ json: { provinces: [], districts: [], tambons: [] } }),
  );
  await page.route("**/api/public/weather**", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.route("**/api/public/dam", (route) => route.fulfill({ json: damAnswer(grade) }));
  await page.addInitScript(
    (stored) => window.localStorage.setItem("jaga.area", JSON.stringify(stored)),
    area,
  );
}

test.describe("the dam's quiet notice", () => {
  // Requests that pass through the service worker can't be answered by a test.
  test.use({ serviceWorkers: "block" });

  test("reaches someone whose area is on the river, and says it is not an alert", async ({
    page,
  }) => {
    await serve(page);
    await page.goto("/");
    const notice = page.locator("[data-dam-notice]").first();
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute("data-dam-notice", "releasing");
    // The two things it must always say.
    await expect(notice).toContainText("ไม่ใช่การแจ้งเตือนของ Jaga");
    await expect(notice).toContainText("ยังบอกไม่ได้ว่าน้ำจะมาถึง");
  });

  test("reaches nobody whose area is off the river", async ({ page }) => {
    await serve(page, { area: OFF_PATH });
    await page.goto("/");
    await expect(page.locator("[data-hero], [data-dam-notice]").first()).toBeVisible();
    await expect(page.locator("[data-dam-notice]")).toHaveCount(0);
  });

  test("says nothing at all while the dam is quiet", async ({ page }) => {
    await serve(page, { grade: "quiet" });
    await page.goto("/");
    await expect(page.locator("[data-hero]").first()).toBeVisible();
    await expect(page.locator("[data-dam-notice]")).toHaveCount(0);
  });

  test("names the hour the figures are for and how old they are", async ({ page }) => {
    await serve(page);
    await page.goto("/");
    const notice = page.locator("[data-dam-notice]").first();
    await expect(notice).toContainText("ข้อมูลของเวลา");
    await expect(notice).toContainText("ชั่วโมงที่แล้ว");
  });

  test("is on the map page too, with the path's limits in the legend", async ({ page }) => {
    await serve(page);
    await page.goto("/map");
    await expect(page.locator("[data-dam-notice]").first()).toBeVisible();
    const legend = page.locator("[data-dam-legend]");
    await expect(legend).toBeVisible();
    // Safety rule 8: the line never travels without what it does not say.
    await expect(legend).toContainText("ไม่ใช่ขอบเขตน้ำท่วม");
  });
});

test.describe("what /api/public/dam gives out", () => {
  test("carries no arrival time, and nothing personal", async ({ request }) => {
    const response = await request.get("/api/public/dam");
    test.skip(response.status() === 503, "needs a Supabase project");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("s-maxage=");
    const body = await response.json();

    const keys = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.flatMap(keys)
        : value && typeof value === "object"
          ? Object.entries(value).flatMap(([k, v]) => [k, ...keys(v)])
          : [];
    const all = keys(body);
    /*
     * No arrival estimate anywhere: S7 has not measured the travel times, so a field for one
     * could only hold a guess (safety rule 8). `point` is allowed here, unlike the other public
     * endpoints, because a dam is a place and not a person.
     */
    expect(all.filter((k) => /eta|arriv|minutes|reach_?at|when/i.test(k))).toEqual([]);
    expect(all.filter((k) => /phone|reporter|requester|device|household|contact/i.test(k))).toEqual(
      [],
    );
    // Nor is the admins' review queue in it: a signal awaiting judgement is not public.
    expect(all.filter((k) => /notice|review|dismiss/i.test(k))).toEqual([]);
  });

  test("every dam says where its lines came from and what they do not say", async ({ request }) => {
    const response = await request.get("/api/public/dam");
    test.skip(response.status() === 503, "needs a Supabase project");
    const body = await response.json();
    test.skip(body.dams.length === 0, "no dam is seeded in this database");
    for (const dam of body.dams) {
      expect(dam.geometrySource).toBeTruthy();
      expect(dam.geometryNote.limits_en).toMatch(/not how far/i);
      expect(dam.tambons.length).toBeGreaterThan(0);
    }
  });
});
