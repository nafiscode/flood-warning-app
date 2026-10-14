"use client";

import { useLocale, useTranslations } from "next-intl";
import { BellIcon, HouseIcon, LifebuoyIcon, PinIcon, WaveIcon } from "@/components/icons";
import { usePathname } from "@/i18n/navigation";
import { lineSignInHref, signInHref } from "@/lib/sign-in-link";
import { useSignedIn } from "@/lib/use-public";
import { buttonPrimary } from "@/lib/ui";
import { LineLink } from "./LineLink";

const GAINS = [
  { key: "line", Icon: BellIcon },
  { key: "watch", Icon: PinIcon },
  { key: "household", Icon: LifebuoyIcon },
  { key: "report", Icon: WaveIcon },
  { key: "home", Icon: HouseIcon },
] as const;

/**
 * What signing in gives, said where a visitor would otherwise see nothing (the owner, 15 Oct:
 * people should see from the first page that an account gives them more). Five things an account
 * really adds, each true today; one tap straight into LINE's sign-in and back to this page; and,
 * last, that nothing urgent ever needs an account (safety rule 1). The home screen leaves it out
 * at Warning and Evacuate.
 */
export function SignInOffer() {
  const t = useTranslations("signInOffer");
  const locale = useLocale();
  const pathname = usePathname();
  const signedIn = useSignedIn();
  if (signedIn) return null;
  return (
    <section
      aria-labelledby="sign-in-offer-title"
      data-sign-in-offer="true"
      className="flex flex-col gap-3 rounded-xl border-2 border-jaga-teal-ink bg-jaga-surface p-4"
    >
      <div className="flex flex-col gap-0.5">
        <h2 id="sign-in-offer-title" className="text-h3 font-bold text-jaga-ink">
          {t("title")}
        </h2>
        <p className="text-small text-jaga-text-2">{t("sub")}</p>
      </div>
      <ul className="flex flex-col gap-2.5">
        {GAINS.map(({ key, Icon }) => (
          <li key={key} className="flex items-start gap-3" data-gain={key}>
            <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-jaga-ground text-jaga-teal-ink">
              <Icon size={20} />
            </span>
            <span className="flex flex-col">
              <span className="font-bold leading-snug">{t(`gain.${key}.title`)}</span>
              <span className="text-small leading-snug text-jaga-text-2">
                {t(`gain.${key}.body`)}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <LineLink href={lineSignInHref(locale, pathname)} className={buttonPrimary}>
        {t("line")}
      </LineLink>
      <a
        href={signInHref(locale, pathname)}
        className="inline-flex min-h-tap items-center justify-center text-small underline"
      >
        {t("other")}
      </a>
      <p className="text-small text-jaga-text-2">{t("noNeed")}</p>
    </section>
  );
}

/** A small padlock, for a feature that needs an account. */
function LockIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" className="shrink-0">
      <rect
        x="5"
        y="11"
        width="14"
        height="10"
        rx="2"
        className="fill-none stroke-current"
        strokeWidth="2"
      />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" className="fill-none stroke-current" strokeWidth="2" />
    </svg>
  );
}

/**
 * A feature that needs an account, said where the feature is (the owner, 15 Oct): a padlock, what
 * signing in would let them do here, and a link that brings them back. Nothing for someone signed
 * in. `what` names the line in `signInOffer.hint`.
 */
export function SignInHint({ what }: { what: "places" | "report" | "mapPlaces" }) {
  const t = useTranslations("signInOffer");
  const locale = useLocale();
  const pathname = usePathname();
  const signedIn = useSignedIn();
  if (signedIn) return null;
  return (
    <p
      data-sign-in-hint={what}
      className="flex items-center gap-2 rounded-lg border border-dashed border-jaga-line px-3 py-2 text-small text-jaga-text-2"
    >
      <LockIcon />
      <span>
        {t(`hint.${what}`)}{" "}
        <a href={signInHref(locale, pathname)} className="font-bold text-jaga-ink underline">
          {t("hintLink")}
        </a>
      </span>
    </p>
  );
}
