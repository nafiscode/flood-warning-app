import { notFound, redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSessionProfile, isAdminRole, localePath } from "@/lib/auth";

/**
 * Admin console shell. Visitors go to sign-in; signed-in people who aren't admins get "not
 * found". This only decides what is shown: every admin read and write is checked again by
 * row-level security and the database functions (safety rule 5).
 */
export default async function AdminLayout({ children, params }: LayoutProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await getSessionProfile();
  if (!session) redirect(`${localePath(locale, "/sign-in")}?next=${localePath(locale, "/admin")}`);
  if (!isAdminRole(session.role)) notFound();
  const t = await getTranslations("admin");
  return (
    <div className="flex flex-col gap-5">
      <nav aria-label={t("nav.label")} className="flex flex-wrap gap-x-4 text-small">
        <Link href="/admin" className="inline-flex min-h-tap items-center font-bold underline">
          {t("nav.home")}
        </Link>
        <Link href="/admin/alerts" className="inline-flex min-h-tap items-center underline">
          {t("nav.alerts")}
        </Link>
        <Link href="/admin/war-room" className="inline-flex min-h-tap items-center underline">
          {t("nav.warRoom")}
        </Link>
        <Link href="/admin/dam-release" className="inline-flex min-h-tap items-center underline">
          {t("nav.damRelease")}
        </Link>
        <Link href="/admin/impact" className="inline-flex min-h-tap items-center underline">
          {t("nav.impact")}
        </Link>
        <Link href="/admin/authorities" className="inline-flex min-h-tap items-center underline">
          {t("nav.authorities")}
        </Link>
        <Link href="/admin/points" className="inline-flex min-h-tap items-center underline">
          {t("nav.points")}
        </Link>
        <Link href="/admin/households" className="inline-flex min-h-tap items-center underline">
          {t("nav.households")}
        </Link>
        <Link href="/admin/moderation" className="inline-flex min-h-tap items-center underline">
          {t("nav.moderation")}
        </Link>
        <Link href="/admin/safe-places" className="inline-flex min-h-tap items-center underline">
          {t("nav.safePlaces")}
        </Link>
        <Link href="/admin/field-rescues" className="inline-flex min-h-tap items-center underline">
          {t("nav.fieldRescues")}
        </Link>
        <Link href="/admin/duplicates" className="inline-flex min-h-tap items-center underline">
          {t("nav.duplicates")}
        </Link>
        <Link href="/admin/announcements" className="inline-flex min-h-tap items-center underline">
          {t("nav.announcements")}
        </Link>
        <Link href="/admin/handover" className="inline-flex min-h-tap items-center underline">
          {t("nav.handover")}
        </Link>
        <Link href="/admin/exports" className="inline-flex min-h-tap items-center underline">
          {t("nav.exports")}
        </Link>
        <Link href="/admin/log" className="inline-flex min-h-tap items-center underline">
          {t("nav.log")}
        </Link>
        {session.role === "super_admin" && (
          <Link href="/admin/invitations" className="inline-flex min-h-tap items-center underline">
            {t("nav.invitations")}
          </Link>
        )}
      </nav>
      {children}
    </div>
  );
}
