import type { Page } from "@playwright/test";

/**
 * On a phone the header is one row and the languages, the colours, About, Sign in and Admin sit
 * behind its menu button (components/PhoneMenu). Tests at 360 px open it before using them.
 */
export async function openPhoneMenu(page: Page) {
  const menu = page.locator("[data-phone-menu]");
  if (!(await menu.isVisible())) await page.locator("[data-phone-menu-button]").click();
  await menu.waitFor({ state: "visible" });
  return menu;
}
