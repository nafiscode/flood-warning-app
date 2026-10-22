"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { CheckIcon } from "@/components/icons";
import { LineLink } from "@/components/account/LineLink";
import { usePathname } from "@/i18n/navigation";
import type { SetupStep } from "@/lib/home-stage";
import { lineSignInHref, signInHref } from "@/lib/sign-in-link";
import { buttonPrimary, offerCard } from "@/lib/ui";

type Props = {
  steps: SetupStep[];
  /** The tambon's name as the person reads it ("ต.บานา"), for the lines that name the place. */
  place: string;
  /** The install card, drawn inside the install step only while that step is the open one. */
  install: ReactNode;
};

/**
 * Setting Jaga up, as one card that asks for one thing at a time (the owner, 23 Oct 2026:
 * option C). It replaces three separate offers on a laptop - the "new to Jaga" card, the sign-in
 * card and the install card - which together made the first screen feel like too many things.
 *
 * Only the first step not done is open and carries a button; the ones after it are greyed and
 * say what they wait for (install waits behind sign-in). When every step is done, or the person
 * has said "Not now" to install, the card is simply not drawn again.
 *
 * Safety: nothing here is in an SOS, report or alert flow, and the home screen leaves it out at
 * Warning and Evacuate. Nothing urgent ever needs an account.
 */
export function SetupSteps({ steps, place, install }: Props) {
  const t = useTranslations("homeFlow.setup");
  const tSign = useTranslations("signInOffer");
  const locale = useLocale();
  const pathname = usePathname();
  const done = steps.filter((s) => s.state === "done").length;
  if (done === steps.length) return null;
  return (
    <section
      aria-labelledby="setup-steps-title"
      data-setup-steps="true"
      className={`${offerCard} gap-3`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="setup-steps-title" className="text-h3 font-bold text-jaga-ink">
          {t("title")}
        </h2>
        <span className="text-small text-jaga-text-2" data-setup-progress={done}>
          {t("progress", { done, total: steps.length })}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-jaga-ground" aria-hidden="true">
        <div
          className="h-full rounded-full bg-jaga-teal-ink"
          style={{ width: `${(done / steps.length) * 100}%` }}
        />
      </div>
      <ol className="flex flex-col">
        {steps.map(({ key, state }) => (
          <li
            key={key}
            data-setup-step={key}
            data-state={state}
            aria-current={state === "open" ? "step" : undefined}
            className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 border-t border-jaga-line py-3 first:border-t-0 first:pt-0"
          >
            <span
              aria-hidden="true"
              className={`mt-0.5 grid size-7 place-items-center rounded-full border-2 ${
                state === "done"
                  ? "border-jaga-teal-ink bg-jaga-teal-ink text-white"
                  : state === "open"
                    ? "border-jaga-teal-ink"
                    : "border-jaga-line"
              }`}
            >
              {state === "done" && <CheckIcon size={16} />}
            </span>
            <div className="flex min-w-0 flex-col gap-2">
              {/* The open install step is the install card, which has its own heading. */}
              {!(key === "install" && state === "open") && (
                <p className={state === "wait" ? "font-bold text-jaga-text-2" : "font-bold"}>
                  {state === "done" && <span className="sr-only">{t("done")}: </span>}
                  {t(key)}
                  {key === "area" && state === "done" && (
                    <span className="block text-small font-normal text-jaga-text-2">{place}</span>
                  )}
                </p>
              )}
              {key === "signIn" && state === "open" && (
                <>
                  <p className="text-small text-jaga-text-2">{t("signInBody", { place })}</p>
                  <LineLink href={lineSignInHref(locale, pathname)} className={buttonPrimary}>
                    {tSign("line")}
                  </LineLink>
                  <a
                    href={signInHref(locale, pathname)}
                    className="inline-flex min-h-tap items-center justify-center text-small underline"
                  >
                    {tSign("other")}
                  </a>
                </>
              )}
              {key === "install" && state === "wait" && (
                <p className="text-small text-jaga-text-2">{t("installWait")}</p>
              )}
              {key === "install" && state === "open" && install}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
