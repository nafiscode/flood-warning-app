import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminBack, AdminMenu } from "@/components/admin/AdminMenu";
import { menuGroups, readAdminCounts } from "@/lib/admin-counts";
import { canManageAdmins } from "@/lib/admin-team";
import { getSessionProfile, isAdminRole, localePath } from "@/lib/auth";
import { PRIVATE_PAGE } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";

/**
 * Every page under /admin, in one place: a crawler that reaches one of them by a link from
 * anywhere must not keep it. robots.txt asks it not to fetch these; this is the half that still
 * holds when it arrived another way.
 */
export const metadata: Metadata = PRIVATE_PAGE;

/**
 * Admin console shell. Visitors go to sign-in; signed-in people who aren't admins get "not
 * found". The menu groups the pages and counts what waits for an admin (lib/admin-menu.ts).
 * This only decides what is shown: every admin read and write is checked again by
 * row-level security and the database functions (safety rule 5).
 */
export default async function AdminLayout({ children, params }: LayoutProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSessionProfile();
  if (!session) redirect(`${localePath(locale, "/sign-in")}?next=${localePath(locale, "/admin")}`);
  if (!isAdminRole(session.role)) notFound();
  const t = await getTranslations("admin");
  const counts = await readAdminCounts(await createClient());
  // The admin team page belongs to the super admin and to a deputy super admin (A10).
  const access = {
    superAdmin: session.role === "super_admin",
    manages: session.role === "super_admin" || (await canManageAdmins()),
  };
  return (
    <div className="flex flex-col gap-5">
      <AdminMenu
        label={t("nav.label")}
        home={t("nav.home")}
        groups={menuGroups(
          (key, values) => t(key as never, values as never),
          counts,
          access,
        )}
      />
      {children}
      <AdminBack label={t("nav.back")} />
    </div>
  );
}
