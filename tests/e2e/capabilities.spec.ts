/**
 * "What Jaga can do" (A17): a visitor finds what each kind of person can do and opens it, at
 * 360 px, without an account. Also: the page is reachable from the end of other pages, a link
 * can open it on one role, and it never pushes the page sideways.
 */
import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";

test.use({ serviceWorkers: "block", viewport: { width: 360, height: 640 } });

test("a visitor finds what Jaga does for each role, and opens one", async ({ page }) => {
  await page.goto("/en/features");
  await expect(page.getByRole("heading", { level: 1, name: en.capabilities.title })).toBeVisible();
  // SOS is where it always is: near the top, and the hotlines stay in the bar.
  await expect(page.locator("[data-capabilities-sos] a")).toHaveAttribute("href", "/en/sos");
  await expect(page.locator('footer a[href="tel:1784"]')).toBeVisible();

  for (const role of ["team", "supplies", "admin", "resident"] as const) {
    await page.locator(`[data-role-choice="${role}"]`).click();
    await expect(page.locator(`[data-role-panel="${role}"]`)).toBeVisible();
    await expect(page.locator("[data-role-panel]:visible")).toHaveCount(1);
  }

  // Nothing wider than the phone.
  const sideways = await page.evaluate(() => {
    window.scrollTo(9999, window.scrollY);
    return window.scrollX;
  });
  expect(sideways).toBe(0);

  await page.locator('[data-capability-open="map"]').click();
  await expect(page).toHaveURL(/\/en\/map$/);
});

test("a link can open the page on one role", async ({ page }) => {
  await page.goto("/en/features#team");
  await expect(page.locator('[data-role-panel="team"]')).toBeVisible();
  await expect(page.locator('[data-role-choice="team"]')).toHaveAttribute("aria-pressed", "true");
});

test("the end of a page links to it, and the SOS page does not", async ({ page }) => {
  await page.goto("/en/map");
  await expect(page.locator("[data-features-link] a")).toHaveAttribute("href", "/en/features");
  await page.goto("/en/sos");
  await expect(page.locator("[data-features-link]")).toHaveCount(0);
});

test("the ? in the header opens it, costs the header no height, and is not on SOS", async ({
  page,
}) => {
  // Thai, no place chosen: the weather pill says "weather" in words, the tightest header there is.
  await page.goto("/map");
  const help = page.locator("header [data-help-link]:visible");
  await expect(help).toHaveCount(1);
  const withHelp = await page.locator("header").boundingBox();
  await page.addStyleTag({ content: "[data-help-link]{display:none!important}" });
  const without = await page.locator("header").boundingBox();
  expect(withHelp!.height).toBe(without!.height);
  await page.goto("/en/map");
  await page.locator("header [data-help-link]:visible").click();
  await expect(page).toHaveURL(/\/en\/features$/);
  await page.goto("/en/sos");
  await expect(page.locator("header [data-help-link]")).toHaveCount(0);
});

test("the bell's panel ends with the way to it", async ({ page }) => {
  await page.goto("/en/map");
  await page.locator("[data-notice-bell]").click();
  await expect(page.locator("[data-notice-features]")).toHaveAttribute("href", "/en/features");
});
