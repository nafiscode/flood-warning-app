/**
 * A6, the rest of the admin console, in a real browser against a real database: one admin
 * approves a report, updates a safe place, merges and un-merges two SOS, posts and withdraws an
 * announcement, writes a handover note, takes an export, and then finds all of it in the access
 * log - on the log's own page.
 *
 * Everything the test creates carries the run's marker and is removed afterwards.
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

const url = envValue("NEXT_PUBLIC_SUPABASE_URL");
const secret = envValue("SUPABASE_SECRET_KEY");
const dbUrl = envValue("SUPABASE_DB_URL");
const run = randomUUID().slice(0, 8);
const email = `e2e-tools-admin-${run}@test.invalid`;
const PLACE = `E2E โรงเรียน ${run}`;

const service = () =>
  createClient(url!, secret!, { auth: { persistSession: false, autoRefreshToken: false } });

/*
 * Clear up after an earlier run of this spec that was interrupted or failed before it had the ids
 * to delete (18 Oct: a failed run left a report sitting in the owner's moderation queue). It
 * sweeps by this spec's own prefixes only - no other spec writes these - so two spec files running
 * side by side can never delete each other's fixtures.
 */
async function sweepOldRuns() {
  await sql("delete from public.sos_requests where text like 'e2e sos %'");
  await sql("delete from public.reports where text like 'e2e report %'");
  await sql("delete from public.safe_places where name->>'th' like 'E2E โรงเรียน %'");
  const left = await sql(
    "select id from auth.users where email like 'e2e-tools-admin-%@test.invalid'",
  );
  for (const row of left as { id: string }[]) {
    await sql("delete from public.handover_notes where author_id = $1", [row.id]);
    await sql("delete from public.announcements where created_by = $1", [row.id]);
    await sql("delete from public.audit_log where actor = $1", [row.id]);
    await service().auth.admin.deleteUser(row.id);
  }
}

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

test("the tools and the export are closed to a visitor", async ({ page }) => {
  for (const path of ["moderation", "safe-places", "log", "handover", "duplicates", "exports"]) {
    await page.goto(`/admin/${path}`);
    await expect(page).toHaveURL(/\/sign-in/);
  }
  const file = await page.request.get("/api/admin/export?what=sos&full=1");
  expect(file.status()).toBe(404);
});

test.describe("an admin's round of the tools", () => {
  test.skip(!url || !secret || !dbUrl, "needs a Supabase project and its keys");
  test.setTimeout(180_000);
  let admin = "";
  let tambon = "";
  let report = "";
  let place = "";
  let first = "";
  let twin = "";

  test.beforeAll(async () => {
    const { data, error } = await service().auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw new Error(`could not create the admin: ${error?.message}`);
    admin = data.user.id;
    await sql("update public.profiles set role = 'admin', display_name = $2 where user_id = $1", [
      admin,
      `E2E tools admin ${run}`,
    ]);
    const [t] = await sql(
      "select code, extensions.st_astext(extensions.st_pointonsurface(geom)) as wkt from public.tambons where province_code = '96' order by code limit 1",
    );
    tambon = t!.code;
    const point = "extensions.st_geomfromtext($1, 4326)";
    [{ id: report }] = (await sql(
      `insert into public.reports (point, tambon, depth_ref, text) values (${point}, $2, 'knee', $3) returning id`,
      [t!.wkt, tambon, `e2e report ${run}`],
    )) as [{ id: string }];
    [{ id: place }] = (await sql(
      `insert into public.safe_places (name, type, point, tambon) values ($3::jsonb, 'school', ${point}, $2) returning id`,
      [t!.wkt, tambon, JSON.stringify({ th: PLACE })],
    )) as [{ id: string }];
    [{ id: first }] = (await sql(
      `insert into public.sos_requests (point, tambon, people_count, text) values (${point}, $2, 2, $3) returning id`,
      [t!.wkt, tambon, `e2e sos ${run}`],
    )) as [{ id: string }];
    [{ id: twin }] = (await sql(
      `insert into public.sos_requests (point, tambon, people_count, text, possible_duplicate_of) values (${point}, $2, 2, $3, $4) returning id`,
      [t!.wkt, tambon, `e2e sos ${run}`, first],
    )) as [{ id: string }];
  });

  test.afterAll(async () => {
    if (!admin) return;
    await sql("update public.sos_requests set duplicate_of = null where id = $1", [twin]);
    await sql("delete from public.sos_requests where id = any ($1)", [[twin, first]]);
    await sql("delete from public.reports where id = $1", [report]);
    await sql("delete from public.safe_places where id = $1", [place]);
    await sql("delete from public.handover_notes where author_id = $1", [admin]);
    await sql("delete from public.announcements where created_by = $1", [admin]);
    await sql("delete from public.audit_log where actor = $1", [admin]);
    await service().auth.admin.deleteUser(admin);
    await sweepOldRuns();
  });

  test("moderate, update a place, merge, announce, hand over, export, read the log", async ({
    page,
  }) => {
    await signIn(page);

    // A report waits until someone has looked; approving it moves it to the approved list.
    await page.goto("/admin/moderation");
    const waiting = page.locator(`[data-report="${report}"]`);
    await expect(waiting).toContainText(`e2e report ${run}`);
    await waiting.locator('[data-moderate="approved"]').click();
    await expect(page).toHaveURL(/done=approved/);
    await expect(page.locator(`[data-report="${report}"]`)).toHaveCount(0);
    await page.goto("/admin/moderation?status=approved");
    await expect(page.locator(`[data-report="${report}"]`)).toBeVisible();

    // A safe place: full, with what it needs, and verified.
    await page.goto(`/admin/safe-places?district=${tambon.slice(0, 4)}`);
    const card = page.locator(`[data-place="${place}"]`);
    await expect(card).toContainText(PLACE);
    await card.locator("details > summary").click();
    await card.locator('select[name="status"]').selectOption("full");
    await card.locator('input[name="needs"]').fill(`น้ำดื่ม ${run}`);
    await card.locator('input[name="capacity"]').fill("150");
    await card.locator('select[name="verification"]').selectOption("verified");
    await card.locator("[data-save-place]").click();
    await expect(page).toHaveURL(/done=saved/);
    await expect(page.locator(`[data-place="${place}"]`)).toHaveAttribute(
      "data-verification",
      "verified",
    );
    await expect(page.locator(`[data-place="${place}"]`)).toContainText(`น้ำดื่ม ${run}`);

    // Two requests from the same spot: merged, still open, and un-merged again.
    await page.goto("/admin/duplicates");
    const pair = page.locator(`[data-pair="${twin}"]`);
    await pair.locator('input[name="note"]').fill(`e2e same house ${run}`);
    await pair.locator("[data-merge]").click();
    await expect(page).toHaveURL(/done=merged/);
    const [merged] = await sql(
      "select duplicate_of, status, closed_at from public.sos_requests where id = $1",
      [twin],
    );
    expect(merged).toMatchObject({ duplicate_of: first, status: "received", closed_at: null });
    await page.locator(`[data-merged="${twin}"] [data-unmerge]`).click();
    await expect(page).toHaveURL(/done=unmerged/);
    await expect(page.locator(`[data-pair="${twin}"]`)).toBeVisible();

    // An announcement, posted and withdrawn.
    await page.goto("/admin/announcements");
    await page.locator('textarea[name="th"]').fill(`ทดสอบประกาศ ${run}`);
    await page.locator("[data-post-announcement]").click();
    await expect(page).toHaveURL(/done=posted/);
    const posted = page.locator("[data-announcement]", { hasText: `ทดสอบประกาศ ${run}` });
    await expect(posted).toHaveAttribute("data-state", "live");
    await posted.locator("[data-cancel-announcement]").click();
    await expect(page).toHaveURL(/done=cancelled/);
    await expect(
      page.locator("[data-announcement]", { hasText: `ทดสอบประกาศ ${run}` }),
    ).toHaveAttribute("data-state", "cancelled");

    // A handover note, under the admin's own name.
    await page.goto("/admin/handover");
    await page.locator('textarea[name="note"]').fill(`e2e handover ${run}`);
    await page.locator("[data-add-note]").click();
    await expect(page.locator("[data-note]").first()).toContainText(`e2e handover ${run}`);
    await expect(page.locator("[data-note]").first()).toContainText(`E2E tools admin ${run}`);

    // An export: anonymized unless asked otherwise, and nothing personal either way.
    const anon = await page.request.get("/api/admin/export?what=sos&days=7");
    expect(anon.ok()).toBe(true);
    expect(anon.headers()["content-disposition"]).toContain("jaga-sos-anonymized-7d-");
    const csv = await anon.text();
    expect(csv.split("\r\n")[0]).toContain("sos_id,created_at");
    expect(csv).not.toContain(first);
    expect(csv).not.toContain(`e2e sos ${run}`);
    const full = await page.request.get("/api/admin/export?what=sos&days=7&full=1&format=geojson");
    const geo = (await full.json()) as {
      features: { properties: Record<string, unknown>; geometry: { type: string } }[];
    };
    const mine = geo.features.find((f) => f.properties.sos_id === first);
    expect(mine?.geometry.type).toBe("Point");
    expect(JSON.stringify(mine)).not.toContain(`e2e sos ${run}`);

    // And the log has every one of those acts, readable on its own page.
    const log = await sql("select action from public.audit_log where actor = $1 order by id", [
      admin,
    ]);
    expect(log.map((r) => r.action)).toEqual([
      "report_moderated",
      "safe_place_updated",
      "sos_merged",
      "sos_unmerged",
      "announcement_posted",
      // Posting it pushes it, and reading who to push to is itself a logged access
      // (safety rule 5). Added by the push work of 13 Oct, hours after this list was written.
      "push_targets",
      "announcement_cancelled",
      "export",
      "export",
    ]);
    await page.goto("/admin/log?action=sos_merged");
    await expect(page.locator(`[data-action="sos_merged"]`).first()).toContainText(
      `E2E tools admin ${run}`,
    );
  });
});
