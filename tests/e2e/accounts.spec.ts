/**
 * A2 flows end to end against the dev project: first sign-in and setup, authority registration,
 * admin invitation by the super admin, and verification by a call.
 *
 * Needs a Supabase project and its keys: jaga-dev on the laptop (.env.local), a throwaway local
 * Supabase on the runner in CI (public demo keys). Without them the tests are skipped.
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
  nameless: `e2e-noname-${run}@test.invalid`,
};

test.describe.configure({ mode: "serial" });
test.skip(!url || !secret || !dbUrl, "needs a Supabase project and its keys");

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
  await createAccount(emails.nameless);
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

test("without a name, the pages of a person's own details ask for one first", async ({ page }) => {
  await signIn(page, emails.nameless);
  await page.goto("/account/places");
  await expect(page).toHaveURL(/\/account\/setup\?next=%2Faccount%2Fplaces$/);
  await expect(page.getByText(th.account.setup.nameFirst)).toBeVisible();
  await page.locator("#displayName").fill(`E2E noname ${run}`);
  await page.locator('button[type="submit"]').click();
  // The name is kept and the person lands where they were going.
  await expect(page).toHaveURL(/\/account\/places$/);
  await page.goto("/account/places");
  await expect(page).toHaveURL(/\/account\/places$/);
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

test("a watched place can be added with a pin, shows on home with Call, and can be deleted", async ({
  page,
}) => {
  await signIn(page, emails.authority);
  await page.goto("/account/places");
  await page.getByRole("link", { name: th.watched.add }).click();
  await page.locator("#label").fill("บ้านแม่");
  // A name without the consent tick is refused.
  await page.locator("#contactName").fill("แม่");
  await page.locator("#contactPhone").fill("081-234-5678");
  await page.getByRole("button", { name: th.account.home.useMap }).click();
  const map = page.locator('[data-map-ready="true"]');
  await expect(map).toBeVisible({ timeout: 30_000 });
  await tapMiddle(map);
  await expect
    .poll(async () => Number(await page.locator('input[name="lat"]').inputValue()))
    .toBeGreaterThan(5.5);
  await page.getByRole("button", { name: th.watched.save }).click();
  await expect(page.locator('main [role="alert"]')).toContainText(th.watched.error.consent);

  await page.locator("#label").fill("บ้านแม่");
  await page.locator("#contactName").fill("แม่");
  await page.locator("#contactPhone").fill("081-234-5678");
  await page.getByRole("button", { name: th.account.home.useMap }).click();
  await expect(map).toBeVisible({ timeout: 30_000 });
  await tapMiddle(map);
  await expect
    .poll(async () => Number(await page.locator('input[name="lat"]').inputValue()))
    .toBeGreaterThan(5.5);
  await page.locator('input[name="contactConsent"]').check();
  await page.getByRole("button", { name: th.watched.save }).click();
  await expect(page).toHaveURL(/\/account\/places\?done=saved$/);
  await expect(page.locator("[data-place]")).toHaveCount(1);
  await expect(page.locator('[data-place] a[href="tel:+66812345678"]')).toBeVisible();
  const [saved] = await sql(
    `select sp.tambon, sp.notify, sp.contact_consent_at from public.saved_places sp
     join auth.users u on u.id = sp.user_id where u.email = $1`,
    [emails.authority],
  );
  expect(saved!.tambon).toMatch(/^9[0456][0-9]{4}$/);
  expect(saved!.notify).toBe(true);
  expect(saved!.contact_consent_at).not.toBeNull();

  // Home lists it with one tap to call the person there.
  await page.goto("/");
  const watched = page.locator("[data-watched]");
  await expect(watched).toContainText("บ้านแม่");
  await expect(watched.locator('a[href="tel:+66812345678"]')).toContainText("แม่");
  await expect(page.locator("[data-manage-places]")).toBeVisible();

  await page.goto("/account/places");
  await page.getByRole("link", { name: th.watched.edit }).click();
  await page.getByText(th.watched.delete).click();
  await page.getByRole("button", { name: th.watched.deleteConfirm }).click();
  await expect(page).toHaveURL(/\/account\/places\?done=deleted$/);
  await expect(page.locator("[data-place]")).toHaveCount(0);
});

test("a place is found by pasting what was copied, or by its name", async ({ page }) => {
  await signIn(page, emails.authority);
  await page.goto("/account/places/new");
  const box = page.locator("#place-finder");
  const status = page.locator("[data-finder-status]");

  // Coordinates copied from a map app: Enter looks for the place and does not save the form.
  await box.fill("6.87821, 101.27191");
  await box.press("Enter");
  await expect(status).toHaveAttribute("data-finder-status", "pinned");
  await expect(page).toHaveURL(/\/account\/places\/new$/);
  await expect(page.locator('input[name="lat"]')).toHaveValue("6.878210");
  await expect(page.locator('input[name="lon"]')).toHaveValue("101.271910");
  // The pin is said in words, and the map opens by itself so it can be put right by hand.
  await expect(page.locator("[data-pin-area='tambon']")).toContainText("ปัตตานี", {
    timeout: 30_000,
  });
  await expect(page.locator("[data-map-ready]")).toBeVisible();

  // A link somebody shared, with the words a chat app puts round it.
  await box.fill("บ้านแม่ https://maps.google.com/?q=6.54321,101.28123");
  await page.locator("[data-finder-search]").click();
  await expect(page.locator('input[name="lat"]')).toHaveValue("6.543210");

  // A name: Jaga's own tambons come first, whatever the outside search adds or fails to.
  await box.fill("ต.สะเตง");
  await page.locator("[data-finder-search]").click();
  const first = page.locator("[data-finder-result='tambon']").first();
  await expect(first).toContainText("สะเตง", { timeout: 30_000 });
  await first.click();
  await expect(status).toHaveAttribute("data-finder-status", "pinned");
  expect(Number(await page.locator('input[name="lat"]').inputValue())).toBeGreaterThan(6.4);

  // A link that is not a map says so, and leaves the pin where it was.
  await box.fill("https://example.com/somewhere");
  await page.locator("[data-finder-search]").click();
  await expect(status).toHaveAttribute("data-finder-status", "unknownLink");
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

test("a started LINE sign-in keeps its one-time key for another browser", async ({
  request,
  playwright,
  baseURL,
}) => {
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  try {
    const stored = async () =>
      Number((await db.query("select count(*) as n from public.sign_in_flows")).rows[0].n);
    const before = await stored();
    const start = await request.get("/api/auth/line?locale=en", { maxRedirects: 0 });
    const location = start.headers()["location"] ?? "";
    test.skip(!location.startsWith("https://access.line.me/"), "LINE not configured here");
    expect(await stored()).toBeGreaterThan(before);
    // Another browser (no cookies) with an id nobody was given and a code LINE never issued:
    // no session.
    const other = await playwright.request.newContext({ baseURL });
    const back = await other.get(`/api/auth/callback?code=not-a-code&flow=${"A".repeat(43)}`, {
      maxRedirects: 0,
    });
    await other.dispose();
    expect(back.headers()["location"]).toMatch(/\/sign-in\?error=link$/);
  } finally {
    await db.end();
  }
});

test("a LINE sign-in started in Jaga on the home screen waits for that app", async ({
  playwright,
  baseURL,
  browser,
}) => {
  const db = new Client({ connectionString: dbUrl });
  await db.connect();
  // The app: it starts the sign-in and keeps the one-time key in its own cookies.
  const app = await playwright.request.newContext({ baseURL });
  // The phone's browser, where the LINE app comes back: no cookies of the app's.
  const phone = await browser.newContext();
  try {
    const start = await app.get("/api/auth/line?locale=en&next=/en/account&app=1", {
      maxRedirects: 0,
    });
    test.skip(
      !(start.headers()["location"] ?? "").startsWith("https://access.line.me/"),
      "LINE not configured here",
    );
    const cookies = (await app.storageState()).cookies;
    const flow = cookies.find((c) => c.name === "jaga-flow")?.value ?? "";
    expect(flow).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const nextCookie = cookies.find((c) => c.name === "jaga-flow-next")?.value ?? "";
    expect(decodeURIComponent(nextCookie)).toBe("/en/account");

    // Nothing has come back yet: the app is told to wait, and keeps asking.
    expect(await (await app.post("/api/auth/finish")).json()).toEqual({ state: "waiting" });

    // LINE comes back in the phone's browser. It is not signed in; it says "go back to Jaga".
    const page = await phone.newPage();
    await page.goto(`/api/auth/callback?code=code-line-never-issued&flow=${flow}&next=/en/account`);
    await expect(page).toHaveURL(/\/en\/account\/return-to-app\?flow=/);
    await expect(page.getByRole("heading", { name: "Go back to the Jaga app" })).toBeVisible();
    await expect(page.locator("[data-sign-in-here]")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.goto("/en/account");
    await expect(page).toHaveURL(/\/en\/sign-in/);
    const waiting = await db.query(
      "select from_app, code from public.sign_in_flows where id_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')",
      [flow],
    );
    expect(waiting.rows[0]).toEqual({ from_app: true, code: "code-line-never-issued" });

    // The app collects it. This code is made up, so the exchange is refused - but the app got
    // it, tried it with its own key, and the waiting row and its cookies are gone.
    expect(await (await app.post("/api/auth/finish")).json()).toEqual({ state: "failed" });
    expect((await app.storageState()).cookies.some((c) => c.name === "jaga-flow")).toBe(false);
    expect(await (await app.post("/api/auth/finish")).json()).toEqual({ state: "none" });
    // Collected once: the browser's own "sign in here instead" finds nothing any more.
    await page.goto(`/api/auth/callback?here=1&flow=${flow}`);
    await expect(page).toHaveURL(/\/sign-in\?error=link$/);
  } finally {
    await app.dispose();
    await phone.close();
    await db.end();
  }
});

test("the notice after a sign-in from another browser names the account and needs a session", async ({
  page,
}) => {
  await page.goto("/en/account/signed-in?next=/en/account");
  await expect(page).toHaveURL(/\/en\/sign-in$/);
  await signIn(page, emails.authority);
  await page.goto("/en/account/signed-in?next=/en/account");
  await expect(page.getByText(`E2E unit ${run}`)).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("link", { name: "Yes, continue" }).click();
  await expect(page).toHaveURL(/\/en\/account$/);
  // "Not me" signs out.
  await page.goto("/en/account/signed-in?next=/en/account");
  await page.getByRole("button", { name: "Not me, sign out" }).click();
  await page.goto("/en/account");
  await expect(page).toHaveURL(/\/en\/sign-in$/);
});
