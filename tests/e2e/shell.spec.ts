import { expect, test } from "@playwright/test";

const HOTLINES = ["1784", "1669", "191", "199"];

test("home opens in Thai at 360 px, without horizontal scroll", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "th");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Jaga");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("placeholder home shows no alert level (never implies 'no risk')", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-level]")).toHaveCount(0);
});

test("the four hotlines are one tap away, with tap targets of at least 48 px", async ({ page }) => {
  await page.goto("/");
  for (const number of HOTLINES) {
    const link = page.locator(`a[href="tel:${number}"]`);
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(48);
  }
});

test("language links switch URL and language", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Bahasa Melayu" }).click();
  await expect(page).toHaveURL(/\/ms$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ms");
  await page.getByRole("link", { name: "ภาษาไทย" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("/dev/brand is not available in production", async ({ page }) => {
  const response = await page.goto("/dev/brand");
  expect(response?.status()).toBe(404);
});

test("web manifest matches the brand", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest.short_name).toBe("Jaga");
  expect(manifest.theme_color).toBe("#1D3B53");
  expect(manifest.background_color).toBe("#F0F2EE");
  expect(manifest.icons.map((i: { purpose: string }) => i.purpose)).toContain("maskable");
});

test.describe("offline (safety rule 7)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(new URL(scope).pathname).toBe("/");
    // Load the home page once more under the worker's control, so it is in the page cache.
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await page.waitForLoadState("networkidle");
  });

  test("a page visited before opens from the cache", async ({ page, context }) => {
    await context.setOffline(true);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Jaga");
    for (const number of HOTLINES) {
      await expect(page.locator(`a[href="tel:${number}"]`)).toBeVisible();
    }
  });

  test("a page never visited shows the offline page with the hotlines", async ({
    page,
    context,
  }) => {
    await context.setOffline(true);
    await page.goto("/en");
    await expect(page.locator("body")).toContainText("ไม่มีการเชื่อมต่ออินเทอร์เน็ต");
    for (const number of HOTLINES) {
      await expect(page.locator(`a[href="tel:${number}"]`)).toBeVisible();
    }
  });
});
