/**
 * A4 in a real browser at 360 px: asking for help, the offline queue, and the report form.
 *
 * No request ever reaches the database here. /api/sos and /api/report are answered by the test,
 * and "offline" is that answer failing, so the queue is exercised exactly as it would be on a
 * phone with no signal. Service workers are blocked where answers are made up, because a request
 * that goes through the worker cannot be answered by Playwright (see tests/e2e/shell.spec.ts).
 */
import { expect, type Page, test } from "@playwright/test";
import th from "../../messages/th.json";

/** Print what the browser said when something here fails: these screens have no second chance. */
test.beforeEach(({ page }) => {
  page.on("console", (message) => {
    if (message.type() === "error") console.log(`browser error: ${message.text()}`);
  });
  page.on("pageerror", (error) => console.log(`page error: ${error.message}`));
});

const CASE_ID = "7f1d4a02-6a4b-4c9e-9c2f-0a1b2c3d4e5f";

const SENT = {
  id: CASE_ID,
  token: "0123456789abcdef0123456789abcdef0123456789abcdef",
  merged: false,
  status: "received",
  createdAt: new Date().toISOString(),
};

const TIMELINE = {
  status: "received",
  createdAt: SENT.createdAt,
  closedAt: null,
  hazardType: "unknown",
  lat: 6.8669,
  lon: 101.2501,
  hasPhone: true,
  unitName: null,
  orgName: null,
  photos: 0,
  hasVoice: false,
  events: [{ event: "received", at: SENT.createdAt, note: null, unit: null }],
};

/** A phone that knows where it is: the SOS screen asks for the location as it opens. */
async function withLocation(page: Page) {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({ latitude: 6.8669, longitude: 101.2501 });
}

async function serveStatus(page: Page) {
  await page.route("**/api/public/**", (route) =>
    route.fulfill({
      json: { generatedAt: new Date().toISOString(), inService: true, alerts: [] },
    }),
  );
}

test.describe("asking for help", () => {
  test.use({ serviceWorkers: "block" });

  test("the SOS button on the home screen is two taps from a sent request", async ({ page }) => {
    await withLocation(page);
    await serveStatus(page);
    let posted: Record<string, unknown> | null = null;
    await page.route("**/api/sos", async (route) => {
      posted = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({ json: SENT });
    });
    await page.route(`**/api/sos/${CASE_ID}`, (route) => route.fulfill({ json: TIMELINE }));

    await page.goto("/");
    // Tap one: the SOS button on the home screen.
    await page.locator('main a[href="/sos"]').click();
    await expect(page.locator('[data-sos-live="true"]')).toBeVisible();
    // The phone field is there, prominent and optional, with the hint about calling back.
    await expect(page.locator('input[name="phone"]')).toBeVisible();
    await expect(page.getByText(th.sos.phoneHint)).toBeVisible();
    // Tap two: send.
    await page.locator("[data-sos-send]").click();

    await expect(page.locator("[data-case-status]")).toContainText(th.sos.status.received);
    expect(posted).not.toBeNull();
    expect(posted!.lat).toBeCloseTo(6.8669, 3);
    expect(posted!.phone).toBeNull();
    // The hotlines stay one tap away on both screens (safety rule 4).
    await expect(page.locator('a[href="tel:1784"]').first()).toBeVisible();
  });

  test("with no connection the request is queued, then delivered once it is back", async ({
    page,
  }) => {
    await withLocation(page);
    let tries = 0;
    let delivered = false;
    await page.route("**/api/sos", async (route) => {
      tries += 1;
      if (!delivered) {
        // What a phone with no signal does to a request.
        await route.abort("internetdisconnected");
        return;
      }
      await route.fulfill({ json: SENT });
    });
    await page.route(`**/api/sos/${CASE_ID}`, (route) => route.fulfill({ json: TIMELINE }));

    await page.goto("/sos");
    await expect(page.locator('[data-sos-live="true"]')).toBeVisible();
    await page.locator("[data-sos-send]").click();

    // Not an error screen: the request is kept, and calling is offered meanwhile.
    await expect(page.locator('[data-sos-state="queued"]')).toBeVisible();
    await expect(page.getByText(th.sos.sent.queuedTitle)).toBeVisible();
    await expect(page.locator('a[href="tel:1669"]').first()).toBeVisible();
    // The app shell retries the queue too (components/QueueRunner), so one or more tries is right.
    expect(tries).toBeGreaterThanOrEqual(1);

    // The request is in the phone's queue, not lost.
    const queued = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open("jaga-queue", 1);
          open.onsuccess = () => {
            const request = open.result.transaction("pending").objectStore("pending").getAll();
            request.onsuccess = () => resolve(request.result.length);
          };
          open.onerror = () => resolve(-1);
        }),
    );
    expect(queued).toBe(1);

    // The connection comes back: the queue empties itself and the case page opens.
    delivered = true;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(page.locator("[data-case-status]")).toContainText(th.sos.status.received, {
      timeout: 30_000,
    });
    expect(tries).toBeGreaterThan(1);
    const left = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open("jaga-queue", 1);
          open.onsuccess = () => {
            const request = open.result.transaction("pending").objectStore("pending").getAll();
            request.onsuccess = () => resolve(request.result.length);
          };
          open.onerror = () => resolve(-1);
        }),
    );
    expect(left).toBe(0);
  });

  test("the requester sees status changes and can say they are safe", async ({ page }) => {
    await withLocation(page);
    let status = "received";
    await page.route("**/api/sos", (route) => route.fulfill({ json: SENT }));
    await page.route(`**/api/sos/${CASE_ID}`, async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as { action: string; rescued?: boolean };
        if (body.action === "close") status = body.rescued ? "rescued" : "safe_cancelled";
        await route.fulfill({ json: { ok: true, status } });
        return;
      }
      await route.fulfill({
        json: {
          ...TIMELINE,
          status,
          unitName: status === "assigned" ? "หน่วยกู้ภัยยะลา" : null,
          events: [
            { event: "received", at: SENT.createdAt, note: null, unit: null },
            ...(status === "assigned"
              ? [{ event: "assigned", at: SENT.createdAt, note: null, unit: "หน่วยกู้ภัยยะลา" }]
              : []),
          ],
        },
      });
    });

    await page.goto("/sos");
    await expect(page.locator('[data-sos-live="true"]')).toBeVisible();
    await page.locator("[data-sos-send]").click();
    await expect(page.locator("[data-case-status]")).toContainText(th.sos.status.received);

    // A unit takes the case: the person sees it on the next check.
    status = "assigned";
    await page.getByRole("button", { name: th.sos.status.refresh }).click();
    await expect(page.locator("[data-case-status]")).toContainText("หน่วยกู้ภัยยะลา");

    await page.locator("[data-case-safe]").click();
    await expect(page.getByText(th.sos.status.closed)).toBeVisible();
    await expect(page.locator("[data-case-safe]")).toHaveCount(0);
  });

  test("the details asked after sending never pre-select what is happening", async ({ page }) => {
    await withLocation(page);
    await page.route("**/api/sos", (route) => route.fulfill({ json: SENT }));
    await page.route(`**/api/sos/${CASE_ID}`, (route) => route.fulfill({ json: TIMELINE }));
    await page.goto("/sos");
    await expect(page.locator('[data-sos-live="true"]')).toBeVisible();
    await page.locator("[data-sos-send]").click();
    const hazard = page.locator("[data-sos-hazard]");
    await expect(hazard).toBeVisible();
    await expect(hazard).toHaveValue("");
  });
});

test.describe("reporting flooding", () => {
  test.use({ serviceWorkers: "block" });

  test("a visitor is offered sign-in, and told SOS needs none", async ({ page }) => {
    await page.goto("/report");
    await expect(page.locator('[data-report-state="signIn"]')).toBeVisible();
    await expect(page.getByText(th.report.signInBody)).toBeVisible();
    await expect(page.locator('a[href="/sos"]')).toBeVisible();
  });
});
