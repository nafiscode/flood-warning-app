/**
 * A9: colour contrast on the rendered pages, by day and at night (the theme follows the sun).
 * axe-core measures every piece of text against what is really drawn behind it, which the unit
 * tests of the tokens cannot: a token can pass on paper and fail on a tinted card. Public data is
 * made up and served here, so the alert colours are on screen without touching a database.
 * Proven to bite (15 Oct): one paragraph turned to #c8c8c8 on the day theme is a violation.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

const BANA = {
  code: "940104",
  nameTh: "บานา",
  nameEn: "Bana",
  districtTh: "เมืองปัตตานี",
  districtEn: "Mueang Pattani",
  provinceTh: "ปัตตานี",
  provinceEn: "Pattani",
  lat: 6.87821,
  lon: 101.27191,
  from: "list",
};

// 10:00 and 22:00 in Thailand: the day and the night theme.
const DAY = new Date("2026-11-20T03:00:00Z");
const NIGHT = new Date("2026-11-20T15:00:00Z");

const at = (now: Date, minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();

async function serve(page: Page, now: Date, level: string | null) {
  await page.route("**/api/public/status", (route) =>
    route.fulfill({
      json: {
        generatedAt: now.toISOString(),
        inService: true,
        alerts: level
          ? [
              {
                id: `e2e-${level}`,
                hazard: "flood",
                level,
                reason: "ระดับน้ำที่สถานีทดสอบสูงขึ้น",
                messages: { th: "ข้อความทดสอบ" },
                issuedAt: at(now, -60),
                nextUpdateAt: at(now, 120),
                onset: null,
                returnWindow: null,
                source: null,
                tambons: [BANA.code],
              },
            ]
          : [],
      },
    }),
  );
  await page.route("**/api/public/places*", (route) =>
    route.fulfill({ json: { people: [], parking: [] } }),
  );
  await page.route("**/api/public/map", (route) =>
    route.fulfill({ json: { places: [], reports: [], gauges: [] } }),
  );
  // Everything else public that a page asks for answers "not available": the pages must stay
  // readable then too.
  for (const path of ["weather**", "reports*", "dam*", "sea*", "tambon-risk*", "outlook*"]) {
    await page.route(`**/api/public/${path}`, (route) =>
      route.fulfill({ status: 503, json: { error: "unavailable" } }),
    );
  }
  await page.addInitScript(
    (stored) => window.localStorage.setItem("jaga.area", JSON.stringify(stored)),
    BANA,
  );
}

async function contrast(page: Page) {
  // Give the page's own entrances (fades, count-ups) time to finish.
  await page.clock.runFor(3_000);
  /*
   * The frozen header and the hotline bar sit over the page, and axe cannot tell what is behind
   * text they overlap: it calls that "incomplete", not a failure. Unfrozen for the measurement,
   * every piece of text has one thing behind it.
   */
  await page.addStyleTag({
    content: "header, footer, [data-map-chips-float] { position: static !important; }",
  });
  const result = await new AxeBuilder({ page })
    .withRules(["color-contrast"])
    // MapLibre's own controls and credits are its styling, drawn over a picture.
    .exclude(".maplibregl-ctrl")
    .analyze();
  // What axe could not decide (text over a gradient or a picture) is listed with the result.
  const unsure = result.incomplete.flatMap((v) => v.nodes.map((n) => n.target.join(" ")));
  if (unsure.length > 0)
    test.info().annotations.push({ type: "contrast not decided", description: unsure.join(" | ") });
  return result.violations.flatMap((v) =>
    v.nodes.map((n) => `${n.target.join(" ")}: ${n.failureSummary?.split("\n").at(-1)?.trim()}`),
  );
}

const PAGES: { path: string; level: string | null }[] = [
  { path: "/", level: null },
  { path: "/", level: "watch" },
  { path: "/", level: "warning" },
  { path: "/", level: "evacuate" },
  { path: "/map", level: "warning" },
  { path: "/sos", level: null },
  { path: "/supplies", level: null },
  { path: "/report", level: null },
  { path: "/requests", level: null },
  { path: "/sign-in", level: null },
  { path: "/offline", level: null },
  { path: "/en", level: "evacuate" },
];

test.describe("text stands out from what is behind it (WCAG AA)", () => {
  test.use({ serviceWorkers: "block" });

  for (const [when, now] of [
    ["day", DAY],
    ["night", NIGHT],
  ] as const) {
    for (const { path, level } of PAGES) {
      test(`${path}${level ? ` at ${level}` : ""}, ${when}`, async ({ page }) => {
        await page.clock.install({ time: now });
        await serve(page, now, level);
        await page.goto(path);
        await expect(page.locator("main")).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute(
          "data-theme",
          when === "day" ? "light" : "dark",
        );
        expect(await contrast(page)).toEqual([]);
      });
    }
  }
});
