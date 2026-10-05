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

test("sign-out only accepts a form post", async ({ request }) => {
  const response = await request.get("/api/auth/sign-out", { maxRedirects: 0 });
  expect(response.status()).toBe(405);
});
