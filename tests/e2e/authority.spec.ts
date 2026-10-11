/**
 * A5: the authority console and the sender's "a team is coming" screen, in a real browser at
 * 360 px.
 *
 * The first block needs nothing: the console and its two routes are closed to everyone without a
 * verified unit. The second needs a Supabase project and its keys (jaga-dev on the laptop, a
 * throwaway Supabase on the CI runner). It sends one real SOS through the public route, lets a
 * verified team accept it from the console, and then reads the sender's own screen. Everything it
 * creates is deleted afterwards.
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
const email = `e2e-team-${run}@test.invalid`;
const UNIT = `E2E boat team ${run}`;
const POC_PHONE = "66830000123";
const SENDER_PHONE = "0810000123";

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

test.describe("closed to everyone without a verified team", () => {
  test("a visitor is sent to sign in, and the routes give nothing away", async ({ page }) => {
    await page.goto("/authority");
    await expect(page).toHaveURL(/\/sign-in/);

    const board = await page.request.get("/api/authority/board");
    expect(board.status()).toBe(404);
    expect(await board.text()).not.toContain("cases");

    const act = await page.request.post("/api/authority/act", {
      data: { action: "accept", sos: randomUUID() },
    });
    expect(act.status()).toBe(404);
  });
});

test.describe("a team accepts, and the sender sees who is coming", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(!url || !secret || !dbUrl, "needs a Supabase project and its keys");
  // The answers are real ones from the database, which a service worker would only get in the way of.
  test.use({ serviceWorkers: "block" });

  let userId = "";
  let orgId = "";
  let unitId = "";
  let sos: { id: string; token: string } | null = null;

  test.beforeAll(async ({ request }) => {
    const { data, error } = await service().auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw new Error(`could not create the account: ${error?.message}`);
    userId = data.user.id;
    await sql(
      "update public.profiles set role = 'authority', display_name = $2 where user_id = $1",
      [userId, `E2E team ${run}`],
    );

    // The tambon the fewest teams cover. On the CI runner's empty database that is nobody, so
    // the relay asks this team first; on jaga-dev the owner's own test units may be asked before
    // it, which is why the test below accepts from either state.
    const [place] = await sql(
      `select t.code, extensions.st_y(extensions.st_pointonsurface(t.geom)) as lat,
              extensions.st_x(extensions.st_pointonsurface(t.geom)) as lon
         from public.tambons t
        where t.province_code = '96'
        order by (select count(*) from public.authority_coverage c where c.tambon = t.code), t.code
        limit 1`,
    );
    if (!place) throw new Error("no tambon to test in");

    orgId = (
      await sql(
        "insert into public.organizations (name, type, official_phone) values ($1, 'volunteer', '073000123') returning id",
        [`E2E org ${run}`],
      )
    )[0]!.id as string;
    unitId = (
      await sql(
        `insert into public.authority_units (org_id, user_id, unit_name, capabilities, status)
         values ($1, $2, $3, '{rescue}'::public.authority_capability[], 'verified') returning id`,
        [orgId, userId, UNIT],
      )
    )[0]!.id as string;
    await sql(
      "insert into public.authority_unit_contacts (unit_id, poc_name, poc_phone) values ($1, $2, $3)",
      [unitId, "E2E POC", POC_PHONE],
    );
    await sql(
      "insert into public.authority_coverage (unit_id, tambon, selected_level, selected_code) values ($1, $2, 'tambon', $2)",
      [unitId, place.code],
    );

    // The SOS itself goes in the way a phone sends it: through the public route, as a visitor.
    const sent = await request.post("/api/sos", {
      data: {
        lat: Number(place.lat),
        lon: Number(place.lon),
        accuracy: 15,
        deviceId: `e2e-${run}`,
        phone: SENDER_PHONE,
      },
    });
    expect(sent.ok()).toBe(true);
    const body = (await sent.json()) as { id: string; token: string };
    expect(body.token).toBeTruthy();
    sos = { id: body.id, token: body.token };
  });

  test.afterAll(async () => {
    if (sos) await sql("delete from public.sos_requests where id = $1", [sos.id]);
    if (unitId) {
      await sql("delete from public.authority_coverage where unit_id = $1", [unitId]);
      await sql("delete from public.authority_unit_contacts where unit_id = $1", [unitId]);
      await sql("delete from public.authority_units where id = $1", [unitId]);
    }
    if (orgId) await sql("delete from public.organizations where id = $1", [orgId]);
    if (userId) await service().auth.admin.deleteUser(userId);
  });

  async function openSenderScreen(page: Page) {
    await page.addInitScript(
      ([id, token]) => {
        window.localStorage.setItem(
          "jaga.sos.cases",
          JSON.stringify([{ id, token, status: "received", createdAt: new Date().toISOString() }]),
        );
      },
      [sos!.id, sos!.token],
    );
    await page.goto(`/sos/${sos!.id}`);
  }

  test("before anyone accepts, the sender is told so and given the hotlines, not a promise", async ({
    page,
  }) => {
    await openSenderScreen(page);
    const block = page.locator('[data-team="searching"]');
    await expect(block).toBeVisible();
    await expect(block.locator('a[href="tel:1784"]')).toBeVisible();
    await expect(page.getByText(th.sos.team.accepted)).toHaveCount(0);
  });

  test("the team sees the case, accepts it, and is asked for an estimate only then", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/authority");

    const card = page.locator(`[data-case="${sos!.id}"]`);
    // Being offered to this team, or to one asked before it: either way it is on the board and
    // can be accepted at any second (spec 5.2).
    await expect(card).toHaveAttribute("data-case-state", /^(offered_to_me|searching)$/);
    if ((await card.getAttribute("data-case-state")) === "offered_to_me") {
      await expect(card.locator("[data-countdown]")).toBeVisible();
    }
    // Nothing on the board is a phone number, and no estimate is asked before accepting.
    expect(await page.locator('[data-case] a[href^="tel:"]').count()).toBe(0);
    await expect(card.locator("[data-eta-ask]")).toHaveCount(0);

    // No sideways scrolling at 360 px, the whole page and not only an inner strip.
    await page.evaluate(() => window.scrollTo(9999, 0));
    expect(await page.evaluate(() => window.scrollX)).toBe(0);

    await card.locator("[data-accept]").click();
    await expect(card).toHaveAttribute("data-case-state", "mine");
    await expect(card.locator("[data-eta-ask]")).toBeVisible();
    await card.locator('[data-eta="to30"]').click();
    await expect(card.locator('[data-eta-given="to30"]')).toBeVisible();

    await card.locator('[data-advance="en_route"]').click();
    await expect(card.locator('[data-advance="on_site"]')).toBeVisible();

    // The sender's number: one tap, and that look is in the access log.
    await card.locator("[data-show-phone]").click();
    await expect(card.locator('[data-phone="shown"] a[href^="tel:"]')).toBeVisible();
    const looks = await sql(
      "select 1 from public.audit_log where actor = $1 and action = 'reveal_phone'",
      [userId],
    );
    expect(looks.length).toBeGreaterThan(0);
  });

  test("the sender then sees the team, its estimate as a range, and can call it", async ({
    page,
  }) => {
    await openSenderScreen(page);
    const block = page.locator('[data-team="accepted"]');
    await expect(block).toBeVisible();
    await expect(block).toContainText(UNIT);
    await expect(block.locator('[data-team-eta="to30"]')).toContainText(th.sos.team.eta.to30);
    // No number until the sender asks for it.
    expect(await block.locator('a[href^="tel:"]').count()).toBe(0);

    await block.locator("[data-team-call]").click();
    await expect(block.locator(`a[href="tel:${POC_PHONE}"]`)).toBeVisible();
    // The one exception to "personal numbers are never public" is logged like any other look.
    const looks = await sql(
      "select 1 from public.audit_log where action = 'reveal_responder_phone' and entity_id = $1",
      [sos!.id],
    );
    expect(looks.length).toBeGreaterThan(0);
  });

  test("giving the case back takes a reason and leaves nobody holding it", async ({ page }) => {
    await signIn(page);
    await page.goto("/authority");
    const card = page.locator(`[data-case="${sos!.id}"]`);
    await card.locator("[data-release]").click();
    await card.locator('[data-release-reason="no_boat"]').click();
    await expect(card).not.toHaveAttribute("data-case-state", "mine");
    await expect(card.locator("[data-accept]")).toBeVisible();
    const held = await sql(
      "select 1 from public.sos_claims where sos_id = $1 and released_at is null",
      [sos!.id],
    );
    expect(held.length).toBe(0);
  });
});
