"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { MessageIcon } from "@/components/icons";
import { askAllowed, type Moment, quietScreen } from "@/lib/feedback";
import { markAsked, useAskedAt } from "@/lib/feedback-store";
import { usePathname } from "@/i18n/navigation";
import { useOnPhone } from "@/lib/phone-store";
import { useTense } from "@/lib/use-tense";
import { buttonQuiet, hint } from "@/lib/ui";
import { Link } from "@/i18n/navigation";

/**
 * The quiet ask (spec 17): **one line that can be ignored**, shown after something of this
 * person's has finished - their request closed and confirmed, their report ended, a team's case
 * done - and then not again for 30 days on that phone.
 *
 * Four things keep it off the screen, and they are all in `askAllowed`:
 *  - a place of theirs at Warning or Evacuate (nothing invites anybody to rate an app while
 *    their village is being told to leave),
 *  - an SOS, food-and-water, report, alert or open-request screen,
 *  - the 30 days,
 *  - and the caller's own `when`, which is the moment itself having arrived.
 *
 * It is a line and a link, never a dialog over the page and never a star bar: a prompt that
 * blocks is a prompt that gets in the way of help. "Not now" is the same 30 days as an answer,
 * because asking again next week is how a quiet ask stops being quiet.
 */
export function FeedbackAsk({
  moment,
  when = true,
  sos = null,
}: {
  moment: Moment;
  /** The moment has arrived: the request is closed and confirmed, the case is finished. */
  when?: boolean;
  /** The case this ask follows, so admins can look into a bad experience. Never public. */
  sos?: string | null;
}) {
  const t = useTranslations("feedback");
  const pathname = usePathname();
  const tense = useTense();
  const askedAt = useAskedAt();
  const [dismissed, setDismissed] = useState(false);
  /*
   * The server cannot know the phone's memory, so the line is only drawn once this is running in
   * the browser - otherwise the first paint would show an ask that the 30-day gate then removes.
   * `now` is read once here rather than on every render: the gate must not change its answer
   * halfway through a render, and a 30-day window does not care about the second.
   */
  const here = useOnPhone();
  const [now] = useState(() => Date.now());

  const allowed =
    here &&
    when &&
    !dismissed &&
    askAllowed({ tense, quietScreen: quietScreen(pathname), shownAt: askedAt, now });
  if (!allowed) return null;

  const query: Record<string, string> = { moment };
  if (sos) query.case = sos;

  return (
    <aside
      className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2"
      data-feedback-ask={moment}
    >
      <p className={hint}>{t("ask.line")}</p>
      <Link
        href={{ pathname: "/feedback", query }}
        prefetch={false}
        className={buttonQuiet}
        onClick={() => markAsked()}
      >
        <MessageIcon size={20} />
        {t("ask.open")}
      </Link>
      <button
        type="button"
        onClick={() => {
          markAsked();
          setDismissed(true);
        }}
        className="inline-flex min-h-tap items-center px-2 underline"
        data-feedback-ask-dismiss="true"
      >
        {t("ask.dismiss")}
      </button>
    </aside>
  );
}
