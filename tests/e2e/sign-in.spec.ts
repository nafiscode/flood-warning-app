import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";
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

test("a sign-in that failed at Supabase and landed on the home page says so", async ({ page }) => {
  await page.goto(
    "/?error=server_error&error_code=oauth_client_state_not_found&error_description=OAuth+state+not+found",
  );
  await expect(page).toHaveURL(/\/sign-in\?error=line/);
  await expect(page.locator('p[role="alert"]')).toHaveText(th.signIn.error.line);
});

test("asking for an admin code leads to the code box, which is what the home-screen app needs", async ({
  page,
}) => {
  // A fresh address every run: it has no account, so Supabase sends nothing and the answer is
  // the same as for a real admin, which is the point (the form must not say who is an admin).
  const address = `e2e-code-${Date.now().toString(36)}@test.invalid`;
  await page.goto("/en/sign-in");
  await page.getByText("For admins").click();
  await page.locator('input[name="email"]').fill(address);
  await page.getByRole("button", { name: "Send a sign-in code" }).click();

  const form = page.locator("[data-email-code]");
  await expect(form).toBeVisible();
  await expect(page.locator('p[role="status"]')).toContainText("sent it a sign-in code");
  await expect(form.locator('input[name="code"]')).toHaveAttribute("autocomplete", "one-time-code");
  await expect(form.locator('input[name="email"]')).toHaveValue(address);

  await form.locator('input[name="code"]').fill("000000");
  await form.getByRole("button", { name: "Confirm the code" }).click();
  await expect(page.locator('p[role="alert"]')).toHaveText(en.signIn.error.code, {
    useInnerText: true,
  });
  // The address is kept, so a second try does not start again.
  await expect(page.locator("[data-email-code] input[name='email']")).toHaveValue(address);
});

test("a code that is too short is refused before Supabase is asked", async ({ page }) => {
  await page.goto("/en/sign-in?step=emailCode&email=someone%40test.invalid");
  const form = page.locator("[data-email-code]");
  await expect(form).toBeVisible();
  await form.locator('input[name="code"]').fill("12");
  await form.getByRole("button", { name: "Confirm the code" }).click();
  await expect(page).toHaveURL(/step=emailCode/);
  await expect(page.locator('p[role="alert"]')).toHaveText(en.signIn.error.code, {
    useInnerText: true,
  });
});
