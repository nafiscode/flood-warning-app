import { expect, test } from "@playwright/test";

/**
 * The switch beside the bell (the owner's request, 18 Oct): every visit still starts in the
 * colour the time of day asks for, and anyone can change it for the rest of their day.
 */

// 10:00 and 22:00 in Bangkok, where the people using Jaga are.
const DAY = new Date("2026-11-20T03:00:00Z");
const NIGHT = new Date("2026-11-20T15:00:00Z");

type Page = import("@playwright/test").Page;

const theme = (page: Page) => expect(page.locator("html"));

/**
 * Watch every theme the page is ever given, from before its own scripts run. The first one is
 * what somebody actually sees: if the app flashed the sun's theme and then corrected itself,
 * the first entry would be the wrong one.
 */
async function watchThemes(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __themes: string[] }).__themes = seen;
    new MutationObserver(() => {
      const now = document.documentElement?.dataset.theme;
      if (now && seen[seen.length - 1] !== now) seen.push(now);
    }).observe(document, { attributes: true, subtree: true, attributeFilter: ["data-theme"] });
  });
}

const themesSeen = (page: Page) =>
  page.evaluate(() => (window as unknown as { __themes: string[] }).__themes ?? []);

test("a visit starts with the sun, by day and by night", async ({ page }) => {
  await page.clock.install({ time: DAY });
  await page.goto("/");
  await theme(page).toHaveAttribute("data-theme", "light");

  await page.clock.install({ time: NIGHT });
  await page.goto("/");
  await theme(page).toHaveAttribute("data-theme", "dark");
});

test("the switch changes the theme, and says which way it goes", async ({ page }) => {
  await page.clock.install({ time: DAY });
  await page.goto("/");
  const button = page.locator("[data-theme-switch]");
  // It offers the night while the app is light, and the day once it is dark.
  await expect(button).toHaveAttribute("data-theme-switch", "light");
  await expect(button).toHaveAttribute("aria-label", /กลางคืน/);

  await button.click();
  await theme(page).toHaveAttribute("data-theme", "dark");
  await expect(button).toHaveAttribute("data-theme-switch", "dark");
  await expect(button).toHaveAttribute("aria-label", /กลางวัน/);

  // And back again.
  await button.click();
  await theme(page).toHaveAttribute("data-theme", "light");
});

test("the tap target is 48 px, like every other control", async ({ page }) => {
  await page.goto("/");
  const box = await page.locator("[data-theme-switch]").boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
});

test("the choice is kept for the rest of that day, and is gone the next", async ({ page }) => {
  await watchThemes(page);
  await page.clock.install({ time: DAY });
  await page.goto("/");
  await page.locator("[data-theme-switch]").click();
  await theme(page).toHaveAttribute("data-theme", "dark");

  // Later the same day: still dark, and already dark when the page arrives - the script that
  // runs before the first paint reads the choice, so there is no flash of the other theme.
  await page.clock.install({ time: new Date(DAY.getTime() + 4 * 3600_000) });
  await page.goto("/");
  await theme(page).toHaveAttribute("data-theme", "dark");
  // Dark from the very first moment: no flash of the day's colours on the way in.
  expect((await themesSeen(page))[0]).toBe("dark");

  // The next day the sun decides again.
  await page.clock.install({ time: new Date(DAY.getTime() + 30 * 3600_000) });
  await page.goto("/");
  await theme(page).toHaveAttribute("data-theme", "light");
});
