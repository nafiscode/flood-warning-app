/**
 * A14 in a real browser at 360 px: asking for food and water (spec 4.10).
 *
 * As in sos.spec.ts no request reaches the database: /api/sos is answered by the test, so what
 * is checked here is what the phone sends and shows. The database's half is tests/rls/supplies.
 */
import { expect, type Page, test } from "@playwright/test";
import th from "../../messages/th.json";

test.beforeEach(({ page }) => {
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`browser error: ${message.text()}`);
  });
  page.on("pageerror", (error) => console.log(`page error: ${error.message}`));
});

const CASE_ID = "5c2e9b10-3d4f-4a6b-8c7d-1e2f3a4b5c6d";
const SENT = {
  id: CASE_ID,
  token: "abcdef0123456789abcdef0123456789abcdef0123456789",
  merged: false,
  status: "received",
  createdAt: new Date().toISOString(),
};
const timeline = (kind: "rescue" | "supplies") => ({
  status: "received",
  createdAt: SENT.createdAt,
  closedAt: null,
  hazardType: "unknown",
  lat: 6.8669,
  lon: 101.2501,
  hasPhone: false,
  unitName: null,
  orgName: null,
  photos: 0,
  hasVoice: false,
  events: [{ event: "received", at: SENT.createdAt, note: null, unit: null }],
  team: {
    searching: true,
    exhausted: false,
    unitName: null,
    orgName: null,
    etaBand: null,
    etaGivenAt: null,
    acceptedAt: null,
    phoneAvailable: false,
  },
  kind,
  needs: ["water", "food", "baby"],
  needsNote: null,
  suppliesLeft: "none",
});

async function ready(page: Page) {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 6.8669, longitude: 101.2501 });
  await page.route("**/api/public/**", (route) =>
    route.fulfill({
      json: { generatedAt: new Date().toISOString(), inService: true, alerts: [] },
    }),
  );
}

test.describe("asking for food and water", () => {
  test.use({ serviceWorkers: "block" });

  test("from the home screen to a sent request, and on to a rescue when it gets worse", async ({
    page,
  }) => {
    await ready(page);
    let posted: Record<string, unknown> | null = null;
    let kind: "rescue" | "supplies" = "supplies";
    const actions: string[] = [];
    await page.route("**/api/sos", async (route) => {
      posted = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: SENT });
    });
    await page.route(`**/api/sos/${CASE_ID}`, async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as { action: string };
        actions.push(body.action);
        if (body.action === "need_rescue") kind = "rescue";
        await route.fulfill({ json: { ok: true, status: "received" } });
        return;
      }
      await route.fulfill({ json: timeline(kind) });
    });

    await page.goto("/");
    // The SOS button is still there and still first; the new button is its own, quieter one.
    const sos = page.locator('main a[href="/sos"]').first();
    const link = page.locator("[data-supplies-link]");
    await expect(sos).toBeVisible();
    await expect(link).toContainText(th.sos.supplies.label);
    const sosBox = (await sos.boundingBox())!;
    const linkBox = (await link.boundingBox())!;
    expect(sosBox.y).toBeLessThan(linkBox.y);
    expect(linkBox.height).toBeGreaterThanOrEqual(48);
    await link.click();

    await expect(page.locator('[data-supplies-live="true"]')).toBeVisible();
    // The way to a real SOS is on the form, above what it asks.
    await expect(page.locator('[data-supplies-not-rescue] a[href="/sos"]')).toBeVisible();
    await page.locator('[data-need="baby"]').check();
    await page.locator('[data-left="none"]').check();
    await page.locator("[data-supplies-people]").fill("5");
    // Nothing on the form makes the page wider than the phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      360,
    );
    await page.locator("[data-supplies-send]").click();

    await expect(page.locator('[data-case-kind="supplies"]')).toBeVisible();
    expect(posted).not.toBeNull();
    expect(posted!.kind).toBe("supplies");
    expect(posted!.needs).toEqual(["water", "food", "baby"]);
    expect(posted!.suppliesLeft).toBe("none");
    expect(posted!.peopleCount).toBe(5);
    await expect(page.locator("h1")).toHaveText(th.sos.supplies.statusTitle);
    await expect(page.locator("[data-case-needs]")).toContainText(th.sos.needs.baby);
    await expect(page.locator('[data-team="searching"]')).toContainText(
      th.sos.supplies.team.searching,
    );
    // The hotlines stay one tap away (safety rule 4).
    await expect(page.locator('a[href="tel:1669"]').first()).toBeVisible();

    // It got worse.
    await page.locator("[data-need-rescue-button]").click();
    await expect(page.locator('[data-case-kind="rescue"]')).toBeVisible();
    expect(actions).toContain("need_rescue");
    await expect(page.locator("[data-escalated]")).toHaveText(th.sos.supplies.escalate.done);
    await expect(page.locator("[data-need-rescue-button]")).toHaveCount(0);
  });

  test("with no connection the request is kept, with the SOS button and the hotlines", async ({
    page,
  }) => {
    await ready(page);
    await page.route("**/api/sos", (route) => route.abort("internetdisconnected"));
    await page.goto("/supplies");
    await expect(page.locator('[data-supplies-live="true"]')).toBeVisible();
    await page.locator("[data-supplies-send]").click();
    await expect(page.locator('[data-supplies-state="queued"]')).toBeVisible();
    await expect(page.locator('[data-supplies-not-rescue] a[href="/sos"]')).toBeVisible();
    await expect(page.locator('a[href="tel:1784"]').first()).toBeVisible();
  });
});
