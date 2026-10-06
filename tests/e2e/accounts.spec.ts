/**
 * A2 flows end to end against the dev project: first sign-in and setup, authority registration,
 * admin invitation by the super admin, and verification by a call.
 *
 * Needs SUPABASE_SECRET_KEY and SUPABASE_DB_URL (.env.local on the laptop). CI has no secrets,
 * so these tests are skipped there; the database rules behind them are covered by tests/rls.
 * Sign-in uses one-time links made with the Auth admin API, so no email is sent. Everything the
 * tests create is deleted afterwards.
 */
import { createClient } from "@supabase/supabase-js";
import { expect, type Locator, type Page, test } from "@playwright/test";
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
const ORG = `E2E Rescue ${run}`;
const emails = {
  superAdmin: `e2e-super-${run}@test.invalid`,
  invited: `e2e-admin-${run}@test.invalid`,
  authority: `e2e-unit-${run}@test.invalid`,
};

test.describe.configure({ mode: "serial" });
test.skip(!url || !secret || !dbUrl, "needs the dev project's keys (.env.local)");

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

/** Sign in through the same route an email link uses, without sending an email. */
async function signIn(page: Page, email: string) {
  const { data, error } = await admin().auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`could not make a link for ${email}: ${error.message}`);
  await page.goto(`/api/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink`);
}

/** Tap the middle of a map: the middle of the service area is land in a covered province. */
async function tapMiddle(map: Locator) {
  const box = (await map.boundingBox())!;
  await map.click({ position: { x: box.width / 2, y: box.height / 2 } });
}

async function finishSetup(page: Page, name: string) {
  await expect(page).toHaveURL(/\/account\/setup/);
  await page.locator("#displayName").fill(name);
  await page.locator('button[type="submit"]').click();
}

test.beforeAll(async () => {
  const id = await createAccount(emails.superAdmin);
  await createAccount(emails.authority);
  // The first super admin is set in the database (scripts/admin.mjs does the same for the owner).
  await sql(
    "update public.profiles set role = 'super_admin', display_name = $2 where user_id = $1",
    [id, `E2E super ${run}`],
  );
});

test.afterAll(async () => {
  const users = await sql("select id from auth.users where email = any($1)", [
    Object.values(emails),
  ]);
  const ids = users.map((u) => u.id as string);
  await sql("delete from public.admin_invitations where invited_by = any($1)", [ids]);
  for (const id of ids) await admin().auth.admin.deleteUser(id);
  await sql("delete from public.organizations where name = $1", [ORG]);
});

test("first sign-in asks for a name, then shows the account as a plain user", async ({ page }) => {
  await signIn(page, emails.authority);
  await finishSetup(page, `E2E unit ${run}`);
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText(th.account.role.user)).toBeVisible();
  // Not an admin: the admin console doesn't exist for this person.
  const response = await page.goto("/admin");
  expect(response?.status()).toBe(404);
});

test("the home location can be set with a pin on the map", async ({ page }) => {
  await signIn(page, emails.authority);
  await page.goto("/account/setup");
  await page.getByRole("button", { name: th.account.home.useMap }).click();
  const map = page.locator('[data-map-ready="true"]');
  await expect(map).toBeVisible({ timeout: 30_000 });
  await tapMiddle(map);
  // The middle of the service area is on land, inside the covered provinces.
  await expect
    .poll(async () => Number(await page.locator('input[name="lat"]').inputValue()))
    .toBeGreaterThan(5.5);
  expect(Number(await page.locator('input[name="lon"]').inputValue())).toBeGreaterThan(100);
  await page.locator('input[name="locationConsent"]').check();
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/account$/);
  const [profile] = await sql(
    "select p.home_tambon from public.profiles p join auth.users u on u.id = p.user_id where u.email = $1",
    [emails.authority],
  );
  expect(profile!.home_tambon).toMatch(/^9[0456][0-9]{4}$/);
});

test("coverage can be chosen on the map, and the list follows", async ({ page }) => {
  await signIn(page, emails.authority);
  await page.goto("/authority/register");
  await page.getByRole("button", { name: th.authorityRegister.coverage.useMap }).click();
  const map = page.locator('[data-map-ready="true"]');
  await expect(map).toBeVisible({ timeout: 30_000 });
  const ticked = page.locator('input[name="tambon"]:checked');
  await tapMiddle(map);
  await expect(ticked).toHaveCount(1);
  await expect(
    page.getByText(th.authorityRegister.coverage.mapCount.replace("{count}", "1")),
  ).toBeVisible();
  // Tapping the same tambon again takes it out.
  await tapMiddle(map);
  await expect(ticked).toHaveCount(0);
  // A whole province ticked in the list is counted on the map.
  await page.locator('input[name="province"][value="94"]').check();
  const [{ n }] = (await sql(
    "select count(*)::int as n from public.tambons where province_code = '94'",
  )) as [{ n: number }];
  await expect(
    page.getByText(th.authorityRegister.coverage.mapCount.replace("{count}", String(n))),
  ).toBeVisible();
});

test("an authority registers and stays pending", async ({ page }) => {
  await signIn(page, emails.authority);
  await page.goto("/authority/register");
  await page.locator('input[name="orgType"][value="volunteer"]').check();
  await page.locator("#orgName").fill(ORG);
  await page.locator("#unitName").fill("Boat team 1");
  await page.locator("#pocName").fill("Somchai Test");
  await page.locator("#pocPhone").fill("081-234-5678");
  await page.locator('input[name="capability"][value="rescue"]').check();
  await page.locator('input[name="province"][value="94"]').check();
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/account\?registered=1/);
  await expect(page.getByText(th.account.authority.status.pending)).toBeVisible();
  await expect(page.getByText(th.account.role.user)).toBeVisible();

  const [unit] = await sql(
    `select u.status, c.poc_phone, c.poc_phone_verified, c.poc_phone_verified_by_call,
            (select count(*)::int from public.authority_coverage ac where ac.unit_id = u.id) as tambons,
            (select count(*)::int from public.tambons where province_code = '94') as expected
     from public.authority_units u
     join public.organizations o on o.id = u.org_id
     join public.authority_unit_contacts c on c.unit_id = u.id
     where o.name = $1`,
    [ORG],
  );
  expect(unit).toMatchObject({
    status: "pending",
    poc_phone: "+66812345678",
    poc_phone_verified: false,
    poc_phone_verified_by_call: false,
  });
  expect(unit!.tambons).toBe(unit!.expected);
});

test("only an invited email becomes an admin, and only after signing in with it", async ({
  page,
  browser,
}) => {
  await signIn(page, emails.superAdmin);
  await page.goto("/admin/invitations");
  await page.locator("#email").fill(emails.invited);
  await page.locator('button[type="submit"]').first().click();
  await expect(page.locator('p[role="status"]')).toHaveText(th.admin.invitations.done.invited);
  const [before] = await sql(
    "select p.role from public.profiles p join auth.users u on u.id = p.user_id where u.email = $1",
    [emails.invited],
  );
  expect(before!.role).toBe("user");

  const context = await browser.newContext();
  const invited = await context.newPage();
  await signIn(invited, emails.invited);
  await finishSetup(invited, `E2E admin ${run}`);
  await expect(invited).toHaveURL(/\/admin$/);
  await expect(invited.getByRole("heading", { level: 1 })).toHaveText(th.admin.title);
  // An admin, not a super admin: the invitations page doesn't exist for them.
  const response = await invited.goto("/admin/invitations");
  expect(response?.status()).toBe(404);
  await context.close();
});

test("an admin verifies the unit only after confirming the phone by a call", async ({ page }) => {
  await signIn(page, emails.invited);
  await page.goto("/admin/authorities");
  const unit = page.locator("section", { hasText: ORG });
  await expect(unit).not.toContainText("+66812345678");
  await unit.getByRole("link").click();
  await expect(unit).toContainText("+66812345678");

  await unit.locator('button[type="submit"]').click();
  await expect(page.locator('p[role="alert"]')).toHaveText(th.admin.authorities.error.call);

  await page.locator("section", { hasText: ORG }).locator('input[name="called"]').check();
  await page.locator("section", { hasText: ORG }).locator('button[type="submit"]').click();
  await expect(page.locator('p[role="status"]')).toHaveText(th.admin.authorities.done.verified);

  const [row] = await sql(
    `select u.status, c.poc_phone_verified_by_call, p.role,
            (select count(*)::int from public.audit_log a
             where a.entity_id = u.id::text and a.action = 'reveal_phone') as reveals
     from public.authority_units u
     join public.organizations o on o.id = u.org_id
     join public.authority_unit_contacts c on c.unit_id = u.id
     join public.profiles p on p.user_id = u.user_id
     where o.name = $1`,
    [ORG],
  );
  expect(row).toMatchObject({
    status: "verified",
    poc_phone_verified_by_call: true,
    role: "authority",
  });
  expect(row!.reveals).toBeGreaterThanOrEqual(1);
});

test("signing out ends the session", async ({ page }) => {
  await signIn(page, emails.authority);
  await page.goto("/account");
  await expect(page.getByText(th.account.role.authority)).toBeVisible();
  await page.locator('form[action="/api/auth/sign-out"] button').click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in/);
});
