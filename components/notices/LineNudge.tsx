"use client";

import { useLocale, useTranslations } from "next-intl";
import { LineLink } from "@/components/account/LineLink";
import { usePathname } from "@/i18n/navigation";
import { useStored, writeStored } from "@/lib/phone-store";
import { lineSignInHref } from "@/lib/sign-in-link";
import { useNow, useSignedIn } from "@/lib/use-public";

/** "Not now" keeps it away for a week. */
export const NUDGE_REST_MS = 7 * 24 * 3_600_000;

/** Whether the nudge shows: a visitor, the page awake, and no "Not now" in the last week. */
export function nudgeDue(signedIn: boolean, now: number, restingUntil: number | null): boolean {
  return !signedIn && now > 0 && (restingUntil === null || now >= restingUntil);
}

/**
 * At the foot of the bell's panel, for a visitor (the owner, 15 Oct): the same news can come in
 * LINE, even with the app closed, once they sign in. One line and one tap, with "Not now" that
 * keeps it away for a week. Never part of a notification itself (CLAUDE.md keeps prompts out of
 * alerts), only of the panel someone chose to open.
 */
export function LineNudge() {
  const t = useTranslations("notices");
  const locale = useLocale();
  const pathname = usePathname();
  const signedIn = useSignedIn();
  const now = useNow();
  const restingUntil = useStored<number>("nudge.line");
  if (!nudgeDue(signedIn, now, restingUntil)) return null;
  return (
    <div
      data-line-nudge="true"
      className="flex flex-col gap-2 border-t border-jaga-line bg-jaga-ground px-4 py-3"
    >
      <p className="text-small">
        <span className="block font-bold text-jaga-ink">{t("nudge.title")}</span>
        {t("nudge.body")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <LineLink
          href={lineSignInHref(locale, pathname)}
          className="inline-flex min-h-tap items-center rounded-lg bg-jaga-slate px-4 font-bold text-white"
        >
          {t("nudge.button")}
        </LineLink>
        <button
          type="button"
          onClick={() => writeStored("nudge.line", Date.now() + NUDGE_REST_MS)}
          className="inline-flex min-h-tap items-center px-3 text-small underline"
        >
          {t("nudge.later")}
        </button>
      </div>
    </div>
  );
}
