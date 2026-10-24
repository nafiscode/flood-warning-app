/**
 * The admin console's pages, in four groups (the owner, 14 Oct: the flat row of links had grown
 * too long). Pure, so the header menu and the admin home draw from one list and a test can hold
 * every page to exactly one group.
 *
 * - watch: what is happening now
 * - warn: everything that reaches the public
 * - review: things that wait for an admin's decision, each with a count of what is waiting
 * - records: people's details, points, notes between shifts, exports, the access log, the admins
 * - preview: each role's own screens with made-up data (the owner, 14 Oct; lib/role-preview.ts)
 */

export const ADMIN_GROUPS = ["watch", "warn", "review", "records", "preview"] as const;
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
  /**
   * Who may open it: "super" the super admin alone, "manage" those who work the admin team
   * (the super admin and a deputy super admin). Absent means every admin.
   */
  only?: "super" | "manage";
};

/** What this session is allowed, as the menu needs to know it. */
export type AdminAccess = { superAdmin: boolean; manages: boolean };

export const ADMIN_ITEMS: readonly AdminItem[] = [
  { key: "warRoom", href: "/admin/war-room", group: "watch" },
  { key: "signals", href: "/admin/signals", group: "watch" },
  { key: "impact", href: "/admin/impact", group: "watch" },
  { key: "usage", href: "/admin/usage", group: "watch" },
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
  { key: "members", href: "/admin/members", group: "records", only: "manage" },
  { key: "invitations", href: "/admin/invitations", group: "records", only: "super" },
  { key: "preview.visitor", href: "/admin/preview/visitor", group: "preview" },
  { key: "preview.resident", href: "/admin/preview/resident", group: "preview" },
  { key: "preview.rescue", href: "/admin/preview/rescue", group: "preview" },
  { key: "preview.supplies", href: "/admin/preview/supplies", group: "preview" },
  { key: "preview.crew", href: "/admin/preview/crew", group: "preview" },
  { key: "preview.pending", href: "/admin/preview/pending", group: "preview" },
  { key: "preview.operator", href: "/admin/preview/operator", group: "preview" },
];

/**
 * The pages of one group this admin may open. A plain `true` or `false` means both of
 * `AdminAccess` at once, which is what a test or an example page wants.
 */
export function itemsOf(group: AdminGroup, access: AdminAccess | boolean): AdminItem[] {
  const a: AdminAccess =
    typeof access === "boolean" ? { superAdmin: access, manages: access } : access;
  return ADMIN_ITEMS.filter(
    (i) => i.group === group && (!i.only || (i.only === "super" ? a.superAdmin : a.manages)),
  );
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
export function waitingIn(
  group: AdminGroup,
  counts: AdminCounts,
  access: AdminAccess | boolean = true,
): number {
  return itemsOf(group, access).reduce((sum, i) => sum + (i.count ? (counts[i.count] ?? 0) : 0), 0);
}

/** A count as shown: nothing for none, "99+" past 99. */
export function countText(count: number | undefined): string | null {
  if (!count || count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}
