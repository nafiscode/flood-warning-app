/**
 * A rescue a team found by itself, in a real browser against a real database (the owner,
 * 13-14 Oct): a verified team records one where it stands - the phone's own position, a phone
 * number, a real photo uploaded to the private bucket - a second one at the same spot is held as
 * a possible repeat, and an admin looks at the number (logged), approves it, and the half points
 * arrive.
 *
 * Everything the test creates is removed afterwards.
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
const teamEmail = `e2e-field-team-${run}@test.invalid`;
const adminEmail = `e2e-field-admin-${run}@test.invalid`;
const UNIT = `E2E field team ${run}`;
const digits = String(Number.parseInt(run, 16) % 10_000_000).padStart(7, "0");
const PHONE_A = `081${digits}`;
const PHONE_B = `082${digits}`;

/** The smallest real picture there is: the phone shrinks whatever it is given before sending. */
const PHOTO = {
  name: "rescue.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
};

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

async function signIn(page: Page, email: string) {
  const { data, error } = await service().auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`could not make a link: ${error.message}`);
  await page.goto(`/api/auth/confirm?token_hash=${data.properties.hashed_token}&type=magiclink`);
}

test.use({ serviceWorkers: "block" });

test("recording is closed to a visitor", async ({ page }) => {
  await page.goto("/authority/field-rescue");
  await expect(page).toHaveURL(/\/sign-in/);
  const post = await page.request.post("/api/authority/field-rescue", { data: {} });
  expect(post.status()).toBe(401);
  await page.goto("/admin/field-rescues");
  await expect(page).toHaveURL(/\/sign-in/);
});

test.describe("a team records, an admin decides", () => {
  test.skip(!url || !secret || !dbUrl, "needs a Supabase project and its keys");
  test.setTimeout(180_000);
  let teamUser = "";
  let adminUser = "";
  let orgId = "";
  let unitId = "";
  let place = { code: "", lat: 0, lon: 0 };

  test.beforeAll(async () => {
    const team = await service().auth.admin.createUser({ email: teamEmail, email_confirm: true });
    const admin = await service().auth.admin.createUser({ email: adminEmail, email_confirm: true });
    if (!team.data.user || !admin.data.user) throw new Error("could not create the accounts");
    teamUser = team.data.user.id;
    adminUser = admin.data.user.id;
    await sql(
      "update public.profiles set role = 'authority', display_name = $2 where user_id = $1",
      [teamUser, `E2E field crew ${run}`],
    );
    await sql("update public.profiles set role = 'admin', display_name = $2 where user_id = $1", [
      adminUser,
      `E2E field admin ${run}`,
    ]);
    const [t] = await sql(
      `select t.code, extensions.st_y(extensions.st_pointonsurface(t.geom)) as lat,
              extensions.st_x(extensions.st_pointonsurface(t.geom)) as lon
         from public.tambons t where t.province_code = '96' order by t.code desc limit 1`,
    );
    place = { code: t!.code, lat: Number(t!.lat), lon: Number(t!.lon) };
    orgId = (
      await sql(
        "insert into public.organizations (name, type, official_phone) values ($1, 'volunteer', '073000456') returning id",
        [`E2E field org ${run}`],
      )
    )[0]!.id as string;
    unitId = (
      await sql(
        `insert into public.authority_units (org_id, user_id, unit_name, capabilities, status)
         values ($1, $2, $3, '{rescue}'::public.authority_capability[], 'verified') returning id`,
        [orgId, teamUser, UNIT],
      )
    )[0]!.id as string;
    await sql(
      "insert into public.authority_unit_contacts (unit_id, poc_name, poc_phone) values ($1, 'E2E POC', '66830000456')",
      [unitId],
    );
    await sql(
      "insert into public.authority_coverage (unit_id, tambon, selected_level, selected_code) values ($1, $2, 'tambon', $2)",
      [unitId, place.code],
    );
  });

  test.afterAll(async () => {
    if (unitId) {
      const ids = (
        await sql("select id from public.field_rescues where unit_id = $1", [unitId])
      ).map((r) => String(r.id));
      // Storage only lets go of a file through its API.
      const storage = service().storage.from("field-media");
      for (const id of ids) {
        const { data } = await storage.list(`${unitId}/${id}`);
        if (data?.length) await storage.remove(data.map((f) => `${unitId}/${id}/${f.name}`));
      }
      await sql("delete from public.hero_points where unit_id = $1", [unitId]);
      await sql("delete from public.field_rescues where unit_id = $1", [unitId]);
      await sql("delete from public.authority_coverage where unit_id = $1", [unitId]);
      await sql("delete from public.authority_unit_contacts where unit_id = $1", [unitId]);
      await sql("delete from public.authority_units where id = $1", [unitId]);
    }
    if (orgId) await sql("delete from public.organizations where id = $1", [orgId]);
    await sql("delete from public.audit_log where actor = any ($1)", [[teamUser, adminUser]]);
    if (teamUser) await service().auth.admin.deleteUser(teamUser);
    if (adminUser) await service().auth.admin.deleteUser(adminUser);
  });

  async function fill(page: Page, phone: string, people: string) {
    await expect(page.locator('[data-field-position="found"]')).toBeVisible();
    await page.locator("#field-people").fill(people);
    await page.locator("#field-phone").fill(phone);
    await page.locator("[data-field-photos]").setInputFiles(PHOTO);
    await page.locator("[data-field-send]").click();
    await expect(page.locator("[data-field-result]")).toBeVisible({ timeout: 60_000 });
  }

  test("record at the place with a number and a photo; a repeat is held; an admin approves", async ({
    page,
    context,
    browser,
  }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: place.lat, longitude: place.lon, accuracy: 12 });
    await signIn(page, teamEmail);

    // The way in is on the team's own board.
    await page.goto("/authority");
    await page.locator("[data-field-rescue-link]").click();
    await expect(page).toHaveURL(/\/authority\/field-rescue$/);
    await expect(page.locator("main")).toContainText(th.fieldRescue.rules.half);

    // Nothing is sent without the phone number.
    await page.locator("[data-field-send]").click();
    await expect(page.locator("[data-field-error]")).toHaveAttribute("data-field-error", "phone");

    await fill(page, PHONE_A, "2");
    const firstStatus = await page.locator("[data-field-result]").getAttribute("data-field-result");
    expect(["counted", "pending"]).toContain(firstStatus);
    const [first] = await sql(
      `select f.id, f.status, f.tambon, cardinality(f.photos) as photos, c.contact_phone,
              (select count(*)::int from storage.objects o
                where o.bucket_id = 'field-media' and o.name = any (f.photos)) as stored
         from public.field_rescues f join public.field_rescue_contacts c on c.rescue_id = f.id
        where f.unit_id = $1`,
      [unitId],
    );
    expect(first).toMatchObject({
      status: firstStatus,
      tambon: place.code,
      photos: 1,
      stored: 1,
      contact_phone: PHONE_A,
    });

    // The same spot again, minutes later: held as a possible repeat, whatever else is true.
    await page.locator("[data-field-result] button").click();
    await fill(page, PHONE_B, "2");
    await expect(page.locator("[data-field-result]")).toHaveAttribute(
      "data-field-result",
      "pending",
    );
    await expect(page.locator('[data-hold="repeat_nearby"]')).toBeVisible();
    const [second] = await sql(
      "select f.id from public.field_rescues f join public.field_rescue_contacts c on c.rescue_id = f.id where f.unit_id = $1 and c.contact_phone = $2",
      [unitId, PHONE_B],
    );
    const secondId = String(second!.id);
    expect(
      await sql("select 1 from public.hero_points where field_rescue_id = $1", [secondId]),
    ).toHaveLength(0);

    // An admin sees why it waits, looks at the number (logged), and approves.
    const desk = await browser.newContext({ serviceWorkers: "block" });
    const admin = await desk.newPage();
    await signIn(admin, adminEmail);
    await admin.goto("/admin/field-rescues");
    const held = admin.locator(`[data-field-rescue="${secondId}"]`);
    await expect(held).toContainText(UNIT);
    await expect(held.locator("[data-holds]")).toHaveAttribute("data-holds", /repeat_nearby/);
    await expect(held.locator("img")).toHaveCount(1);
    expect(await admin.locator("main").innerText()).not.toContain(PHONE_B);
    await held.locator("[data-field-reveal]").click();
    await expect(
      admin.locator(`[data-field-rescue="${secondId}"] [data-field-phone]`),
    ).toContainText(PHONE_B);
    await admin.locator(`[data-field-rescue="${secondId}"] [data-field-approve]`).click();
    await expect(admin).toHaveURL(/done=approved/);
    await desk.close();

    // Two people through an SOS would be 10 + 2 x 2 = 14 points; this is worth half.
    const [award] = await sql(
      "select points from public.hero_points where field_rescue_id = $1 and revoked_at is null",
      [secondId],
    );
    expect(award!.points).toBe(7);
    const log = await sql(
      "select action from public.audit_log where actor = $1 and entity = 'field_rescues' order by id",
      [adminUser],
    );
    expect(log.map((r) => r.action)).toEqual(["reveal_phone", "field_rescue_reviewed"]);

    // The team sees it approved, with its points, on its own records and on My requests.
    await page.reload();
    await expect(page.locator('[data-field-record="approved"]')).toContainText("7");
    await page.goto("/requests");
    await expect(page.locator(`[data-request="field:${secondId}"]`)).toHaveAttribute(
      "data-request-open",
      "false",
    );
  });
});
