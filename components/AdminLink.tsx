"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { isAdminRoleName } from "@/lib/roles";
import { useMyRole } from "@/lib/use-public";

/** Nothing is fetched on the SOS screens: there, only the request matters (safety rule 1). */
const QUIET = /^\/sos(\/|$)/;

/**
 * "Admin" in the header, beside Home, Map and Account, for the few people who are admins (the
 * owner's request, 10 Oct). It goes to the same place as the button on the account page.
 *
 * Drawn in the browser, not on the server: the header is on every page, and reading the session
 * there would make every public page dynamic and cost a round trip before the alert status.
 * Nobody else sees it, and it is only a link - the admin pages turn away anyone who isn't one.
 */
export function AdminLink({ className = "" }: { className?: string }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const role = useMyRole(!QUIET.test(pathname));
  if (!isAdminRoleName(role)) return null;
  return (
    <Link
      href="/admin"
      prefetch={false}
      data-admin-link="true"
      className={`inline-flex min-h-tap items-center rounded px-2 text-small font-medium text-white underline ${className}`}
    >
      {t("admin")}
    </Link>
  );
}
