"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { CrossIcon, ForwardIcon, QuestionIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { useOnPhone, useStored, writeStored } from "@/lib/phone-store";
import { buttonQuiet } from "@/lib/ui";

/** How many visits the card stays for, unless it is closed first. */
export const WELCOME_VISITS = 5;
const KEY = "welcome";
const SESSION = "jaga.welcome.counted";

type Welcome = { visits: number; closed: boolean };

export function welcomeShown(state: Welcome | null): boolean {
  if (!state) return true;
  return !state.closed && state.visits <= WELCOME_VISITS;
}

/**
 * "New to Jaga?" on the home screen (owner, 16 Oct): a small card into What Jaga can do for
 * someone who has only just found the app. It stays for the first few visits on this phone, or
 * until closed, and the home screen leaves it out at Warning and Evacuate. Kept on the phone only.
 */
export function NewToJaga() {
  const t = useTranslations("capabilities");
  const onPhone = useOnPhone();
  const state = useStored<Welcome>(KEY);

  // One visit a browser session, not one a render.
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(SESSION)) return;
      window.sessionStorage.setItem(SESSION, "1");
    } catch {
      return;
    }
    const now = (JSON.parse(
      window.localStorage.getItem(`jaga.${KEY}`) ?? "null",
    ) as Welcome | null) ?? {
      visits: 0,
      closed: false,
    };
    writeStored(KEY, { ...now, visits: now.visits + 1 });
  }, []);

  if (!onPhone || !welcomeShown(state)) return null;
  return (
    <section
      aria-labelledby="new-to-jaga"
      data-new-to-jaga="true"
      className="relative flex flex-col gap-3 rounded-xl border border-jaga-line bg-jaga-surface p-4"
    >
      <div className="flex items-start gap-3 pe-10">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-jaga-teal-ink/15 text-jaga-teal-ink">
          <QuestionIcon size={22} />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 id="new-to-jaga" className="font-bold text-jaga-ink">
            {t("welcome.title")}
          </h2>
          <p className="text-small text-jaga-text-2">{t("welcome.text")}</p>
        </div>
      </div>
      <Link href="/features" prefetch={false} className={`${buttonQuiet} justify-center`}>
        {t("welcome.open")}
        <ForwardIcon size={20} className="rtl:-scale-x-100" />
      </Link>
      <button
        type="button"
        onClick={() => writeStored(KEY, { visits: state?.visits ?? 1, closed: true })}
        aria-label={t("welcome.close")}
        data-new-to-jaga-close
        className="absolute end-1 top-1 grid size-12 place-items-center rounded-lg text-jaga-text-2 hover:text-jaga-ink"
      >
        <CrossIcon size={20} />
      </button>
    </section>
  );
}
