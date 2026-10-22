"use client";

import { useLocale, useTranslations } from "next-intl";
import { BellIcon, PinIcon, ShieldIcon } from "@/components/icons";
import { Link, usePathname } from "@/i18n/navigation";
import { useInstallWanted } from "@/components/InstallCard";
import { installDevice } from "@/lib/install";
import { reveal } from "@/lib/reveal";
import { signInHref } from "@/lib/sign-in-link";
import { offerCard } from "@/lib/ui";
import { useHasUnit, useSignedIn } from "@/lib/use-public";

/** One way in: an icon, what it gives, and the words that do it. */
function Way({
  icon,
  body,
  children,
}: {
  icon: React.ReactNode;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-jaga-ground text-jaga-teal-ink">
        {icon}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-small leading-snug text-jaga-text-2">{body}</span>
        {children}
      </span>
    </li>
  );
}

/** The link or button that does it, with a thumb's worth of room around the words. */
const way =
  "relative inline-flex min-h-tap items-center font-bold text-jaga-ink underline after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']";

/**
 * The three things the map asks of a reader, in one card they can see (the owner, 23 Oct 2026:
 * "make that part a bit easy to see, since we want to promote people to log in and Install Jaga
 * on their device to get alerts. And Register their team for getting the SOS help request").
 *
 * It was two dashed grey lines in the rail, the same weight as a legend's footnote, and the
 * three asks are the whole point of the page for anyone not yet signed in. Each row is dropped
 * the moment it is done: signed in, installed, or already holding a unit.
 *
 * Nothing here is a door: SOS, the alert levels and the hotlines never need any of it (safety
 * rules 1 and 4). The install row only points at the card below, which is the one place the
 * steps for each kind of device are written.
 */
export function MapJoin() {
  const t = useTranslations("map.join");
  const tOffer = useTranslations("signInOffer");
  const tInstall = useTranslations("install");
  const tUnit = useTranslations("unitWay");
  const locale = useLocale();
  const pathname = usePathname();
  const signedIn = useSignedIn();
  const hasUnit = useHasUnit();
  /*
   * The same question the card below asks, asked in the one place it lives: already installed,
   * already done, or inside a "Not now", and this row is not drawn - it would point at a card
   * that is not there.
   */
  const canInstall = useInstallWanted("home");
  if (signedIn && hasUnit && !canInstall) return null;
  const device = canInstall
    ? installDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0)
    : null;
  return (
    <section data-map-join="true" aria-labelledby="map-join-title" className={offerCard}>
      <div className="flex flex-col gap-0.5">
        <h3 id="map-join-title" className="font-bold text-jaga-ink">
          {t("title")}
        </h3>
        <p className="text-small text-jaga-text-2">{t("sub")}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {!signedIn && (
          <Way icon={<PinIcon size={20} />} body={tOffer("hint.mapPlaces")}>
            <a href={signInHref(locale, pathname)} className={way} data-map-join-in="true">
              {tOffer("hintLink")}
            </a>
          </Way>
        )}
        {device && (
          <Way icon={<BellIcon size={20} />} body={tInstall(`line.${device}`)}>
            <button
              type="button"
              data-map-join-install="true"
              onClick={() => reveal(() => document.querySelector<HTMLElement>("[data-install]"))}
              className={way}
            >
              {tInstall("lineShow")}
            </button>
          </Way>
        )}
        {!hasUnit && (
          <Way icon={<ShieldIcon size={20} />} body={tUnit("quiet")}>
            <Link
              href="/authority/register"
              prefetch={false}
              data-unit-register="map"
              className={way}
            >
              {tUnit("register")}
            </Link>
          </Way>
        )}
      </ul>
    </section>
  );
}
