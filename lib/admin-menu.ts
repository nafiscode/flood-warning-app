/**
 * The admin console's pages, in four groups (the owner, 14 Oct: the flat row of links had grown
 * too long). Pure, so the header menu and the admin home draw from one list and a test can hold
 * every page to exactly one group.
 *
 * - watch: what is happening now
 * - warn: everything that reaches the public
 * - review: things that wait for an admin's decision, each with a count of what is waiting
 * - records: people's details, points, notes between shifts, exports, the access log, the admins
 */

export const ADMIN_GROUPS = ["watch", "warn", "review", "records"] as const;
export type AdminGroup = (typeof ADMIN_GROUPS)[number];

/** What a review page counts: how many are waiting for an admin. */
export type AdminCount = "units" | "fieldRescues" | "reports";
export type AdminCounts = Partial<Record<AdminCount, number>>;

export type AdminItem = {
  /** The key under `admin.nav`. */
  key: string;
  href: string;
  group: AdminGroup;
  count?: AdminCount;
  superOnly?: boolean;
};

export const ADMIN_ITEMS: readonly AdminItem[] = [
  { key: "warRoom", href: "/admin/war-room", group: "watch" },
  { key: "signals", href: "/admin/signals", group: "watch" },
  { key: "impact", href: "/admin/impact", group: "watch" },
  { key: "alerts", href: "/admin/alerts", group: "warn" },
  { key: "damRelease", href: "/admin/dam-release", group: "warn" },
  { key: "announcements", href: "/admin/announcements", group: "warn" },
  { key: "authorities", href: "/admin/authorities", group: "review", count: "units" },
  { key: "fieldRescues", href: "/admin/field-rescues", group: "review", count: "fieldRescues" },
  { key: "moderation", href: "/admin/moderation", group: "review", count: "reports" },
  { key: "duplicates", href: "/admin/duplicates", group: "review" },
  { key: "safePlaces", href: "/admin/safe-places", group: "review" },
  { key: "households", href: "/admin/households", group: "records" },
  { key: "points", href: "/admin/points", group: "records" },
  { key: "handover", href: "/admin/handover", group: "records" },
  { key: "exports", href: "/admin/exports", group: "records" },
  { key: "log", href: "/admin/log", group: "records" },
  { key: "invitations", href: "/admin/invitations", group: "records", superOnly: true },
];

/** The pages of one group this admin may open. */
export function itemsOf(group: AdminGroup, superAdmin: boolean): AdminItem[] {
  return ADMIN_ITEMS.filter((i) => i.group === group && (superAdmin || !i.superOnly));
}

/** The address without its language prefix, e.g. "/en/admin/log" -> "/admin/log". */
export function plainPath(pathname: string): string {
  const path = pathname.replace(/^\/(en|ms|th)(?=\/|$)/, "") || "/";
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/** The page the address belongs to, also for pages under it ("/admin/alerts/new"). */
export function currentItem(pathname: string): AdminItem | null {
  const path = plainPath(pathname);
  return ADMIN_ITEMS.find((i) => path === i.href || path.startsWith(`${i.href}/`)) ?? null;
}

/** How many wait in a group: the sum of its counted pages. */
export function waitingIn(group: AdminGroup, counts: AdminCounts, superAdmin = true): number {
  return itemsOf(group, superAdmin).reduce(
    (sum, i) => sum + (i.count ? (counts[i.count] ?? 0) : 0),
    0,
  );
}

/** A count as shown: nothing for none, "99+" past 99. */
export function countText(count: number | undefined): string | null {
  if (!count || count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}
