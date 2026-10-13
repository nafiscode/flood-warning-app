/**
 * "My requests": the journey of what a person has sent, on one page (the owner, 13 Oct).
 *
 * The page reads a request for help with the key the phone holds for it, so the test gives the
 * phone two remembered cases and answers for them itself. What is being checked is the screen:
 * the steps, what is waited for, the order, the way in from the home screen and from the bell,
 * and that it fits a 360 px phone.
 */
import { expect, type Page, test } from "@playwright/test";
import th from "../../messages/th.json";

test.use({ serviceWorkers: "block" });

const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
const RESCUE = "11111111-1111-4111-8111-111111111111";
const SUPPLY = "22222222-2222-4222-8222-222222222222";

const base = {
  closedAt: null,
  hazardType: "flood",
  lat: null,
  lon: null,
  hasPhone: false,
  orgName: null,
  photos: 0,
  hasVoice: false,
  needs: [],
  needsNote: null,
  suppliesLeft: null,
};
const TIMELINES: Record<string, unknown> = {
  [RESCUE]: {
    ...base,
    kind: "rescue",
    status: "en_route",
    createdAt: ago(40),
    unitName: "ทีมเรือ ก",
    team: {
      searching: false,
      exhausted: false,
      unitName: "ทีมเรือ ก",
      orgName: null,
      etaBand: "to30",
      etaGivenAt: ago(30),
      acceptedAt: ago(34),
      phoneAvailable: false,
    },
    events: [
      { event: "received", at: ago(40), note: null, unit: null },
      { event: "accepted", at: ago(34), note: null, unit: "ทีมเรือ ก" },
      { event: "en_route", at: ago(28), note: null, unit: "ทีมเรือ ก" },
    ],
  },
  [SUPPLY]: {
    ...base,
    kind: "supplies",
    status: "received",
    createdAt: ago(10),
    unitName: null,
    team: null,
    needs: ["water", "food"],
    events: [{ event: "received", at: ago(10), note: null, unit: null }],
  },
};

async function seed(page: Page) {
  await page.addInitScript(
    ([rescue, supply, sentA, sentB]) => {
      localStorage.setItem(
        "jaga.sos.cases",
        JSON.stringify([
          { id: supply, token: "t2", status: "received", createdAt: sentB },
          { id: rescue, token: "t1", status: "en_route", createdAt: sentA },
        ]),
      );
    },
    [RESCUE, SUPPLY, ago(40), ago(10)],
  );
  await page.route("**/api/sos/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop()!;
    const body = TIMELINES[id];
    return body
      ? route.fulfill({ json: body })
      : route.fulfill({ status: 404, json: { error: "unknown" } });
  });
  await page.route("**/api/public/weather**", (route) => route.fulfill({ status: 503, body: "" }));
}

test("each request shows its steps, what is waited for, and fits a phone", async ({ page }) => {
  await seed(page);
  await page.goto("/requests");

  const rescue = page.locator(`[data-request="sos:${RESCUE}"]`);
  await expect(rescue).toContainText(th.journey.rescue.title);
  await expect(rescue.locator("[data-step]")).toHaveCount(6);
  await expect(rescue.locator('[data-step="accepted"]')).toHaveAttribute("data-step-state", "done");
  await expect(rescue.locator('[data-step="accepted"]')).toContainText("ทีมเรือ ก");
  const current = rescue.locator('[data-step-state="now"]');
  await expect(current).toHaveAttribute("data-step", "on_site");
  await expect(current).toContainText(th.journey.rescue.wait.on_site);

  const supply = page.locator(`[data-request="sos:${SUPPLY}"]`);
  await expect(supply).toContainText(th.journey.supplies.title);
  await expect(supply.locator('[data-step-state="now"]')).toHaveAttribute("data-step", "accepted");

  // Nothing pushes the page sideways on a 360 px phone.
  const width = await page.evaluate(() => {
    window.scrollTo(9999, 0);
    return { x: window.scrollX, w: document.documentElement.clientWidth };
  });
  expect(width.x).toBe(0);

  // One tap from a card to the request itself, which carries the same steps.
  await rescue.locator("a").click();
  await expect(page).toHaveURL(new RegExp(`/sos/${RESCUE}$`));
  await expect(page.locator("[data-case-journey] [data-step]")).toHaveCount(6);
});

test("the home screen and the bell both lead to it", async ({ page }) => {
  await seed(page);
  await page.goto("/");
  const link = page.locator("[data-requests-link]");
  await expect(link).toHaveAttribute("data-requests-link", "2");
  await expect(link).toContainText(th.journey.link);

  // The bell has an item for each step a team took.
  const bell = page.locator("[data-notice-bell]");
  await expect(bell).toHaveAttribute("data-notice-bell", "2");
  await bell.click();
  const panel = page.locator("[data-notice-panel]");
  await expect(panel).toContainText(th.notices.sos.en_route);
  await expect(panel).toContainText(th.notices.sos.accepted);
  await page.keyboard.press("Escape");

  await link.click();
  await expect(page).toHaveURL(/\/requests$/);
  await expect(page.locator("[data-my-requests]")).toHaveAttribute("data-my-requests", "2");
});

test("a phone that has sent nothing is told so, not shown an empty page", async ({ page }) => {
  await page.route("**/api/public/weather**", (route) => route.fulfill({ status: 503, body: "" }));
  await page.goto("/requests");
  await expect(page.locator("[data-requests-empty]")).toBeVisible();
  await page.goto("/");
  await expect(page.locator("[data-requests-link]")).toHaveCount(0);
});
