/**
 * The admin console's menu (14 Oct): the pages in four groups, shut until tapped, with a count of
 * what waits for an admin on the review group - in a real browser at phone width, signed in as
 * a real admin against a real database. The test's admin and its waiting report are removed
 * afterwards.
 */
import { createClient } from "@supabase/supabase-js";
import { expect, type Page, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Client } from "pg";

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
const email = `e2e-menu-admin-${run}@test.invalid`;

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

test.use({ serviceWorkers: "block" });

test.describe("the admin menu", () => {
  test.skip(!url || !secret || !dbUrl, "needs a Supabase project and its keys");
  test.setTimeout(90_000);
  let admin = "";
  let report = "";

  test.beforeAll(async () => {
    const { data, error } = await service().auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw new Error(`could not create the admin: ${error?.message}`);
    admin = data.user.id;
    await sql("update public.profiles set role = 'admin', display_name = $2 where user_id = $1", [
      admin,
      `E2E menu admin ${run}`,
    ]);
    const [t] = await sql(
      "select code, extensions.st_astext(extensions.st_pointonsurface(geom)) as wkt from public.tambons where province_code = '96' order by code limit 1",
    );
    [{ id: report }] = (await sql(
      "insert into public.reports (point, tambon, depth_ref, text) values (extensions.st_geomfromtext($1, 4326), $2, 'knee', $3) returning id",
      [t!.wkt, t!.code, `e2e menu report ${run}`],
    )) as [{ id: string }];
  });

  test.afterAll(async () => {
    if (report) await sql("delete from public.reports where id = $1", [report]);
    if (!admin) return;
    await sql("delete from public.audit_log where actor = $1", [admin]);
    await service().auth.admin.deleteUser(admin);
  });

  test("groups the pages, counts what waits, and fits a phone", async ({ page }) => {
    await signIn(page);
    await page.goto("/en/admin");
    const menu = page.locator("[data-admin-menu]");
    await expect(menu.locator("[data-admin-group]")).toHaveCount(4);
    // The test's own report is waiting, so the review group counts at least one.
    await expect(menu.locator('[data-admin-waiting="review"]')).toBeVisible();

    // Shut at first; one tap opens a group, and its pages lead on.
    await expect(menu.locator('[data-admin-link="moderation"]')).toBeHidden();
    await menu.locator('[data-admin-group="review"] summary').click();
    const link = menu.locator('[data-admin-link="moderation"]');
    await expect(link).toBeVisible();
    await expect(link).toContainText(/\d/);
    await link.click();
    await expect(page).toHaveURL(/\/en\/admin\/moderation$/);

    // The new page draws the menu shut, with the group of the page you are on outlined.
    await expect(page.locator('[data-admin-link="moderation"]')).toBeHidden();
    await expect(page.locator('[data-admin-group="review"] summary')).toHaveAttribute(
      "data-here",
      "",
    );
    const sideways = await page.evaluate(() => {
      window.scrollTo(9999, 0);
      return window.scrollX;
    });
    expect(sideways).toBe(0);

    // The admin home lists every group with what it is for; an admin is not offered the admins
    // page, which is the super admin's.
    await page.goto("/en/admin");
    await expect(page.locator("[data-admin-home-group]")).toHaveCount(4);
    await expect(page.locator('[data-admin-home-link="invitations"]')).toHaveCount(0);
    await page.screenshot({ path: "test-results/admin-menu-home.png", fullPage: true });
    await page.locator('[data-admin-group="watch"] summary').click();
    await page.screenshot({ path: "test-results/admin-menu-open.png" });
  });
});
