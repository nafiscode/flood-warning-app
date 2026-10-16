/**
 * "How Jaga works" (A18): the two knowledge pages. An academic reader finds every part of the
 * map with its data, its limits and its check; the credits name every organisation; and the
 * system page names no vendor. At 360 px, without an account, with no JavaScript needed to
 * switch between the two pages.
 */
import { expect, test } from "@playwright/test";
import { FORBIDDEN_VENDOR_WORDS } from "../../lib/how-it-works";
import en from "../../messages/en.json";

test.use({ serviceWorkers: "block", viewport: { width: 360, height: 640 } });

test("a reader finds every layer, what it cannot tell, and who the data came from", async ({
  page,
}) => {
  await page.goto("/en/how-it-works");
  await expect(
    page.getByRole("heading", { level: 1, name: en.howItWorks.science.title }),
  ).toBeVisible();

  // Ten parts, each saying what it cannot tell (safety rule 8).
  const parts = page.locator("[data-how-part]");
  await expect(parts).toHaveCount(10);
  await expect(page.locator('[data-how-part="radar"]')).toContainText(
    en.howItWorks.science.labels.cannot,
  );

  // The table of checks keeps the unflattering rows.
  await expect(page.locator('[data-how-check="radarSelf"]')).toContainText("CSI 0.41");

  // Every organisation is credited, with a logo or its initials.
  const credits = page.locator("[data-credit]");
  expect(await credits.count()).toBeGreaterThan(15);
  await expect(page.locator('[data-credit="sentinel1"]')).toContainText("Copernicus Sentinel-1");
  await expect(page.locator('[data-credit="osm"] a').first()).toHaveAttribute(
    "href",
    /openstreetmap\.org/,
  );
  // The logos the owner cleared are served from the app itself and really load.
  const logo = page.locator('[data-credit="gistda"] img');
  await expect(logo).toHaveAttribute("src", "/credits/gistda.svg");
  expect((await page.request.get("/credits/gistda.svg")).status()).toBe(200);

  // The workflow chart: one row per chain, and the stage it ends in opens that part.
  await expect(page.locator("[data-workflow-row]")).toHaveCount(8);
  await page.locator('[data-workflow-row="classes"] a').click();
  await expect(page).toHaveURL(/#part-classes$/);

  // The hotlines stay where they always are, and nothing pushes the page sideways.
  await expect(page.locator('footer a[href="tel:1784"]')).toBeVisible();
  const sideways = await page.evaluate(() => {
    window.scrollTo(9999, window.scrollY);
    return window.scrollX;
  });
  expect(sideways).toBe(0);
});

test("the source chips lead to the credits, and the contents to a part", async ({ page }) => {
  await page.goto("/en/how-it-works");
  await page.locator('[data-how-source="fabdem"]').first().click();
  await expect(page).toHaveURL(/#credits$/);
  // The anchor brings the credits to the top of the screen; the cards follow under it.
  await expect(page.locator("#credits h2")).toBeInViewport();
  await expect(page.locator('[data-credit="fabdem"]')).toContainText("FABDEM");
});

test("the system page names no vendor and works without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 360, height: 640 } });
  const page = await context.newPage();
  await page.goto("/en/how-it-works/system");
  await expect(
    page.getByRole("heading", { level: 1, name: en.howItWorks.system.title }),
  ).toBeVisible();
  await expect(page.locator("[data-how-part]")).toHaveCount(8);

  const text = (await page.locator("main").innerText()).toLowerCase();
  for (const word of FORBIDDEN_VENDOR_WORDS) {
    expect(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text), word).toBe(
      false,
    );
  }

  // The switch between the two pages is a plain link, so it works here too.
  await page.locator('[data-how-tab="science"]').click();
  await expect(page).toHaveURL(/\/en\/how-it-works$/);
  await context.close();
});

test("the end of a page links to it, and the SOS page does not", async ({ page }) => {
  await page.goto("/en/map");
  await expect(page.locator("[data-how-link] a")).toHaveAttribute("href", "/en/how-it-works");
  await page.goto("/en/sos");
  await expect(page.locator("[data-how-link]")).toHaveCount(0);
  // On the page itself the link to it is gone, but the other one stays.
  await page.goto("/en/how-it-works");
  await expect(page.locator("[data-how-link]")).toHaveCount(0);
  await expect(page.locator("[data-features-link] a")).toHaveAttribute("href", "/en/features");
});
