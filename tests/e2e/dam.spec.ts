import th from "../../messages/th.json";
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

/** The words of a message before its first placeholder. */
const words = (message: string) => message.split("{")[0]!.trim();

const line = (coords: number[][]) => ({ type: "LineString", coordinates: coords });

/**
 * A fortnight behind the figures, for the charts. A releasing one rises for a week and then puts
 * water over the spillway; a quiet one sits where the real dam sat.
 */
function fortnight(grade: "quiet" | "watchful" | "releasing") {
  const shape =
    grade === "releasing"
      ? [46, 47, 61, 78, 103, 131, 149, 157, 344, 563, 788]
      : [46, 47, 46, 44, 45, 46, 46, 47, 46, 47, 46];
  const spill =
    grade === "releasing" ? [0, 0, 0, 0, 0, 0, 0, 0, 198, 421, 648] : shape.map(() => 0);
  const start = Date.now() - (shape.length - 1) * 86_400_000;
  return shape.map((cms, i) => ({
    day: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
    hours: 24,
    releasedMeanCms: cms - spill[i]!,
    spilledMeanCms: spill[i],
    outflowMeanCms: cms,
    outflowMcm: Math.round(((cms * 86400) / 1_000_000) * 100) / 100,
    spilledMcm: Math.round(((spill[i]! * 86400) / 1_000_000) * 100) / 100,
    // The reservoir behind those releases: flat on a quiet fortnight, filling before a spill.
    storageEndMcm: grade === "quiet" ? 745 : 1180 + i * 28,
    levelEndM: null,
  }));
}

function damAnswer(grade: "quiet" | "watchful" | "releasing") {
  return {
    dams: [
      {
        code: "bang_lang",
        name: { th: "เขื่อนบางลาง", en: "Bang Lang Dam" },
        river: { th: "แม่น้ำปัตตานี", en: "Pattani River" },
        operator: "EGAT",
        // EGAT publishes hourly; the RID's five reservoirs (14 Oct 2026) publish once a day.
        feed: "hourly",
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
        /*
         * The day behind that hour. A releasing day passes about 69 million m3 downstream; a
         * quiet one about 4, which is the day that was really there on 11 Oct 2026.
         */
        days: fortnight(grade),
        /*
         * The arrival ranges S7 measured at the gauges (12 Oct 2026): hours after the gates open,
         * never a time. Bana is 128 river km down, which is half a day to two days of water.
         */
        arrivals: [
          {
            tambon: BANA.code,
            via: "main",
            kmFromDam: 128,
            warnFromH: 12.8,
            earliestH: 16,
            latestH: 44,
            peakEarliestH: 45,
            peakLatestH: 90,
            source: "gauges-2026-10",
          },
        ],
        daily: {
          windowH: 24,
          until: new Date(Date.now() - 3 * 3_600_000).toISOString(),
          inflowHours: 24,
          inflowMeanCms: grade === "releasing" ? 742 : 51.5,
          inflowMcm: grade === "releasing" ? 64.1 : 4.45,
          outflowHours: 24,
          outflowMeanCms: grade === "releasing" ? 799 : 46.1,
          outflowMcm: grade === "releasing" ? 69.0 : 3.98,
          spilledMcm: grade === "releasing" ? 56.1 : 0,
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
    // The two things it must always say: that Jaga is not the one warning them, and where the
    // hours it does give come from (they are measured ranges since 13 Oct, never a clock time).
    await expect(notice).toContainText("ไม่ใช่การแจ้งเตือนของ Jaga");
    await expect(notice).toContainText(th.dam.arrival.basis);
    await expect(notice.locator("[data-dam-arrival]")).toBeVisible();
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
    await expect(notice).toContainText(words(th.dam.figures.observed));
    await expect(notice).toContainText(words(th.dam.figures.age.split("{hours}")[1]!));
  });

  /*
   * The owner asked for the day's figures on 11 Oct: the hour on its own can say the opposite of
   * what the day did. The notice carries the day's release; the reservoir's own inflow stays on
   * the dam's card, where the rest of the dam's figures are.
   */
  test("carries the day's mean release, and leaves the inflow to the dam's card", async ({
    page,
  }) => {
    await serve(page);
    await page.goto("/map");
    const notice = page.locator("[data-dam-notice]").first();
    await expect(notice).toContainText(th.dam.figures.daily.title.replace("{window}", "24"));
    await expect(notice).toContainText(words(th.dam.figures.daily.outflow));
    // The day's own numbers: a mean of 799 m3/s and the 69 million m3 behind it.
    await expect(notice).toContainText("799");
    await expect(notice).toContainText("69");
    await expect(notice).not.toContainText(words(th.dam.figures.daily.inflow));
  });

  /*
   * The card used to open only by tapping the dam itself, which at the four-province view on a
   * phone is a mark a few pixels across: measured on the live map, 2 taps in 361 found it, and
   * the owner could not find the card at all. The legend opens it in one tap.
   */
  test("the legend opens the dam's card, with the charts in it", async ({ page }) => {
    await serve(page);
    await page.goto("/map");
    const open = page.locator("[data-open-dam]").first();
    await expect(open).toBeVisible();
    await open.click();
    const card = page.locator("[data-selected='dam']");
    await expect(card).toBeVisible();
    await expect(card.locator("[data-dam-history]")).toBeVisible();
    await expect(card.locator("[data-dam-chart='outflow']")).toBeVisible();
    /*
     * ...and the page goes to it. The card opens under the map, above the legend, so the button
     * used to open it off the top of the screen and nothing seemed to happen (the owner, 14 Oct).
     * It has to end up under the frozen header, not behind it, and inside the screen.
     */
    // The scroll is animated and the page above the card is still loading: wait for it to settle.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const panel = document.querySelector("[data-selected-panel]")!.getBoundingClientRect();
            const header = document.querySelector("header")!.getBoundingClientRect();
            return panel.top >= header.bottom - 1 && panel.top < window.innerHeight / 2;
          }),
        { timeout: 5_000 },
      )
      .toBe(true);
    // The reservoir read as an instrument: the figures with their units and their datum.
    const readout = card.locator("[data-dam-readout]");
    await expect(readout).toBeVisible();
    await expect(readout.locator("[data-dam-dial]")).toBeVisible();
    await expect(readout).toContainText(th.dam.readout.unit.mcm);
  });

  /*
   * The owner, 13 Oct: the card on the home screen needs a way into the whole report. The dam's
   * code travels in the address so the map arrives with the report already open.
   */
  test("the home screen's card opens the same report on the map", async ({ page }) => {
    await serve(page, { grade: "quiet" });
    await page.goto("/");
    const card = page.locator("[data-dam-figure-card]");
    await expect(card).toBeVisible();
    await card.locator("a").click();
    await expect(page).toHaveURL(/\/map\?dam=bang_lang/);
    const report = page.locator("[data-selected='dam']");
    await expect(report).toBeVisible();
    // The drawing is in it, above the state (the owner's second note of 13 Oct), and so are the
    // charts the button promises.
    await expect(report.locator("[data-dam-figure='section']")).toBeVisible();
    await expect(report.locator("[data-dam-chart='outflow']")).toBeVisible();
    const order = await report.evaluate((el) => {
      const kids = [...el.querySelectorAll("[data-dam-figure], [data-dam-chip]")];
      return kids.map((k) => (k.hasAttribute("data-dam-chip") ? "chip" : "figure"));
    });
    expect(order[0]).toBe("figure");
    expect(order).toContain("chip");
  });

  test("is on the map page too, with the path's limits in the legend", async ({ page }) => {
    await serve(page);
    await page.goto("/map");
    await expect(page.locator("[data-dam-notice]").first()).toBeVisible();
    const legend = page.locator("[data-dam-legend]");
    await expect(legend).toBeVisible();
    // Safety rule 8: the line never travels without what it does not say.
    await expect(legend).toContainText(th.dam.path.limits);
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
     * The arrival ranges are here since 13 Oct (S7 measured them at the gauges), and they are
     * **hours**, never a time of day: a clock time can only be built where somebody has said when
     * the gates opened (safety rule 8). `point` is allowed here, unlike the other public
     * endpoints, because a dam is a place and not a person.
     */
    const arrivals = (body.dams as { arrivals: Record<string, unknown>[] }[])[0]!.arrivals;
    expect(arrivals.length).toBeGreaterThan(30);
    for (const a of arrivals) {
      for (const key of ["warnFromH", "earliestH", "latestH", "peakEarliestH", "peakLatestH"]) {
        expect(typeof a[key]).toBe("number");
      }
      expect(Number(a.warnFromH)).toBeLessThanOrEqual(Number(a.earliestH));
      expect(Number(a.earliestH)).toBeLessThanOrEqual(Number(a.latestH));
    }
    expect(all.filter((k) => /eta|reach_?at|arrives_?at/i.test(k))).toEqual([]);
    expect(all.filter((k) => /phone|reporter|requester|device|household|contact/i.test(k))).toEqual(
      [],
    );
    // Nor is the admins' review queue in it: a signal awaiting judgement is not public.
    expect(all.filter((k) => /notice|review|dismiss/i.test(k))).toEqual([]);
  });

  /*
   * The charts the owner asked for on 12 Oct are drawn from this: a day a row, oldest first, with
   * the hours behind each one. A day the feed never published must come back as a day with no
   * hours rather than be missing, or a chart would close the gap.
   */
  test("carries the fortnight, a day at a time, with the hours behind each day", async ({
    request,
  }) => {
    const response = await request.get("/api/public/dam");
    test.skip(response.status() === 503, "needs a Supabase project");
    const body = await response.json();
    for (const dam of body.dams) {
      expect(Array.isArray(dam.days)).toBe(true);
      if (dam.days.length === 0) continue;
      expect(dam.days.length).toBeGreaterThan(1);
      const dates = dam.days.map((d: { day: string }) => d.day);
      expect([...dates].sort()).toEqual(dates);
      for (const day of dam.days) {
        // A plain calendar date, never a moment: a browser's own zone must not shift it.
        expect(day.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(typeof day.hours).toBe("number");
        // The reservoir's own figure travels with the day, for the storage chart.
        expect(["number", "object"]).toContain(typeof day.storageEndMcm);
      }
    }
  });

  test("every dam says where its lines came from and what they do not say", async ({ request }) => {
    const response = await request.get("/api/public/dam");
    test.skip(response.status() === 503, "needs a Supabase project");
    const body = await response.json();
    test.skip(body.dams.length === 0, "no dam is seeded in this database");
    for (const dam of body.dams) {
      expect(dam.geometrySource, dam.code).toBeTruthy();
      expect(typeof dam.geometryNote.limits_en, dam.code).toBe("string");
      if (dam.geometryNote.path_mapped === false) {
        /*
         * A reservoir nobody has mapped a channel below (14 Oct 2026): it has no path, no
         * tambons and no zone, and its note says so in place of the usual limits. Showing a
         * guessed line there would be showing a guessed warning (safety rule 8).
         */
        expect(dam.reaches.length, dam.code).toBe(0);
        expect(dam.tambons.length, dam.code).toBe(0);
        expect(dam.geometryNote.limits_en, dam.code).toMatch(/no channel/i);
      } else {
        expect(dam.geometryNote.limits_en, dam.code).toMatch(/not how far/i);
        expect(dam.tambons.length, dam.code).toBeGreaterThan(0);
      }
    }
  });

  /*
   * The five reservoirs added on 14 Oct 2026 are reported once a day, and a day's volume read as
   * an hour's would make a release look twenty-four times smaller than it is.
   */
  test("says how often each reservoir reports, and the daily ones read as a day", async ({
    request,
  }) => {
    const response = await request.get("/api/public/dam");
    test.skip(response.status() === 503, "needs a Supabase project");
    const body = await response.json();
    test.skip(body.dams.length < 2, "only one dam is seeded in this database");
    for (const dam of body.dams) {
      expect(["hourly", "daily"], dam.code).toContain(dam.feed);
      if (dam.feed === "daily" && dam.daily) {
        // One reading a day means the day's figures rest on 24 hours, not on one.
        expect([0, 24], dam.code).toContain(dam.daily.outflowHours);
      }
    }
  });
});
