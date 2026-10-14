"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { signInHref } from "@/lib/sign-in-link";
import { useSignedIn } from "@/lib/use-public";

/** On these screens the request is all that matters: no invitation to sign in (safety rule 1). */
const QUIET = /^\/(sos|supplies)(\/|$)/;

const plain =
  "inline-flex min-h-tap items-center rounded px-2 text-small font-medium text-white underline";

/**
 * The header's last link: "Sign in" for a visitor, "Account" once signed in (the owner, 15 Oct:
 * people should see from the first page that an account gives them more). The invitation is a
 * filled pill so it reads as a button; it brings the person back to the page they were on.
 * Drawn in the browser for the same reason as the Admin link: the header is on every page, and
 * reading the session on the server would make every public page dynamic.
 */
export function AccountLink() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const signedIn = useSignedIn();

  if (signedIn || QUIET.test(pathname) || pathname === "/sign-in") {
    return (
      <Link href="/account" prefetch={false} className={plain} data-account-link="account">
        {t("account")}
      </Link>
    );
  }
  return (
    // A plain anchor: the address already carries the locale prefix and the way back.
    <a
      href={signInHref(locale, pathname)}
      data-account-link="sign-in"
      className="ms-1 inline-flex min-h-tap items-center py-1.5"
    >
      <span className="inline-flex items-center rounded-full bg-jaga-teal-light px-3 py-1 text-small font-bold text-jaga-slate shadow-sm">
        {t("signIn")}
      </span>
    </a>
  );
}
