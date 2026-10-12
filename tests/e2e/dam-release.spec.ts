/**
 * A12: sending the dam release notice, in a real browser at 360 px (spec section 15).
 *
 * The first block needs nothing and checks the screen is shut to everyone but an admin. The
 * second needs a Supabase project and its keys (jaga-dev on the laptop, a throwaway Supabase on
 * the CI runner): it signs an admin in, reads the notice the template builds, sends it, sees it
 * arrive on a public screen, and **withdraws it in the same test**, then deletes the row. A dam
 * release is the loudest thing Jaga can say, so nothing here may leave one standing.
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
const email = `e2e-dam-${run}@test.invalid`;

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

test.describe("closed to everyone but an admin", () => {
  test("a visitor is sent to sign in", async ({ page }) => {
    await page.goto("/admin/dam-release");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe("sending one", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!url || !secret || !dbUrl, "needs a Supabase project and its keys");
  test.setTimeout(90_000);

  test.beforeAll(async () => {
    const { data, error } = await service().auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw new Error(`could not create the admin: ${error?.message}`);
    await sql("update public.profiles set role = 'admin', display_name = $2 where user_id = $1", [
      data.user.id,
      `E2E dam ${run}`,
    ]);
  });

  test.afterAll(async () => {
    // Whatever happened above, no notice of this test's making is left in force anywhere.
    await sql(
      `delete from public.alerts
        where signals_snapshot->>'kind' = 'dam_release'
          and issued_by in (select user_id from public.profiles where display_name = $1)`,
      [`E2E dam ${run}`],
    );
    const users = await sql("select id from auth.users where email = $1", [email]);
    for (const u of users) await service().auth.admin.deleteUser(u.id as string);
  });

  test("builds the notice from the template, sends it, and withdraws it again", async ({
    page,
  }) => {
    await signIn(page);
    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto("/admin/dam-release");
    await expect(page.locator("[data-dam-release-form]")).toBeVisible();

    // The zone is shown and has no control of its own: it is S7's, not the sender's.
    const form = page.locator("[data-dam-release-form]");
    await expect(form).toContainText(th.admin.damRelease.zone.replace("{count}", "39"));
    expect(await form.locator("input[name='tambon'], select[name='tambon']").count()).toBe(0);

    await page.fill("#releaseCms", "650");
    const preview = page.locator("[data-dam-release-preview]");
    // Every part of the reviewed template, with the figure in it - and nothing typed by hand.
    await expect(preview).toContainText("650");
    await expect(preview).toContainText(th.dam.release.act);
    await expect(preview).toContainText(th.dam.release.estimate);
    expect(await preview.textContent()).not.toMatch(/[{}]/);

    await page.getByRole("button", { name: th.admin.damRelease.send }).click();
    await page.waitForURL(/done=sent/, { timeout: 30_000 });

    // It is in force: an alert with the dam's zone, and the gates time a person entered.
    const sent = await sql(
      `select a.id, a.level::text level, a.signals_snapshot->>'release_cms' cms,
              (select count(*) from public.alert_tambons t where t.alert_id = a.id) tambons
         from public.alerts a
         join public.profiles p on p.user_id = a.issued_by
        where p.display_name = $1 and a.cancelled_at is null`,
      [`E2E dam ${run}`],
    );
    expect(sent.length).toBe(1);
    expect(Number(sent[0]!.cms)).toBe(650);
    expect(Number(sent[0]!.tambons)).toBeGreaterThan(30);

    // And a phone in the zone can read it, in the Thai the template wrote.
    const status = await page.request.get("/api/public/status");
    const body = await status.json();
    const alert = (body.alerts as { id: string; messages: Record<string, string> }[]).find(
      (a) => a.id === sent[0]!.id,
    );
    expect(alert).toBeTruthy();
    expect(alert!.messages.th).toContain(th.dam.release.estimate);

    // Withdrawn at once: this is a test, and nothing it sent may stand.
    await page.getByRole("button", { name: th.admin.damRelease.cancel }).first().click();
    await page.waitForURL(/done=cancelled/, { timeout: 30_000 });
    const after = await page.request.get("/api/public/status");
    const left = ((await after.json()).alerts as { id: string }[]).map((a) => a.id);
    expect(left).not.toContain(sent[0]!.id);
  });
});
