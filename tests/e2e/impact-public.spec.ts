import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";

/** The public impact page (spec section 16): open to everyone, with no figures until A13. */
test("opens without an account and shows no figures", async ({ page }) => {
  await page.goto("/en/impact");
  await expect(page).toHaveURL(/\/en\/impact$/);
  await expect(page.getByRole("heading", { level: 1, name: en.impactPublic.title })).toBeVisible();
  await expect(page.locator("[data-impact-soon]")).toBeVisible();
  await expect(page.locator("[data-impact-panel]")).toHaveCount(0);
  await expect(page.getByText(en.impact.example.title)).toHaveCount(0);
});

test("the end of a page links to it, but home and the help screens do not", async ({ page }) => {
  await page.goto("/en/map");
  await expect(page.locator("[data-impact-link] a")).toHaveAttribute("href", "/en/impact");
  for (const path of ["/en", "/en/sos", "/en/report", "/en/supplies", "/en/impact"]) {
    await page.goto(path);
    await expect(page.locator("[data-impact-link]"), path).toHaveCount(0);
  }
});
