import { expect, test } from "@playwright/test";
import th from "../../messages/th.json";

test("sign-in page says SOS and alerts need no sign-in, and keeps the hotlines", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(th.signIn.title);
  await expect(page.getByText(th.signIn.visitorNote)).toBeVisible();
  for (const number of ["1784", "1669", "191", "199"]) {
    await expect(page.locator(`a[href="tel:${number}"]`)).toBeVisible();
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("phone sign-in is hidden in production until a provider is chosen", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.locator('input[name="phone"]')).toHaveCount(0);
});

test("personal and admin pages send a visitor to sign-in; the home page never does", async ({
  page,
}) => {
  for (const path of ["/account", "/account/setup", "/authority/register", "/admin"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in/);
  }
  await page.goto("/ms/admin");
  await expect(page).toHaveURL(/\/ms\/sign-in/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
});

test("a broken sign-in link explains itself", async ({ page }) => {
  await page.goto("/api/auth/confirm?token_hash=nope&type=magiclink");
  await expect(page).toHaveURL(/\/sign-in\?error=link/);
  await expect(page.locator('p[role="alert"]')).toHaveText(th.signIn.error.link);
});

test("a failed LINE sign-in says so, an expired email link still asks for a new link", async ({
  page,
}) => {
  await page.goto("/api/auth/callback?error=server_error&error_code=unexpected_failure");
  await expect(page).toHaveURL(/\/sign-in\?error=line/);
  await expect(page.locator('p[role="alert"]')).toHaveText(th.signIn.error.line);
  await page.goto("/api/auth/callback?error=access_denied&error_code=otp_expired");
  await expect(page).toHaveURL(/\/sign-in\?error=link/);
});

test("the LINE link answers with one redirect, to LINE or back to sign-in, never elsewhere", async ({
  request,
}) => {
  const response = await request.get("/api/auth/line?locale=en&next=https://evil.example/x", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(307);
  const location = response.headers()["location"] ?? "";
  // With LINE configured (a laptop with .env.local) it goes straight to LINE; in CI it is not.
  const toLine = location.startsWith("https://access.line.me/oauth2/v2.1/authorize?");
  expect(toLine || location.endsWith("/en/sign-in?error=unavailable")).toBe(true);
  expect(location).not.toContain("evil.example");
});

test("sign-out only accepts a form post", async ({ request }) => {
  const response = await request.get("/api/auth/sign-out", { maxRedirects: 0 });
  expect(response.status()).toBe(405);
});

test("inside Messenger's browser the page offers to open the phone's own browser first", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 360, height: 640 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; SM-A146P Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/480.0.0.50.109;]",
  });
  const page = await context.newPage();
  await page.goto("/en/sign-in?next=/account");
  // The notice belongs to the LINE button, which CI (no LINE channel) does not show.
  test.skip((await page.locator('a[href^="/api/auth/line"]').count()) === 0, "LINE not configured");
  const open = page.locator('a[href^="intent://"]');
  await expect(open).toBeVisible();
  const href = (await open.getAttribute("href")) ?? "";
  expect(href).toContain("/en/sign-in?next=%2Faccount#Intent;scheme=http");
  expect((await open.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
  // Signing in here stays possible, and the page still fits a 360 px screen.
  await expect(page.locator('a[href^="/api/auth/line"]')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});

test("on an older iPhone inside Messenger the page gives written steps, not a dead button", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 360, height: 640 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerLiteForiOS;FBAV/480.0.0.30.106;FBBV/1;FBDV/iPhone10,4;FBMD/iPhone;FBSN/iOS;FBSV/16.7.2]",
  });
  const page = await context.newPage();
  await page.goto("/en/sign-in");
  test.skip((await page.locator('a[href^="/api/auth/line"]').count()) === 0, "LINE not configured");
  await expect(page.locator('a[href^="x-safari-"]')).toHaveCount(0);
  await expect(page.getByText('choose "Open in browser", then sign in there')).toBeVisible();
  await context.close();
});
