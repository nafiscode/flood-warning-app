import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { menuGroups } from "@/lib/admin-counts";
import {
  ADMIN_GROUPS,
  ADMIN_ITEMS,
  countText,
  currentItem,
  itemsOf,
  plainPath,
  waitingIn,
} from "@/lib/admin-menu";
import { PREVIEW_ROLES } from "@/lib/role-preview";
import en from "@/messages/en.json";
import ms from "@/messages/ms.json";
import th from "@/messages/th.json";
import { renderWithIntl } from "./render";

let pathname = "/en/admin/log";
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  usePathname: () => pathname,
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: Record<string, unknown> & { children?: unknown }) => (
    <a href={String(href)} {...rest}>
      {children as never}
    </a>
  ),
}));

const ADMIN_DIR = join(process.cwd(), "app", "[locale]", "admin");

/** A translator over the English admin messages, as the layout would hand over. */
function tr(key: string, values?: Record<string, number>): string {
  const found = key.split(".").reduce<unknown>((node, part) => {
    return node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
  }, en.admin);
  if (typeof found !== "string") throw new Error(`missing admin.${key}`);
  return found.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ""));
}

describe("the admin pages, in groups", () => {
  it("puts every admin page in exactly one group, and lists no page that does not exist", () => {
    const pages = readdirSync(ADMIN_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(ADMIN_DIR, d.name, "page.tsx")))
      .map((d) => `/admin/${d.name}`);
    // The role previews are one page with the role in its address (/admin/preview/[role]).
    const previews = existsSync(join(ADMIN_DIR, "preview", "[role]", "page.tsx"))
      ? PREVIEW_ROLES.map((r) => `/admin/preview/${r}`)
      : [];
    expect(ADMIN_ITEMS.map((i) => i.href).sort()).toEqual([...pages, ...previews].sort());
    expect(new Set(ADMIN_ITEMS.map((i) => i.key)).size).toBe(ADMIN_ITEMS.length);
  });

  it("keeps what waits for an admin under review, and the public's alerts under warn", () => {
    expect(itemsOf("review", true).map((i) => i.key)).toEqual([
      "authorities",
      "fieldRescues",
      "moderation",
      // Comments waiting for a yes or a no before they can reach the public page (A15).
      "feedback",
      "duplicates",
      "safePlaces",
    ]);
    expect(itemsOf("warn", true).map((i) => i.key)).toEqual([
      "alerts",
      "damRelease",
      "announcements",
    ]);
    // Every counted page is a review page.
    expect(ADMIN_ITEMS.filter((i) => i.count).every((i) => i.group === "review")).toBe(true);
  });

  it("shows the admins page to the super admin only", () => {
    expect(itemsOf("records", true).some((i) => i.key === "invitations")).toBe(true);
    expect(itemsOf("records", false).some((i) => i.key === "invitations")).toBe(false);
  });

  it("finds the page an address belongs to, in any language and below it", () => {
    expect(plainPath("/en/admin/log/")).toBe("/admin/log");
    expect(plainPath("/admin")).toBe("/admin");
    expect(currentItem("/ms/admin/alerts/new")?.key).toBe("alerts");
    expect(currentItem("/admin/war-room")?.group).toBe("watch");
    expect(currentItem("/en/admin")).toBeNull();
  });

  it("adds up a group's waiting counts and writes them short", () => {
    const counts = { units: 2, fieldRescues: 3, reports: 140 };
    expect(waitingIn("review", counts)).toBe(145);
    expect(waitingIn("watch", counts)).toBe(0);
    expect(countText(0)).toBeNull();
    expect(countText(undefined)).toBeNull();
    expect(countText(7)).toBe("7");
    expect(countText(145)).toBe("99+");
  });
});

describe("the way back to the admin home", () => {
  async function back(path: string) {
    pathname = path;
    const { AdminBack } = await import("@/components/admin/AdminMenu");
    return renderWithIntl(<AdminBack label="Back to the admin home" />, "en").container;
  }

  it("is at the foot of every admin page but the admin home", async () => {
    expect(
      (await back("/en/admin/log")).querySelector("[data-admin-back]")?.getAttribute("href"),
    ).toBe("/admin");
    expect((await back("/th/admin/alerts/new")).querySelector("[data-admin-back]")).not.toBeNull();
    expect((await back("/en/admin")).querySelector("[data-admin-back]")).toBeNull();
  });
});

describe("the menu", () => {
  async function show(path: string) {
    pathname = path;
    const { AdminMenu } = await import("@/components/admin/AdminMenu");
    const groups = menuGroups(tr, { units: 2, fieldRescues: 1 }, false);
    return renderWithIntl(<AdminMenu label="Admin menu" home="Home" groups={groups} />, "en")
      .container;
  }

  it("has Home and every group, all shut", async () => {
    const c = await show("/en/admin/log");
    const groups = [...c.querySelectorAll("[data-admin-group]")];
    expect(groups.map((g) => g.getAttribute("data-admin-group"))).toEqual([...ADMIN_GROUPS]);
    expect(groups.every((g) => !(g as HTMLDetailsElement).open)).toBe(true);
    expect(c.querySelector('a[href="/admin"]')?.textContent).toBe("Home");
  });

  it("marks the group and the page you are on", async () => {
    const c = await show("/en/admin/log");
    expect(c.querySelector('[data-admin-group="records"] summary')?.hasAttribute("data-here")).toBe(
      true,
    );
    expect(c.querySelector('[data-admin-group="watch"] summary')?.hasAttribute("data-here")).toBe(
      false,
    );
    expect(c.querySelector('[data-admin-link="log"]')?.getAttribute("aria-current")).toBe("page");
  });

  it("counts what waits on the review group and its pages, with words for a screen reader", async () => {
    const c = await show("/en/admin");
    const badge = c.querySelector('[data-admin-waiting="review"]')!;
    expect(badge.textContent).toBe("33 waiting");
    expect(c.querySelector('[data-admin-link="authorities"]')?.textContent).toBe(
      "Verify units22 waiting",
    );
    expect(c.querySelector('[data-admin-waiting="watch"]')).toBeNull();
    // An admin who is not the super admin is not offered the admins page.
    expect(c.querySelector('[data-admin-link="invitations"]')).toBeNull();
  });

  it("never wears an alert colour", async () => {
    const c = await show("/en/admin");
    expect(c.innerHTML).not.toMatch(/bg-alert|bg-sos|text-alert/);
  });
});

describe("the words", () => {
  it("name every group in all three languages, and every page has a name", () => {
    for (const m of [th, ms, en]) {
      for (const g of ADMIN_GROUPS) {
        expect(m.admin.menu.groups[g].title.length).toBeGreaterThan(0);
        expect(m.admin.menu.groups[g].note.length).toBeGreaterThan(0);
      }
      expect(m.admin.menu.waiting).toContain("{count}");
      for (const item of ADMIN_ITEMS) {
        const name = item.key
          .split(".")
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], m.admin.nav);
        expect(typeof name === "string" && name.length > 0, item.key).toBe(true);
      }
    }
  });
});
