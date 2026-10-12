/**
 * A6: the alert console, end to end, in a real browser against a real database.
 *
 * One admin takes an alert through its whole life - review, publish, "nothing has changed",
 * replace with an Evacuate (second confirmation), cancel - and the test then reads the access log
 * for every one of those acts.
 *
 * The build under test is not "in service" (the launch switch is off), so everything published
 * here is a drill: the test also proves the public answer never carries it. That a real alert is
 * in the public answer the moment it is published is proven where it can be done without showing
 * a made-up alert to anyone: in tests/rls/alert-console.test.ts, inside a transaction.
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
const email = `e2e-alert-admin-${run}@test.invalid`;
const NOTE = `e2e drill ${run}`;
const EVAC_NOTE = `e2e evac ${run}`;
const t = th.alertConsole;

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

test("the console and its review route are closed to a visitor", async ({ page }) => {
  await page.goto("/admin/alerts");
  await expect(page).toHaveURL(/\/sign-in/);
  const preview = await page.request.post("/api/admin/alert-preview", {
    data: { template: randomUUID(), tambon: ["950101"] },
  });
  expect(preview.status()).toBe(404);
  expect(await preview.text()).not.toContain("messages");
});

test.describe("an alert's whole life", () => {
  test.skip(!url || !secret || !dbUrl, "needs a Supabase project and its keys");
  test.setTimeout(120_000);
  let admin = "";

  test.beforeAll(async () => {
    const { data, error } = await service().auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw new Error(`could not create the admin: ${error?.message}`);
    admin = data.user.id;
    await sql("update public.profiles set role = 'admin', display_name = $2 where user_id = $1", [
      admin,
      `E2E alert admin ${run}`,
    ]);
  });

  test.afterAll(async () => {
    if (!admin) return;
    // An alert keeps its issuer, so the drills go before the account can.
    const ids = (await sql("select id from public.alerts where issued_by = $1", [admin])).map((r) =>
      String(r.id),
    );
    await sql("delete from public.audit_log where entity = 'alerts' and entity_id = any ($1)", [
      ids,
    ]);
    await sql("delete from public.alerts where issued_by = $1", [admin]);
    await service().auth.admin.deleteUser(admin);
  });

  test("review, publish as a drill, extend, replace with Evacuate, cancel", async ({ page }) => {
    await signIn(page);
    await page.goto("/admin/alerts");
    await expect(page.locator("[data-drill-mode]")).toBeVisible();
    await page.locator("[data-new-alert]").click();
    await expect(page).toHaveURL(/\/admin\/alerts\/new$/);

    // Level and words from a template; the area from the list; the admin's own note.
    await page.locator('[data-template="flood_watch"]').check();
    await page.locator("fieldset details > summary").first().click();
    await page.locator('input[name="district"]').first().check();
    await page.locator('input[name="note"]').fill(NOTE);
    await page.locator('select[name="hours"]').selectOption("2");

    // Nothing to publish with until the review has been read.
    await expect(page.locator("[data-publish]")).toHaveCount(0);
    await page.locator("[data-review]").click();
    const publish = page.locator("[data-publish]");
    await expect(publish).toHaveText(t.review.publishDrill);
    await expect(page.locator('[data-review-text="th"]')).toContainText("ต.");
    await expect(page.locator('[data-review-text="ms"]')).toContainText("Berjaga-jaga banjir");
    await expect(page.locator('[data-review-text="en"]')).toContainText("Flood watch");
    const tambons = Number(
      await page.locator("[data-review-tambons]").getAttribute("data-review-tambons"),
    );
    expect(tambons).toBeGreaterThan(0);
    // Changing the form takes the review away; it has to be read again.
    await page.locator('select[name="hours"]').selectOption("3");
    await expect(publish).toHaveCount(0);
    await page.locator("[data-review]").click();
    await publish.click();

    await expect(page).toHaveURL(/\/admin\/alerts\?done=published$/);
    const first = page.locator("article[data-alert]", { hasText: NOTE });
    await expect(first).toHaveAttribute("data-level", "watch");
    await expect(first.locator("[data-drill]")).toBeVisible();
    const firstId = (await first.getAttribute("data-alert"))!;

    // A drill is not in what the public is given.
    const status = await page.request.get("/api/public/status");
    expect(status.ok()).toBe(true);
    expect(JSON.stringify(await status.json())).not.toContain(firstId);
    const [row] = await sql(
      "select is_drill, issued_by, (select count(*)::int from public.alert_tambons t where t.alert_id = a.id) as n from public.alerts a where id = $1",
      [firstId],
    );
    expect(row).toMatchObject({ is_drill: true, issued_by: admin, n: tambons });

    // "Nothing has changed": only the next-update time moves.
    await first.locator("details:has([data-extend]) > summary").click();
    await first.locator('details:has([data-extend]) select[name="hours"]').selectOption("6");
    await first.locator("[data-extend]").click();
    await expect(page).toHaveURL(/done=extended$/);
    await expect(page.locator(`article[data-alert="${firstId}"] [data-history]`)).toHaveAttribute(
      "data-history",
      "2",
    );

    // Replace it with an Evacuate. The old area comes ticked; Evacuate wants its second yes.
    await page.locator(`article[data-alert="${firstId}"] [data-replace]`).click();
    await expect(page.locator(`[data-superseding="${firstId}"]`)).toBeVisible();
    expect(await page.locator('input[name="tambon"]:checked').count()).toBe(tambons);
    await page.locator('[data-template="flood_evacuate"]').check();
    await page.locator('input[name="note"]').fill(EVAC_NOTE);
    await page.locator("[data-review]").click();
    const tick = page.locator('input[name="confirmEvacuate"]');
    await expect(tick).not.toBeChecked();
    await page.locator("[data-publish]").click();
    // The browser holds the form back without the tick; nothing was sent.
    await expect(page).toHaveURL(/\/admin\/alerts\/new\?supersedes=/);
    await tick.check();
    await page.locator("[data-publish]").click();

    await expect(page).toHaveURL(/done=published$/);
    const second = page.locator("article[data-alert]", { hasText: EVAC_NOTE });
    await expect(second).toHaveAttribute("data-level", "evacuate");
    await expect(page.locator(`article[data-ended="${firstId}"]`)).toContainText(
      t.state.superseded,
    );
    const secondId = (await second.getAttribute("data-alert"))!;

    // Cancel it, with a reason.
    await second.locator("details:has([data-cancel]) > summary").click();
    await second.locator('details:has([data-cancel]) input[name="note"]').fill(`e2e over ${run}`);
    await second.locator("[data-cancel]").click();
    await expect(page).toHaveURL(/done=cancelled$/);
    await expect(page.locator(`article[data-ended="${secondId}"]`)).toContainText(
      t.state.cancelled,
    );
    await expect(page.locator(`article[data-ended="${secondId}"]`)).toContainText(
      `e2e over ${run}`,
    );
    await expect(page.locator(`article[data-alert="${secondId}"]`)).toHaveCount(0);

    // Every act is in the access log, under this admin's name.
    const log = await sql(
      "select action from public.audit_log where actor = $1 and entity = 'alerts' order by id",
      [admin],
    );
    expect(log.map((r) => r.action)).toEqual([
      "alert_published",
      "alert_extended",
      "alert_superseded",
      "alert_published",
      "alert_cancelled",
    ]);
  });
});
