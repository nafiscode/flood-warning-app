import { expect, test, type Page } from "@playwright/test";

/**
 * A9 acceptance (safety rule 7): in airplane mode, home -> safe places -> SOS works, with the real
 * service worker. The SOS page and the area list were never opened online: the daily warm-up
 * (components/OfflineWarmup.tsx) has to have kept them.
 */

const HOTLINES = ["1784", "1669", "191", "199"];

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

async function underWorker(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

test.describe("airplane mode (A9, safety rule 7)", () => {
  test.setTimeout(120_000);

  test("home -> safe places -> SOS, never opened online, works with no signal", async ({
    page,
    context,
  }) => {
    await underWorker(page);
    // The person chose their area once; the home screen then fetches its status and safe places
    // online and keeps them on the phone.
    await page.evaluate((area) => {
      window.localStorage.setItem("jaga.area", JSON.stringify(area));
    }, BANA);
    await page.reload();
    await expect(page.locator(`[data-area="${BANA.code}"]`)).toBeVisible();
    await expect(page.locator("[data-safe-places]")).toHaveAttribute("data-safe-places", "ok", {
      timeout: 30_000,
    });
    // The daily warm-up runs once the phone is idle (about 4 s after load).
    await page.waitForFunction(() => window.localStorage.getItem("jaga.warm.th") !== null, null, {
      timeout: 60_000,
    });

    await context.setOffline(true);

    // Home: the stored status and the safe places.
    await page.goto("/");
    await expect(page.locator(`[data-area="${BANA.code}"]`)).toBeVisible();
    await page.locator("[data-safe-places] > summary").click();
    await expect(page.locator("[data-safe-places] article").first()).toBeVisible();
    for (const number of HOTLINES) {
      await expect(page.locator(`a[href="tel:${number}"]`).first()).toBeVisible();
    }

    // SOS: never opened online.
    await page.locator('a[href="/sos"]').first().click();
    await expect(page.locator('[data-sos-state="ready"]')).toBeVisible();
    // No GPS in this browser: the area list, kept by the warm-up, gives the location.
    await expect(page.locator("[data-sos-nolocation]")).toBeVisible();
    await page.locator("[data-sos-nolocation] button", { hasText: "เลือกพื้นที่ของคุณ" }).click();
    await page.locator("[data-area-chooser] button", { hasText: "เลือกจากรายการ" }).click();
    await page.locator("#area-province").selectOption("94");
    await page.locator("#area-district").selectOption("9401");
    await page.locator("#area-tambon").selectOption(BANA.code);
    await page.getByRole("button", { name: "ใช้พื้นที่นี้" }).click();
    await page.locator("[data-sos-send]").click();
    // Queued on the phone, to go out when the signal is back; the hotlines are there to call.
    await expect(page.locator('[data-sos-state="queued"]')).toBeVisible();
    await expect(
      page.locator('[data-sos-state="queued"] a[href="tel:1784"]').first(),
    ).toBeVisible();
  });

  test("the map, never opened online, opens with no signal and says it is the phone's copy", async ({
    page,
    context,
  }) => {
    await underWorker(page);
    await page.evaluate((area) => {
      window.localStorage.setItem("jaga.area", JSON.stringify(area));
    }, BANA);
    await page.reload();
    await page.waitForFunction(() => window.localStorage.getItem("jaga.status") !== null, null, {
      timeout: 30_000,
    });
    await page.waitForFunction(() => window.localStorage.getItem("jaga.warm.th") !== null, null, {
      timeout: 60_000,
    });

    await context.setOffline(true);
    await page.goto("/map");
    // Every saved thing says how old it is (A9).
    await expect(page.locator("[data-map-saved]")).toHaveAttribute("data-map-saved", "time", {
      timeout: 30_000,
    });
    await expect(page.locator('footer a[href="tel:1784"]')).toBeVisible();
  });

  test("a page never kept shows the offline page in its own language", async ({
    page,
    context,
  }) => {
    await underWorker(page);
    await context.setOffline(true);
    await page.goto("/ms/report");
    await expect(page.locator("body")).toContainText("Tiada sambungan internet");
    for (const number of HOTLINES) {
      await expect(page.locator(`a[href="tel:${number}"]`).first()).toBeVisible();
    }
  });
});
