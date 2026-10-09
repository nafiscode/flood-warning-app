/**
 * A6: the admins' war room in a real browser at 360 px.
 *
 * The first block needs nothing: it checks that the page and its refresh route are closed to
 * everyone who is not an admin. The second needs a Supabase project and its keys (jaga-dev on
 * the laptop, a throwaway Supabase on the CI runner) and puts one SOS in the database to see it
 * arrive on the board; it is deleted afterwards. The third reads the example page, which is what
 * the owner reviews.
 */
import { createClient } from "@supabase/supabase-js";
import { expect, type Page, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Client } from "pg";
import th from "../../messages/th.json";

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
const email = `e2e-war-${run}@test.invalid`;

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

/** Sign in through the same route an email link uses, without sending an email. */
async function signIn(page: Page) {
  const { data, error } = await service().auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`could not make a link: ${error.message}`);
  await page.goto(`/api/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink`);
}

test.describe("closed to everyone but an admin", () => {
  test("a visitor is sent to sign in, and the refresh route gives nothing away", async ({
    page,
  }) => {
    await page.goto("/admin/war-room");
    await expect(page).toHaveURL(/\/sign-in/);

    const answer = await page.request.get("/api/admin/war-room");
    expect(answer.status()).toBe(404);
    expect(await answer.text()).not.toContain("sos");
  });
});

test.describe("the board", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!url || !secret || !dbUrl, "needs a Supabase project and its keys");

  let sosId: string | null = null;

  test.beforeAll(async () => {
    const { data, error } = await service().auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`could not create the admin: ${error?.message}`);
    await sql("update public.profiles set role = 'admin', display_name = $2 where user_id = $1", [
      data.user.id,
      `E2E war room ${run}`,
    ]);
    // One SOS, placed inside a real tambon, with nobody on it.
    const rows = await sql(
      `insert into public.sos_requests (point, tambon, people_count, depth_ref, text, created_at)
       select extensions.st_pointonsurface(t.geom), t.code, 3, 'waist', $1, now() - interval '40 minutes'
       from public.tambons t where t.province_code = '94' order by t.code limit 1
       returning id, tambon`,
      [`e2e ${run}`],
    );
    sosId = rows[0]!.id as string;
  });

  test.afterAll(async () => {
    if (sosId) await sql("delete from public.sos_requests where id = $1", [sosId]);
    const users = await sql("select id from auth.users where email = $1", [email]);
    for (const u of users) await service().auth.admin.deleteUser(u.id as string);
  });

  test("an admin sees the waiting case, with no phone number on the board", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/war-room");

    // The case has waited 40 minutes against the 15-minute setting, so the page shouts.
    await expect(page.getByText(th.warRoom.gate.badge)).toBeVisible();
    await expect(page.locator("article").first()).toContainText(`e2e ${run}`);
    // Nothing on the board is a phone number: a reveal is one tap, one case, and logged.
    expect(await page.locator('article a[href^="tel:"]').count()).toBe(0);
    await expect(page.getByText(th.warRoom.case.showPhone).first()).toBeVisible();

    // The frozen header and the hotline bar leave the board usable at 360 px, with no sideways
    // scrolling (the whole page, not only an inner strip: CLAUDE.local.md).
    await page.evaluate(() => window.scrollTo(9999, 0));
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });

  test("the people tab lists the admin, and the map tab opens", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/war-room?view=people");
    await expect(page.getByText(`E2E war room ${run}`)).toBeVisible();
    // Nothing in the page itself dials anyone: the four hotlines in the footer are not the
    // people's numbers, which are shown one at a time and logged.
    expect(await page.locator('main a[href^="tel:"]').count()).toBe(0);

    await page.goto("/admin/war-room?view=map");
    await expect(page.locator("[data-map]")).toBeVisible();
    await expect(page.getByText(th.warRoom.map.privacy)).toBeVisible();
  });
});

test.describe("the example page", () => {
  test("switches between the three tabs and never scrolls sideways at 360 px", async ({ page }) => {
    const answer = await page.goto("/dev/war-room");
    test.skip(answer?.status() === 404, "the /dev pages are off in this build");

    await expect(page.getByText(th.warRoom.gate.badge)).toBeVisible();
    for (const tab of [th.warRoom.tab.map, th.warRoom.tab.people, th.warRoom.tab.cases]) {
      await page
        .getByRole("button", { name: tab.replace(/\s*\(.*\)$/, ""), exact: false })
        .first()
        .click();
      await page.waitForTimeout(300);
      await page.evaluate(() => window.scrollTo(9999, 0));
      expect(await page.evaluate(() => window.scrollX), tab).toBe(0);
      await page.evaluate(() => window.scrollTo(0, 0));
    }
  });
});
