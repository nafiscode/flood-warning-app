"use client";

import { useTranslations } from "next-intl";
import { ShieldIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { useHasUnit } from "@/lib/use-public";
import { buttonPrimary, hint, offerCard } from "@/lib/ui";

/** How many visits on this device the full card stays for, before it becomes one quiet line. */
export const UNIT_WAY_VISITS = 3;
export const UNIT_WAY_KEY = "unitWay";
export const UNIT_WAY_SESSION = "jaga.unitWay.counted";

export type UnitWayState = { visits: number };

/**
 * The full card, or the one line? Kept pure so a test can fix the visit count without a browser.
 * Nothing stored yet means the full card: a first visit is the whole point of it.
 */
export function unitWayFull(state: UnitWayState | null, hasUnit: boolean | null): boolean {
  if (hasUnit) return false;
  return !state || state.visits <= UNIT_WAY_VISITS;
}

/**
 * The way in for a rescue unit, an อปพร. volunteer or an agency (the owner, 18 Oct: ten people had
 * signed in and no unit had registered, because no page said a unit could). The button goes
 * straight to the form, which signs a visitor in itself and brings them back, so nothing here
 * needs to know whether anyone is signed in.
 */
export function UnitCard() {
  const t = useTranslations("unitWay");
  return (
    <section aria-labelledby="unit-way-title" data-unit-way="card" className={`${offerCard} flex-1`}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-jaga-teal-ink/15 text-jaga-teal-ink">
          <ShieldIcon size={22} />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 id="unit-way-title" className="text-h3 font-bold text-jaga-ink">
            {t("title")}
          </h2>
          <p className="text-small text-jaga-text-2">{t("who")}</p>
        </div>
      </div>
      <p className="text-small leading-snug">{t("body")}</p>
      <Link
        href="/authority/register"
        prefetch={false}
        data-unit-register="home"
        className={buttonPrimary}
      >
        {t("register")}
      </Link>
    </section>
  );
}

/**
 * The same way in as one quiet line: what the card becomes after a few visits, and what the map
 * carries beside its other quiet lines. Someone who has a unit already is sent to its status
 * instead of being asked to register a second one.
 */
export function UnitWayLine({ where }: { where: "home" | "map" }) {
  const t = useTranslations("unitWay");
  const hasUnit = useHasUnit();
  return (
    <p data-unit-way={`line-${where}`} className={`${hint} flex items-center gap-2`}>
      <ShieldIcon size={18} />
      <span>
        {hasUnit ? null : `${t("quiet")} `}
        <Link
          href={hasUnit ? "/account" : "/authority/register"}
          prefetch={false}
          data-unit-register={where}
          className="font-bold text-jaga-ink underline"
        >
          {t(hasUnit ? "mine" : "register")}
        </Link>
      </span>
    </p>
  );
}
