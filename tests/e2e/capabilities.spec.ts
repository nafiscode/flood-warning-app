/**
 * "What Jaga can do" (A17): a visitor finds what each kind of person can do and opens it, at
 * 360 px, without an account. Also: the page is reachable from the end of other pages, a link
 * can open it on one role, and it never pushes the page sideways.
 */
import { expect, test } from "@playwright/test";
import { openPhoneMenu } from "./phone-menu";
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

/*
 * The "?" that used to sit in the header is gone: "About" took its place on 20 Oct, because a
 * fourth word in that row costs 29 px in Thai at 360 px and wraps all four labels. What Jaga can
 * do is one tap further now - from the About page, and from the quiet line at the foot of every
 * page, which is what the tests above cover. What this one holds is that the swap paid for
 * itself: the header is no taller for having a word there, and the word still keeps off SOS.
 */
test("About, in the phone's menu, opens the page, costs no header height, and is not on SOS", async ({
  page,
}) => {
  // Thai, no place chosen: the weather pill says "weather" in words, the tightest header there is.
  await page.goto("/map");
  const heightBefore = (await page.locator("header").boundingBox())!.height;
  const menu = await openPhoneMenu(page);
  const about = menu.locator("[data-about-nav]");
  await expect(about).toHaveCount(1);
  // The menu drops from the header and does not push the page: the header is one row either way.
  expect((await page.locator("header").boundingBox())!.height).toBe(heightBefore);
  // And it is one line: a wrapped label is the first sign the row has run out of room.
  expect(await about.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThan(56);
  await page.goto("/en/map");
  await (await openPhoneMenu(page)).locator("[data-about-nav]").click();
  await expect(page).toHaveURL(/\/en\/about$/);
  await page.goto("/en/sos");
  await expect(page.locator("[data-about-nav]")).toHaveCount(0);
  await expect(page.locator("[data-phone-menu-button]")).toHaveCount(1);
  await openPhoneMenu(page);
  await expect(page.locator("[data-phone-menu] [data-about-nav]")).toHaveCount(0);
});

test("the About page is the way on to the other two", async ({ page }) => {
  await page.goto("/en/about");
  // The nav at its head: the science and the system.
  await expect(page.locator('[data-how-tab="science"]')).toHaveAttribute(
    "href",
    "/en/how-it-works",
  );
  await expect(page.locator('[data-how-tab="system"]')).toHaveAttribute(
    "href",
    "/en/how-it-works/system",
  );
  // And the block at its foot leads to What Jaga can do.
  await expect(page.locator('[data-about] a[href="/en/features"]')).toHaveCount(1);
});

test("the bell's panel ends with the way to it", async ({ page }) => {
  await page.goto("/en/map");
  await page.locator("[data-notice-bell]").click();
  await expect(page.locator("[data-notice-features]")).toHaveAttribute("href", "/en/features");
});
