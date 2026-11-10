/**
 * A19, where a road may be holding water back: the door, in a real browser at 360 px.
 *
 * This spec deliberately needs no data. What it guards is the half that has to hold whatever is
 * in the database: that the page and its three files give nothing to a visitor, a resident or a
 * rescue team, and that nothing of the feature has leaked into the public app (safety rule 6).
 *
 * Who sees what once the rows ARE there is a question about policies, and it is answered where it
 * can be answered properly, in a transaction that is rolled back: tests/rls/highway-paths.test.ts
 * walks a planning office in its own province, one in another province, a rescue-only unit, a
 * resident, a visitor and an admin through every read. An e2e test would need a verified planning
 * unit and 4,366 loaded sections on the shared dev database to say less than that does.
 */
import { expect, test } from "@playwright/test";
import en from "../../messages/en.json";

test.use({ serviceWorkers: "block", viewport: { width: 360, height: 640 } });

test.describe("the door", () => {
  test("a visitor is sent to sign in and the files give nothing away", async ({ page }) => {
    await page.goto("/en/authority/highway-paths");
    await expect(page).toHaveURL(/\/sign-in/);

    for (const query of [
      "province=94&format=map",
      "province=94&format=csv",
      "province=94&format=geojson",
      // A province the four do not include, and a code that is not one at all.
      "province=10&format=csv",
      "province=9&format=csv",
      "province=../94&format=csv",
      "format=csv",
      "province=94&format=sql",
    ]) {
      const response = await page.request.get(`/api/authority/highway-paths?${query}`);
      expect(response.status(), query).toBe(404);
      const body = await response.text();
      expect(body, query).not.toContain("FeatureCollection");
      expect(body, query).not.toContain("upstream_side");
    }
  });

  test("nothing of it is in the public app", async ({ page }) => {
    // The two words the feature is named by, on the pages a resident actually opens.
    const words = [
      en.highwayPaths.title.toLowerCase(),
      "highway-paths",
      "holding water back",
    ];
    for (const path of ["/en", "/en/map", "/en/sos", "/en/features", "/en/how-it-works"]) {
      await page.goto(path);
      const text = ((await page.locator("body").textContent()) ?? "").toLowerCase();
      const html = (await page.content()).toLowerCase();
      for (const word of words) {
        expect(text, `${path}: ${word}`).not.toContain(word);
      }
      // Not as a link either, visible or not.
      expect(html, path).not.toContain("authority/highway-paths");
    }
  });

  test("it is not in the sitemap or offered to a crawler", async ({ page }) => {
    const sitemap = await page.request.get("/sitemap.xml");
    expect(await sitemap.text()).not.toContain("highway-paths");
  });
});
