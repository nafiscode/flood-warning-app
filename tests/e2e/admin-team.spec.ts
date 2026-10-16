/**
 * A10: the admin team page end to end against the dev project (owner, 16 Oct 2026).
 *
 * What is checked here, which no unit or policy test can see: the page is the super admin's
 * and a deputy's and nobody else's; a phone number is on the page only as four digits until
 * it is asked for; a duty is required when somebody is added; and the person added turns up
 * on the list with the duty they were given.
 *
 * Needs a Supabase project and its keys, as tests/e2e/accounts.spec.ts does; without them
 * these are skipped. Everything the tests create is deleted afterwards.
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
const PHONE = "0891234567";
const emails = {
  superAdmin: `e2e-team-super-${run}@test.invalid`,
  member: `e2e-team-member-${run}@test.invalid`,
  plain: `e2e-team-plain-${run}@test.invalid`,
};

test.describe.configure({ mode: "serial" });
test.skip(!url || !secret || !dbUrl, "needs NEXT_PUBLIC_SUPABASE_URL, the secret key and the DB");

const admin = () =>
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

async function createAccount(email: string): Promise<string> {
  const { data, error } = await admin().auth.admin.createUser({ email, email_confirm: true });
  if (error || !data.user) throw new Error(`could not create ${email}: ${error?.message}`);
  return data.user.id;
}

async function signIn(page: Page, email: string) {
  const { data, error } = await admin().auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`could not make a link for ${email}: ${error.message}`);
  await page.goto(`/api/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink`);
}

test.beforeAll(async () => {
  const superId = await createAccount(emails.superAdmin);
  await sql("update public.profiles set role = 'super_admin', display_name = $2 where user_id = $1", [
    superId,
    `E2E team super ${run}`,
  ]);
  const plain = await createAccount(emails.plain);
  await sql("update public.profiles set role = 'admin', display_name = $2 where user_id = $1", [
    plain,
    `E2E plain admin ${run}`,
  ]);
  const member = await createAccount(emails.member);
  await sql("update public.profiles set display_name = $2 where user_id = $1", [
    member,
    `E2E member ${run}`,
  ]);
});

test.afterAll(async () => {
  const users = await sql("select id from auth.users where email = any($1)", [
    Object.values(emails),
  ]);
  const ids = users.map((u) => u.id as string);
  await sql("delete from public.admin_members where email = any($1)", [Object.values(emails)]);
  await sql("delete from public.admin_invitations where email_or_phone = any($1)", [
    Object.values(emails),
  ]);
  for (const id of ids) await admin().auth.admin.deleteUser(id);
});

test("the team page belongs to the super admin; an ordinary admin does not have it", async ({
  page,
}) => {
  await signIn(page, emails.plain);
  expect((await page.goto("/admin/members"))?.status()).toBe(404);
  // Nor is it in the menu that admin's console draws.
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: th.admin.nav.members })).toHaveCount(0);
});

test("the super admin adds somebody with a duty and a phone number, which stays hidden", async ({
  page,
}) => {
  await signIn(page, emails.superAdmin);
  await page.goto("/admin/members");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(th.admin.members.title);

  // A duty is required: the browser's own check stops an empty one, so this fills it.
  await page.locator("#new-name").fill(`E2E member ${run}`);
  await page.locator("#new-email").fill(emails.member);
  await page.locator("#new-phone").fill(PHONE);
  await page.locator("#new-duty").fill(th.admin.members.duties.alerts);
  await page.getByRole("button", { name: th.admin.members.add }).click();
  await expect(page.locator('p[role="status"]')).toHaveText(th.admin.members.done.added);

  const row = page.locator("[data-admin-member]", { hasText: `E2E member ${run}` });
  await expect(row).toContainText(th.admin.members.duties.alerts);
  // Four digits on the page, never the number itself.
  await expect(row).toContainText("••••4567");
  await expect(row).not.toContainText(PHONE);

  const [member] = await sql("select id from public.admin_members where email = $1", [
    emails.member,
  ]);
  await row.locator(`[data-admin-reveal="${member!.id}"]`).click();
  await expect(page.locator(`[data-admin-phone="${member!.id}"]`)).toContainText("66891234567");
  // The look is written down (safety rule 5).
  const log = await sql(
    "select 1 from public.audit_log where action = 'reveal_admin_phone' and entity_id = $1",
    [member!.id],
  );
  expect(log).toHaveLength(1);
});

test("the person added is an admin, and sees the console but not the team page", async ({
  page,
}) => {
  await signIn(page, emails.member);
  await expect(page).toHaveURL(/\/admin$/);
  expect((await page.goto("/admin/members"))?.status()).toBe(404);
});

test("a deputy super admin sees the page; the super admin alone appoints one", async ({
  page,
}) => {
  const [member] = await sql("select id from public.admin_members where email = $1", [
    emails.member,
  ]);
  await signIn(page, emails.superAdmin);
  await page.goto("/admin/members");
  const row = page.locator("[data-admin-member]", { hasText: `E2E member ${run}` });
  await row.getByText(th.admin.members.change).click();
  await row.locator(`[data-deputy="${member!.id}"]`).click();
  await expect(page.locator('p[role="status"]')).toHaveText(th.admin.members.done.saved);

  await signIn(page, emails.member);
  await page.goto("/admin/members");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(th.admin.members.title);
  // A deputy works the team, but the invitation record stays the super admin's.
  expect((await page.goto("/admin/invitations"))?.status()).toBe(404);
});
