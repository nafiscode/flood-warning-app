import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AdminMenu } from "@/components/admin/AdminMenu";
import { menuGroups, readAdminCounts } from "@/lib/admin-counts";
import { getSessionProfile, isAdminRole, localePath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

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
  return (
    <div className="flex flex-col gap-5">
      <AdminMenu
        label={t("nav.label")}
        home={t("nav.home")}
        groups={menuGroups(
          (key, values) => t(key as never, values as never),
          counts,
          session.role === "super_admin",
        )}
      />
      {children}
    </div>
  );
}
