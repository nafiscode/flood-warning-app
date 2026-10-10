/**
 * A7: the bell in the header, in a real browser at 360 px (the owner's request, 10 Oct). The
 * feed is made up here and served in place of the public endpoint, so no alert is ever put in a
 * database for a test.
 */
import { expect, type Page, test } from "@playwright/test";
import th from "../../messages/th.json";

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

const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const NOTICES = [
  {
    kind: "alert",
    id: "11111111-1111-4111-8111-111111111111",
    hazard: "flood",
    level: "warning",
    reason: "ระดับน้ำที่สถานีทดสอบสูงขึ้น",
    messages: { th: "ข้อความทดสอบเตือนภัย" },
    issuedAt: days(1),
    nextUpdateAt: days(0),
    endedAt: null,
    source: null,
    tambons: [BANA.code],
  },
  {
    kind: "alert",
    id: "22222222-2222-4222-8222-222222222222",
    hazard: "flood",
    level: "watch",
    reason: "ฝนตกหนัก",
    messages: { th: "ข้อความทดสอบเฝ้าระวัง" },
    issuedAt: days(5),
    nextUpdateAt: days(4),
    endedAt: days(3),
    source: null,
    tambons: [BANA.code],
  },
  {
    kind: "announcement",
    id: "33333333-3333-4333-8333-333333333333",
    hazard: null,
    level: null,
    reason: "",
    messages: { th: "ข้อความทดสอบประกาศ" },
    issuedAt: days(2),
    nextUpdateAt: null,
    endedAt: null,
    source: null,
    tambons: [],
  },
];

async function serve(page: Page, notices: unknown[] = NOTICES) {
  let asked = 0;
  await page.route("**/api/public/notices*", (route) => {
    asked += 1;
    return route.fulfill({ json: { notices } });
  });
  await page.route("**/api/public/status", (route) =>
    route.fulfill({
      json: { generatedAt: new Date().toISOString(), inService: false, alerts: [] },
    }),
  );
  await page.route("**/api/public/places*", (route) =>
    route.fulfill({ json: { people: [], parking: [] } }),
  );
  await page.route("**/api/public/weather**", (route) =>
    route.fulfill({ status: 503, json: { error: "unavailable" } }),
  );
  await page.addInitScript(
    (stored) => window.localStorage.setItem("jaga.area", JSON.stringify(stored)),
    BANA,
  );
  return () => asked;
}

const bell = (page: Page) => page.locator("[data-notice-bell]");

test.describe("the bell", () => {
  // Requests that pass through the service worker can't be answered by a test, so it is off here.
  test.use({ serviceWorkers: "block" });

  test("counts what was missed, and the list says what each one is", async ({ page }) => {
    await serve(page);
    await page.goto("/");
    // Three rows, four items: the watch alert was raised and later lifted.
    await expect(bell(page)).toHaveAttribute("data-notice-bell", "4");
    await expect(bell(page)).toHaveAttribute(
      "aria-label",
      th.notices.openWithCount.replace("{count}", "4"),
    );

    await bell(page).click();
    const panel = page.locator("[data-notice-panel]");
    await expect(panel).toBeVisible();
    await expect(panel.getByText(th.notices.title)).toBeVisible();

    const items = page.locator("[data-notice]");
    await expect(items).toHaveCount(4);
    // Newest first: yesterday's warning, the announcement, then the lifted watch and its raising.
    await expect(items.nth(0)).toHaveAttribute("data-notice", "alert");
    await expect(items.nth(1)).toHaveAttribute("data-notice", "announcement");
    await expect(items.nth(2)).toHaveAttribute("data-notice", "alertEnded");

    // An alert carries its level as icon, word and colour together (safety rule 3).
    await expect(items.nth(0).locator("[data-level='warning']")).toBeVisible();
    await expect(items.nth(0).getByText("ข้อความทดสอบเตือนภัย")).toBeVisible();
    // The one that ended keeps its level and says so in words, never by colour alone.
    await expect(items.nth(2).locator("[data-level='watch']")).toBeVisible();
    await expect(items.nth(2).getByText(th.notices.ended)).toBeVisible();
    // An announcement is never dressed as an alert: no level badge at all.
    await expect(items.nth(1).locator("[data-level]")).toHaveCount(0);
    await expect(items.nth(1).getByText(th.notices.announcementNote)).toBeVisible();
  });

  test("opening it is reading it, and it stays read after a reload", async ({ page }) => {
    await serve(page);
    await page.goto("/");
    await expect(bell(page)).toHaveAttribute("data-notice-bell", "4");
    await bell(page).click();
    await expect(bell(page)).toHaveAttribute("data-notice-bell", "0");
    // The marks stay while the panel is open, so they can see what was new.
    await expect(page.locator("[data-notice][data-unread='true']")).toHaveCount(4);

    await page.keyboard.press("Escape");
    await expect(page.locator("[data-notice-panel]")).toHaveCount(0);

    await page.reload();
    await expect(bell(page)).toHaveAttribute("data-notice-bell", "0");
    await bell(page).click();
    await expect(page.locator("[data-notice][data-unread='true']")).toHaveCount(0);
  });

  test("with nothing missed it says so, and points at what would come here", async ({ page }) => {
    await serve(page, []);
    await page.goto("/");
    await expect(bell(page)).toHaveAttribute("data-notice-bell", "0");
    await bell(page).click();
    await expect(page.getByText(th.notices.none)).toBeVisible();
    await expect(page.getByText(th.notices.noneHint)).toBeVisible();
  });

  test("nothing is asked for on the SOS screen (safety rule 1)", async ({ page }) => {
    const asked = await serve(page);
    await page.goto("/sos");
    await expect(page.locator("main")).toBeVisible();
    await page.waitForTimeout(1500);
    expect(asked()).toBe(0);
    // The bell is still there, with whatever the phone already knew.
    await expect(bell(page)).toBeVisible();
  });

  test("it costs the header no height at 360 px", async ({ page }) => {
    await serve(page);
    await page.goto("/");
    await expect(bell(page)).toBeVisible();
    const withBell = await page.locator("header").boundingBox();
    // The tap target is a full 48 px even though the button is drawn narrower (CLAUDE.md).
    const box = (await bell(page).boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(48);
    await page.addStyleTag({ content: "[data-notice-bell]{display:none!important}" });
    const without = await page.locator("header").boundingBox();
    expect(withBell!.height).toBe(without!.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
});
