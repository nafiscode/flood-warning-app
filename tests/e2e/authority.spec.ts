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
async function signIn(page: Page, address = email) {
  const { data, error } = await service().auth.admin.generateLink({
    type: "magiclink",
    email: address,
  });
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
    if (sos) {
      // The evidence photos the test uploaded: Storage only lets go of a file through its API.
      const storage = service().storage.from("sos-media");
      const { data } = await storage.list(`${sos.id}/proof`);
      if (data?.length) await storage.remove(data.map((f) => `${sos!.id}/proof/${f.name}`));
      await sql("delete from public.sos_requests where id = $1", [sos.id]);
    }
    if (unitId) {
      await sql("delete from public.hero_points where unit_id = $1", [unitId]);
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

  /** The smallest real picture there is: the phone shrinks whatever it is given before sending. */
  const PHOTO = {
    name: "rescued.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    ),
  };

  /** Accept the case and report its rescue with one photo, as the team's phone does. */
  async function acceptAndReport(page: Page) {
    await signIn(page);
    await page.goto("/authority");
    const card = page.locator(`[data-case="${sos!.id}"]`);
    await card.locator("[data-accept]").click();
    await expect(card).toHaveAttribute("data-case-state", "mine");
    await card.locator("[data-complete]").click();
    // No photo, no report.
    await expect(card.locator("[data-finish-send]")).toBeDisabled();
    await card.locator("[data-finish-photos]").setInputFiles(PHOTO);
    await card.locator("[data-finish-send]").click();
    await expect(card).toHaveAttribute("data-case-state", "awaiting", { timeout: 30_000 });
    return card;
  }

  test("the team reports the rescue with a photo, and that alone does not close the case", async ({
    page,
  }) => {
    const card = await acceptAndReport(page);
    const [row] = await sql(
      `select s.status, s.closed_at, cardinality(c.completion_photos) as photos
         from public.sos_requests s
         join public.sos_claims c on c.sos_id = s.id and c.released_at is null
        where s.id = $1`,
      [sos!.id],
    );
    expect(row!.status).toBe("rescued");
    expect(row!.closed_at).toBeNull();
    expect(row!.photos).toBe(1);

    // The photo can be opened from the card, through a link and not from the board itself.
    await card.locator("[data-show-media]").click();
    await expect(card.locator('[data-media="shown"] img')).toHaveCount(1);
  });

  test("the sender who says they were not rescued gets their case looked for again", async ({
    page,
  }) => {
    await openSenderScreen(page);
    const ask = page.locator("[data-confirm-rescue]");
    await expect(ask).toContainText(UNIT);
    await ask.locator("[data-confirm-no]").click();
    await expect(ask).toHaveCount(0);
    await expect(page.locator('[data-team="searching"]')).toBeVisible();

    const [row] = await sql("select status, closed_at from public.sos_requests where id = $1", [
      sos!.id,
    ]);
    expect(row!.status).toBe("received");
    const held = await sql(
      "select 1 from public.sos_claims where sos_id = $1 and released_at is null",
      [sos!.id],
    );
    expect(held.length).toBe(0);
  });

  test("the sender's yes is what closes the case", async ({ page, browser }) => {
    await acceptAndReport(page);

    const phone = await browser.newContext({ serviceWorkers: "block" });
    const theirs = await phone.newPage();
    await openSenderScreen(theirs);
    await theirs.locator("[data-confirm-yes]").click();
    await expect(theirs.locator("[data-confirm-rescue]")).toHaveCount(0);
    await expect(theirs.getByText(th.sos.status.closed)).toBeVisible();
    await phone.close();

    const [row] = await sql("select status, closed_at from public.sos_requests where id = $1", [
      sos!.id,
    ]);
    expect(row!.status).toBe("rescued");
    expect(row!.closed_at).not.toBeNull();
    const confirmed = await sql(
      "select method from public.rescue_confirmations where sos_id = $1",
      [sos!.id],
    );
    expect(confirmed.map((r) => r.method)).toEqual(["requester"]);
  });

  test("the points, the responsibility map and the map of cases open from the console", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/authority");

    // Points exist now, because the rescue above was confirmed - and only because of that.
    await page.locator('[data-console-view="points"]').click();
    const mine = page.locator(`[data-points-row="${unitId}"]`);
    await expect(mine).toBeVisible();
    await expect(mine).toContainText(UNIT);
    expect(Number(await page.locator("[data-points-mine]").getAttribute("data-points-mine"))).toBe(
      12,
    );
    const [ledger] = await sql(
      "select points, reason from public.hero_points where unit_id = $1 and revoked_at is null",
      [unitId],
    );
    expect(ledger!.points).toBe(12);

    // The responsibility map: the totals in words, and the alarm still on screen beside it.
    await page.locator('[data-console-view="coverage"]').click();
    await expect(page.locator("[data-coverage-totals]")).toBeVisible();
    await expect(page.locator("[data-alarm]")).toBeVisible();
    await expect(page.locator('[data-map-mode="coverage"]')).toBeVisible();

    await page.locator('[data-console-view="map"]').click();
    await expect(page.locator('[data-map-mode="cases"]')).toBeVisible();
    await expect(page.getByText(th.authority.map.pickCase)).toBeVisible();

    await page.evaluate(() => window.scrollTo(9999, 0));
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });

  test("an admin confirms a rescue the person never answered, with a photo and a note", async ({
    page,
    request,
  }) => {
    // A second request in the same tambon, reported by the team and then left for 13 hours.
    const [place] = await sql(
      `select extensions.st_y(point) as lat, extensions.st_x(point) as lon
         from public.sos_requests where id = $1`,
      [sos!.id],
    );
    const sent = await request.post("/api/sos", {
      data: { lat: Number(place!.lat), lon: Number(place!.lon), deviceId: `e2e-b-${run}` },
    });
    const second = (await sent.json()) as { id: string };
    const first = sos!;
    sos = { id: second.id, token: "" };
    try {
      await acceptAndReport(page);
      await sql(
        "update public.sos_claims set completed_at = now() - interval '13 hours' where sos_id = $1 and released_at is null",
        [second.id],
      );

      const adminEmail = `e2e-team-admin-${run}@test.invalid`;
      const { data, error } = await service().auth.admin.createUser({
        email: adminEmail,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`could not create the admin: ${error?.message}`);
      try {
        await sql(
          "update public.profiles set role = 'admin', display_name = $2 where user_id = $1",
          [data.user.id, `E2E admin ${run}`],
        );
        await page.context().clearCookies();
        await signIn(page, adminEmail);
        await page.goto("/admin/war-room");

        const row = page.locator(`[data-unconfirmed-case="${second.id}"]`);
        await expect(row).toHaveAttribute("data-due", "true");
        await row.locator("[data-admin-confirm]").click();
        await row.locator("[data-finish-photos]").setInputFiles(PHOTO);
        await expect(row.locator("[data-finish-send]")).toBeDisabled();
        await row.locator("[data-finish-note]").fill("Phoned the family: all at the shelter.");
        await row.locator("[data-finish-send]").click();
        await expect(page.getByText(th.warRoom.unconfirmed.done)).toBeVisible({ timeout: 30_000 });
        await expect(row).toHaveCount(0);

        const [closed] = await sql(
          `select s.closed_at, c.method from public.sos_requests s
             join public.rescue_confirmations c on c.sos_id = s.id where s.id = $1`,
          [second.id],
        );
        expect(closed!.closed_at).not.toBeNull();
        expect(closed!.method).toBe("admin");
      } finally {
        await service().auth.admin.deleteUser(data.user.id);
      }
    } finally {
      const storage = service().storage.from("sos-media");
      const files = await storage.list(`${second.id}/proof`);
      if (files.data?.length) {
        await storage.remove(files.data.map((f) => `${second.id}/proof/${f.name}`));
      }
      await sql("delete from public.hero_points where sos_id = $1", [second.id]);
      await sql("delete from public.sos_requests where id = $1", [second.id]);
      sos = first;
    }
  });

  test("a resident registers their household, and only then does the team see it, phone apart", async ({
    page,
    browser,
  }) => {
    // The resident: an ordinary account whose saved home is in the team's tambon.
    const residentEmail = `e2e-resident-${run}@test.invalid`;
    const { data, error } = await service().auth.admin.createUser({
      email: residentEmail,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`could not create the resident: ${error?.message}`);
    const resident = data.user.id;
    let reportId = "";
    try {
      await sql(
        `update public.profiles
            set display_name = $2,
                home_point = (select s.point from public.sos_requests s where s.id = $3)
          where user_id = $1`,
        [resident, `E2E resident ${run}`, sos!.id],
      );
      // One flood report from the same spot, as the report form would leave it.
      reportId = (
        await sql(
          `insert into public.reports (reporter_id, point, depth_ref, trend, road_access, text)
           select $1, s.point, 'waist', 'rising', 'impassable', $3
             from public.sos_requests s where s.id = $2
           returning id`,
          [resident, sos!.id, `e2e ${run}`],
        )
      )[0]!.id as string;

      const home = await browser.newContext({ serviceWorkers: "block" });
      const theirs = await home.newPage();
      await signIn(theirs, residentEmail);
      await theirs.goto("/account");
      await theirs.locator('[data-household-link="home"]').click();
      await expect(theirs.locator('[data-household-form="home"]')).toBeVisible();
      // Nothing is stored without the consent tick: the browser itself will not send the form.
      await theirs.locator("#size").fill("3");
      await theirs.locator('input[name="v_elderly"]').fill("1");
      await theirs.locator("#notes").fill("Sleeps downstairs");
      await theirs.locator("#phone").fill("0812223344");
      await theirs.locator('input[name="consent"]').check();
      await theirs.locator('button[type="submit"]').first().click();
      await expect(theirs.locator('[data-household-done="saved"]')).toBeVisible();
      await home.close();

      const [row] = await sql(
        "select id, size, vulnerable, consent_at, tambon from public.households where owner_id = $1",
        [resident],
      );
      expect(row!.size).toBe(3);
      expect(row!.vulnerable).toEqual({ elderly: 1 });
      expect(row!.consent_at).not.toBeNull();

      await signIn(page);
      await page.goto("/authority");
      await page.locator('[data-console-view="households"]').click();
      const card = page.locator(`[data-household="${row!.id}"]`);
      await expect(card).toBeVisible();
      await expect(card).toContainText(`${th.sos.vulnerable.elderly} 1`);
      await expect(card).toContainText("Sleeps downstairs");
      // The list has no number in it; one is a tap away and that tap is logged.
      expect(await page.locator('[data-view="households"] a[href^="tel:"]').count()).toBe(0);
      await card.locator("[data-household-phone]").click();
      await expect(card.locator('a[href="tel:+66812223344"]')).toBeVisible();
      const logged = await sql(
        `select action from public.audit_log
          where actor = $1 and action in ('read_households', 'reveal_phone')
            and (entity = 'authority_coverage' or entity_id = $2)`,
        [userId, row!.id],
      );
      expect(logged.map((l) => l.action).sort()).toEqual(["read_households", "reveal_phone"]);

      await page.locator('[data-console-view="reports"]').click();
      const report = page.locator(`[data-report="${reportId}"]`);
      await expect(report).toContainText(`e2e ${run}`);
      await expect(report).toContainText(th.report.depths.waist);
      await expect(report).toContainText(th.authority.reports.unchecked);

      await page.evaluate(() => window.scrollTo(9999, 0));
      expect(await page.evaluate(() => window.scrollX)).toBe(0);
    } finally {
      if (reportId) await sql("delete from public.reports where id = $1", [reportId]);
      await sql("delete from public.households where owner_id = $1", [resident]);
      await service().auth.admin.deleteUser(resident);
    }
  });
});
