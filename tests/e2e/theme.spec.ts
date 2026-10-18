import { expect, test } from "@playwright/test";

/**
 * The switch beside the bell (the owner's request, 18 Oct): every visit still starts in the
 * colour the time of day asks for, anyone can change it, and the sun takes the app back at the
 * next sunrise or sunset - including in a tab that has been left open all day.
 */

// 10:00 and 22:00 in Bangkok, where the people using Jaga are. For the middle of the service
// area on this date the sun rises at 06:08 and sets at 17:56, Bangkok time.
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

test("the choice is still there on the way back in, and the app arrives in it", async ({
  page,
}) => {
  await watchThemes(page);
  await page.clock.install({ time: DAY });
  await page.goto("/");
  await page.locator("[data-theme-switch]").click();
  await theme(page).toHaveAttribute("data-theme", "dark");

  // Later the same afternoon, before the sun has moved on: dark from the very first moment, so
  // there is no flash of the day's colours on the way in.
  await page.clock.install({ time: new Date(DAY.getTime() + 4 * 3600_000) });
  await page.goto("/");
  await theme(page).toHaveAttribute("data-theme", "dark");
  expect((await themesSeen(page))[0]).toBe("dark");
});

/** The app asks for nothing while the clock is being wound: these tests are about colours. */
async function quiet(page: Page) {
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
}

test("the sun takes the app back at sunset and sunrise, in a tab left open", async ({ page }) => {
  // The owner's rule, 18 Oct: whatever they picked during the day, when night starts the app
  // turns dark by itself - and it must not need a reload to do it.
  await quiet(page);
  await page.clock.install({ time: DAY });
  await page.goto("/");
  await theme(page).toHaveAttribute("data-theme", "light");
  await page.locator("[data-theme-switch]").click();
  await theme(page).toHaveAttribute("data-theme", "dark");

  // 17:00: still their dark, against a sun that says light.
  await page.clock.fastForward("07:00:00");
  await theme(page).toHaveAttribute("data-theme", "dark");

  // 10:00 the next morning, two sun changes later: the sun has the app back.
  await page.clock.fastForward("17:00:00");
  await theme(page).toHaveAttribute("data-theme", "light");
});

test("a choice made at night survives midnight, and ends at the coming sunrise", async ({
  page,
}) => {
  await quiet(page);
  await page.clock.install({ time: NIGHT });
  await page.goto("/");
  await theme(page).toHaveAttribute("data-theme", "dark");
  await page.locator("[data-theme-switch]").click();
  await theme(page).toHaveAttribute("data-theme", "light");

  // 02:00: midnight is not a boundary, the coming sunrise is.
  await page.clock.fastForward("04:00:00");
  await theme(page).toHaveAttribute("data-theme", "light");

  // The next evening: the choice ran out at sunrise, so the sun decides again.
  await page.clock.fastForward("21:00:00");
  await theme(page).toHaveAttribute("data-theme", "dark");
});
