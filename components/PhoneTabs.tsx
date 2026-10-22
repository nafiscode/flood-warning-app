"use client";

import type { ComponentType } from "react";
import { useLocale, useTranslations } from "next-intl";
import { HouseIcon, LifebuoyIcon, MapIcon, PersonIcon } from "@/components/icons";
import { Link, usePathname } from "@/i18n/navigation";
import { signInHref } from "@/lib/sign-in-link";
import { useSignedIn } from "@/lib/use-public";

/** Where someone is asking for help the screen is theirs: no tabs to wander off by (safety rule 1). */
const QUIET = /^\/(sos|supplies)(\/|$)/;

type Tab = {
  key: "home" | "map" | "sos" | "account";
  Icon: ComponentType<{ size?: number }>;
  here: (path: string) => boolean;
};

const TABS: Tab[] = [
  { key: "home", Icon: HouseIcon, here: (p) => p === "/" },
  { key: "map", Icon: MapIcon, here: (p) => /^\/map(\/|$)/.test(p) },
  { key: "sos", Icon: LifebuoyIcon, here: (p) => /^\/sos(\/|$)/.test(p) },
  { key: "account", Icon: PersonIcon, here: (p) => /^\/(account|sign-in)(\/|$)/.test(p) },
];

/**
 * The tab bar of a phone (Apple's HIG for iPhone: the top-level places at the foot of the screen,
 * under the thumb, each an icon with a word, never hidden). Home, the map, SOS and the account
 * are here; the languages, the colours and the pages people read sit behind the menu button in
 * the header, so the header can be one row.
 *
 * SOS is the one filled cell: it is the one thing that must be a single tap from every page, and
 * Apple's advice for a row of equals is one standout, shown by style rather than size. The tab
 * for someone not signed in goes to sign-in and brings them back where they were, as the old
 * "Sign in" pill did. From a tablet's width the header carries all of this again.
 */
export function PhoneTabs() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const signedIn = useSignedIn();
  if (QUIET.test(pathname)) return null;

  const label = (key: Tab["key"]) =>
    key === "map" ? t("mapShort") : key === "sos" ? t("sos") : t(key);

  return (
    <nav aria-label={t("tabs")} data-phone-tabs className="border-t border-jaga-line bg-jaga-surface sm:hidden">
      <ul className="grid grid-cols-4">
        {TABS.map(({ key, Icon, here }) => {
          const current = here(pathname);
          const cell = `relative flex flex-col items-center justify-center gap-0.5 px-1 py-1 text-center leading-tight ${
            key === "sos"
              ? "mx-1 my-0.5 min-h-12 rounded-xl bg-sos py-0.5 font-bold text-sos-fg"
              : current
                ? "min-h-14 font-bold text-jaga-text before:absolute before:inset-x-3 before:top-0 before:h-1 before:rounded-b before:bg-jaga-teal"
                : "min-h-14 text-jaga-text-2"
          }`;
          const body = (
            <>
              <Icon size={24} />
              <span className="text-small leading-tight">{label(key)}</span>
            </>
          );
          if (key === "account" && !signedIn) {
            return (
              <li key={key}>
                <a
                  href={signInHref(locale, pathname)}
                  aria-current={current ? "page" : undefined}
                  data-phone-tab={key}
                  className={cell}
                >
                  {body}
                </a>
              </li>
            );
          }
          return (
            <li key={key}>
              <Link
                href={key === "home" ? "/" : `/${key}`}
                prefetch={false}
                aria-current={current ? "page" : undefined}
                data-phone-tab={key}
                className={cell}
              >
                {body}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
