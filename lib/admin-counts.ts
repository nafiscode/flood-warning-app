import type { SupabaseClient } from "@supabase/supabase-js";
import type { MenuGroup } from "@/components/admin/AdminMenu";
import {
  ADMIN_GROUPS,
  countText,
  itemsOf,
  waitingIn,
  type AdminAccess,
  type AdminCount,
  type AdminCounts,
  type AdminGroup,
} from "@/lib/admin-menu";

/**
 * How many wait for an admin, for the menu's counts. Four head counts, run side by side as the
 * signed-in admin: row-level security lets an admin read these tables, and a count that fails is
 * simply left out rather than shown as nought.
 *
 * The feedback count is comments whose sender asked for them to be shown and that nobody has
 * said yes or no to yet (A15): until an admin looks, they are invisible to the public, so a
 * comment that waits is a person waiting.
 */
export async function readAdminCounts(supabase: SupabaseClient): Promise<AdminCounts> {
  const pending = (table: string, column: string) =>
    supabase.from(table).select("id", { count: "exact", head: true }).eq(column, "pending");
  const answers = await Promise.all([
    pending("authority_units", "status"),
    pending("field_rescues", "status"),
    pending("reports", "moderation_status"),
    pending("feedback", "public_status"),
  ]);
  const names: AdminCount[] = ["units", "fieldRescues", "reports", "feedback"];
  const counts: AdminCounts = {};
  answers.forEach((a, i) => {
    if (!a.error && typeof a.count === "number") counts[names[i]!] = a.count;
  });
  return counts;
}

type Translate = (key: string, values?: Record<string, number>) => string;

/** The menu as the layout and the admin home draw it, in the reader's language. */
export function menuGroups(
  t: Translate,
  counts: AdminCounts,
  access: AdminAccess | boolean,
): MenuGroup[] {
  return ADMIN_GROUPS.map((group: AdminGroup) => {
    const waiting = waitingIn(group, counts, access);
    return {
      key: group,
      title: t(`menu.groups.${group}.title`),
      waiting: countText(waiting),
      waitingLabel: waiting > 0 ? t("menu.waiting", { count: waiting }) : null,
      items: itemsOf(group, access).map((item) => {
        const n = item.count ? (counts[item.count] ?? 0) : 0;
        return {
          key: item.key,
          href: item.href,
          label: t(`nav.${item.key}`),
          waiting: countText(n),
          waitingLabel: n > 0 ? t("menu.waiting", { count: n }) : null,
        };
      }),
    };
  });
}
