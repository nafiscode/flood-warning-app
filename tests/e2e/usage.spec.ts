/**
 * The usage counter and its dashboard (14 Oct): the phone sends its open note after the page has
 * settled, with the chosen area and a random code and nothing personal; a test browser is not
 * counted unless the test asks; an admin sees the dashboard. The test's admin is removed after.
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AREA = {
  code: "940101",
  nameTh: "สะบารัง",
  nameEn: "Sabarang",
  districtTh: "เมืองปัตตานี",
  districtEn: "Mueang Pattani",
  provinceTh: "ปัตตานี",
  provinceEn: "Pattani",
  lat: 6.87,
  lon: 101.25,
  from: "list",
};

test.use({ serviceWorkers: "block" });

async function notes(page: Page, counted: boolean) {
  const sent: Record<string, unknown>[] = [];
  await page.addInitScript(
    ([area, on]) => {
      window.localStorage.setItem("jaga.area", JSON.stringify(area));
      if (on) window.sessionStorage.setItem("jaga-usage-test", "1");
    },
    [AREA, counted] as const,
  );
  await page.route("**/api/usage", async (route) => {
    sent.push(JSON.parse(route.request().postData() ?? "{}") as Record<string, unknown>);
    await route.fulfill({ status: 204 });
  });
  await page.route("**/rest/v1/rpc/usage_ping", (route) =>
    route.fulfill({ status: 200, body: "true" }),
  );
  return sent;
}

test.describe("the phone's counter", () => {
  // The first visit to a page of a fresh build can take most of the default 30 seconds.
  test.setTimeout(60_000);
  test("sends one open note after the page settles, with the area and nothing personal", async ({
    page,
  }) => {
    const sent = await notes(page, true);
    await page.goto("/en");
    await expect.poll(() => sent.length, { timeout: 15_000 }).toBe(1);
    const note = sent[0]!;
    expect(note.install).toMatch(UUID);
    expect(note.session).toMatch(UUID);
    expect(note).toMatchObject({ tambon: "940101", areaFrom: "list", path: "/en", locale: "en" });
    for (const key of ["name", "phone", "lat", "lon", "email"])
      expect(note).not.toHaveProperty(key);
    // A second page in the same visit is a page change, not a new visit.
    await page.goto("/en/map");
    await page.waitForTimeout(4_500);
    expect(sent).toHaveLength(1);
  });

  test("a test browser is not counted unless the test asks", async ({ page }) => {
    const sent = await notes(page, false);
    await page.goto("/en");
    await page.waitForTimeout(5_000);
    expect(sent).toHaveLength(0);
  });
});

const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
const secret = envValue("SUPABASE_SECRET_KEY");
const dbUrl = envValue("SUPABASE_DB_URL");
const run = randomUUID().slice(0, 8);
const email = `e2e-usage-admin-${run}@test.invalid`;
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

test.describe("the usage dashboard", () => {
  test.skip(!url || !secret || !dbUrl, "needs a Supabase project and its keys");
  test.setTimeout(90_000);
  let admin = "";

  test.beforeAll(async () => {
    const { data, error } = await service().auth.admin.createUser({ email, email_confirm: true });
    if (error) throw new Error(error.message);
    admin = data.user.id;
    await sql("update public.profiles set role = 'admin', display_name = $2 where user_id = $1", [
      admin,
      `E2E usage admin ${run}`,
    ]);
  });

  test.afterAll(async () => {
    if (!admin) return;
    await sql("delete from public.audit_log where actor = $1", [admin]);
    await service().auth.admin.deleteUser(admin);
  });

  test("an admin sees who is using Jaga, and a window of days can be chosen", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    const { data, error } = await service().auth.admin.generateLink({ type: "magiclink", email });
    if (error) throw new Error(error.message);
    await page.goto(`/api/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink`);
    await page.goto("/en/admin/usage");
    await expect(page.getByRole("heading", { level: 1, name: "App usage" })).toBeVisible();
    await expect(page.locator("[data-usage-panel] [data-usage-live]")).toBeVisible();
    await page.getByRole("link", { name: "30 days" }).click();
    await expect(page).toHaveURL(/\/en\/admin\/usage\?days=30$/);
    await expect(page.locator("[data-usage-privacy]")).toBeVisible();
    // Nothing on the page names a phone.
    expect(await page.content()).not.toMatch(/install_id|session_id/);
    const width = await page.evaluate(() => {
      window.scrollTo(9999, 0);
      return window.scrollX;
    });
    expect(width).toBe(0);
  });
});
