/**
 * "View as another role" (14 Oct): an admin opens each role's own screens with made-up data, at
 * phone width, against the real database - and the dam operator's send button sends nothing.
 * The test's admin is removed afterwards. A visitor gets nothing at all.
 */
import { createClient } from "@supabase/supabase-js";
import { expect, type Page, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Client } from "pg";
import en from "../../messages/en.json";

function envValue(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  if (!existsSync(".env.local")) return undefined;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && line.slice(0, i).trim() === key) {
      const v = line
        .slice(i + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
      if (v) return v;
    }
  }
  return undefined;
}

const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
const secret = envValue("SUPABASE_SECRET_KEY");
const dbUrl = envValue("SUPABASE_DB_URL");
const run = randomUUID().slice(0, 8);
const email = `e2e-preview-admin-${run}@test.invalid`;

const service = () =>
  createClient(url!, secret!, { auth: { persistSession: false, autoRefreshToken: false } });

async function sql(text: string, params: unknown[] = []) {
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  try {
    return (await db.query(text, params)).rows;
  } finally {
    await db.end();
  }
}

async function signIn(page: Page) {
  const { data, error } = await service().auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`could not make a link: ${error.message}`);
  await page.goto(`/api/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink`);
}

async function noSideways(page: Page) {
  const x = await page.evaluate(() => {
    window.scrollTo(9999, window.scrollY);
    return window.scrollX;
  });
  expect(x).toBe(0);
}

test.use({ serviceWorkers: "block" });
// A preview page reads the dams on the server; on a busy laptop a page change can take a while.
test.describe.configure({ timeout: 120_000 });

test("the previews are closed to a visitor", async ({ page }) => {
  await page.goto("/en/admin/preview/rescue");
  await expect(page).toHaveURL(/\/sign-in/);
});

test.describe("an admin views the app as each role", () => {
  test.skip(!url || !secret || !dbUrl, "needs a Supabase project and its keys");
  test.setTimeout(120_000);
  let admin = "";

  test.beforeAll(async () => {
    const { data, error } = await service().auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw new Error(`could not create the admin: ${error?.message}`);
    admin = data.user.id;
    await sql("update public.profiles set role = 'admin', display_name = $2 where user_id = $1", [
      admin,
      `E2E preview admin ${run}`,
    ]);
  });

  test.afterAll(async () => {
    if (!admin) return;
    await sql("delete from public.audit_log where actor = $1", [admin]);
    await service().auth.admin.deleteUser(admin);
  });

  test("every role's screens, from the menu, with made-up data", async ({ page }) => {
    await signIn(page);
    await page.goto("/en/admin");
    // The fifth group of the menu leads to the previews.
    await page.locator('[data-admin-group="preview"] summary').click();
    await page.locator('[data-admin-link="preview.visitor"]').click();
    await expect(page).toHaveURL(/\/en\/admin\/preview\/visitor$/, { timeout: 30_000 });
    const banner = page.locator("[data-preview-banner]");
    await expect(banner).toContainText(en.rolePreview.role.visitor);
    // A first visit: no area chosen yet.
    await expect(page.locator('[data-preview-frame="phone"]')).toBeVisible();
    await noSideways(page);

    await page.locator('[data-preview-role="resident"]').click();
    await expect(page).toHaveURL(/\/preview\/resident$/, { timeout: 30_000 });
    await expect(banner).toContainText(en.rolePreview.role.resident);
    await expect(page.locator("[data-preview-frame] [data-hero]")).toBeVisible();
    await page.locator("[data-preview-views] a", { hasText: en.rolePreview.resident.map }).click();
    await expect(page.locator("[data-map]")).toBeVisible({ timeout: 30_000 });
    await noSideways(page);

    await page.locator('[data-preview-role="rescue"]').click();
    await expect(page).toHaveURL(/\/preview\/rescue$/, { timeout: 30_000 });
    await expect(page.locator('[data-case-kind="rescue"]').first()).toBeVisible();
    await noSideways(page);

    // A food and water team is never offered a rescue.
    await page.locator('[data-preview-role="supplies"]').click();
    await expect(page).toHaveURL(/\/preview\/supplies$/, { timeout: 30_000 });
    await expect(page.locator('[data-case-kind="supplies"]').first()).toBeVisible();
    await expect(page.locator('[data-case-kind="rescue"]')).toHaveCount(0);

    await page.locator('[data-preview-role="pending"]').click();
    await expect(page).toHaveURL(/\/preview\/pending$/, { timeout: 30_000 });
    await expect(page.locator('[data-step="review"]')).toHaveAttribute("data-step-state", "now");
    await expect(page.locator("[data-preview-console]")).toContainText(
      en.authority.notVerified.title,
    );
    await noSideways(page);
  });

  test("the dam operator's button sends nothing", async ({ page }) => {
    await signIn(page);
    const [{ n: before }] = (await sql("select count(*)::int as n from public.alerts")) as [
      { n: number },
    ];
    await page.goto("/en/admin/preview/operator");
    const form = page.locator('[data-dam-release-form][data-operator="true"]');
    await expect(form).toBeVisible();
    // An operator chooses neither the level nor the dam; the notice is the reviewed template.
    await expect(form.locator('input[type="radio"]:visible')).toHaveCount(0);
    await form.locator("#releaseCms").fill("350");
    await expect(form.locator("[data-dam-release-preview]")).toContainText("350");
    await form.locator('button[type="submit"]').click();
    await expect(page.locator("[data-preview-sent]")).toHaveText(en.rolePreview.operator.sent);
    const [{ n: after }] = (await sql("select count(*)::int as n from public.alerts")) as [
      { n: number },
    ];
    expect(after).toBe(before);
    await noSideways(page);
  });
});
