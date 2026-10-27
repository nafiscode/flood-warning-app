import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";

/**
 * A15 (spec 17), in a real browser at 360 px: the page opens without an account, the form asks
 * four things and requires none of them, and the invitation is nowhere near a request for help.
 *
 * The acceptance checks that need a database - a comment invisible until approved, the anonymous
 * withdrawal, a period under 20 answers publishing no average, and a visitor reading nothing of a
 * row but the four approved fields - are in tests/rls/feedback.test.ts, where they can be set up
 * and rolled back.
 */

test("opens without an account, and says it is about the app and not the flood", async ({
  page,
}) => {
  await page.goto("/en/feedback");
  await expect(page).toHaveURL(/\/en\/feedback$/);
  await expect(page.getByRole("heading", { level: 1, name: en.feedback.title })).toBeVisible();
  await expect(page.getByText(en.feedback.notFlood)).toBeVisible();
  // No sign-in wall of any kind.
  await expect(page.locator('[data-feedback-state="ready"]')).toBeVisible();
});

test("asks four things and requires none of them", async ({ page }) => {
  await page.goto("/en/feedback");
  for (const step of ["rating", "liked", "improve", "before"]) {
    await expect(page.locator(`[data-feedback-step="${step}"]`), step).toBeVisible();
  }
  // Every face carries its word and its number, so the step is never the drawing alone.
  for (let n = 1; n <= 5; n += 1) {
    const face = page.locator(`[data-feedback-rating="${n}"]`);
    await expect(face).toBeVisible();
    await expect(face).toContainText((en.feedback.words as Record<string, string>)[String(n)]!);
    await expect(face).toContainText(String(n));
  }
  // An empty form is told, not marked red, and nothing is sent.
  await page.locator("[data-feedback-send]").click();
  await expect(page.getByText(en.feedback.form.nothing)).toBeVisible();
  await expect(page.locator('[data-feedback-state="ready"]')).toBeVisible();
});

test("offers the public page only once there are words, and keeps the two consents apart", async ({
  page,
}) => {
  await page.goto("/en/feedback");
  const publicTick = page.locator("[data-feedback-public-ok]");
  await expect(publicTick).toBeDisabled();
  await expect(page.getByText(en.feedback.form.publicNeedsWords)).toBeVisible();

  await page.locator('[data-feedback-note="improve"]').fill("the map is hard to read on my phone");
  await expect(publicTick).toBeEnabled();
  await publicTick.check();
  // A display name appears, and empty means anonymous.
  await expect(page.locator("[data-feedback-name]")).toBeVisible();
  await expect(page.getByText(en.feedback.form.displayNameHint)).toBeVisible();

  // Agreeing to be shown is not agreeing to be contacted.
  await expect(page.locator("[data-feedback-contact-ok]")).not.toBeChecked();
  await expect(page.locator("[data-feedback-contact]")).toHaveCount(0);
});

test("the chips wrap and every tap target is big enough at 360 px", async ({ page }) => {
  await page.goto("/en/feedback");
  const chips = page.locator("[data-feedback-chip]");
  await expect(chips.first()).toBeVisible();
  const boxes = await chips.evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { top: Math.round(r.top), height: Math.round(r.height), right: Math.round(r.right) };
    }),
  );
  expect(boxes.length).toBeGreaterThan(15);
  // More than one row: ten chips in a list do not fit across a phone.
  expect(new Set(boxes.map((b) => b.top)).size).toBeGreaterThan(2);
  for (const box of boxes) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.right).toBeLessThanOrEqual(361);
  }
  // No horizontal page scroll.
  const widths = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(widths[0]).toBeLessThanOrEqual(widths[1]! + 1);
});

test("Rate Jaga is at the end of an ordinary page and nowhere near a request for help", async ({
  page,
}) => {
  await page.goto("/en/map");
  await expect(page.locator("[data-feedback-link] a")).toHaveAttribute("href", "/en/feedback");
  for (const path of ["/en/sos", "/en/supplies", "/en/report", "/en/feedback"]) {
    await page.goto(path);
    await expect(page.locator("[data-feedback-link]"), path).toHaveCount(0);
  }
});

test("the page carries no donation prompt and no alert level", async ({ page }) => {
  await page.goto("/en/feedback");
  const text = (await page.locator("[data-feedback-page]").textContent()) ?? "";
  for (const word of ["Donate", "donation", "PromptPay"]) {
    expect(text).not.toContain(word);
  }
  // No level badge and no hazard icon anywhere in the page's own content (safety rules 3 and 6).
  await expect(page.locator("[data-feedback-page] [data-alert-badge]")).toHaveCount(0);
  await expect(page.locator("[data-feedback-page] [data-alert-level]")).toHaveCount(0);
});
