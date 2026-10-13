"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect } from "react";
import { BellIcon } from "@/components/icons";
import type { Area } from "@/lib/area";
import type { MyPlaces } from "@/lib/me";
import { myTambons } from "@/lib/notices";
import { useStored } from "@/lib/phone-store";
import type { PushState } from "@/lib/push";
import { buttonPrimary, buttonSecondary, card, errorNotice, hint } from "@/lib/ui";
import { currentSubscription, usePush } from "@/lib/use-push";

type ViewProps = {
  state: PushState | null;
  /**
   * Where it stands. "team" is the rescue teams' board and "case" the page of one's own request:
   * both have something to notify about without any tambon chosen, and say what in their own
   * words.
   */
  place: "home" | "account" | "team" | "case";
  /** Whether this phone follows any tambon: without one there is nothing to notify about. */
  hasArea: boolean;
  busy: boolean;
  failed: boolean;
  onEnable: () => void;
  onDisable: () => void;
};

/**
 * "Turn on notifications" (A7), drawn from what it is given.
 *
 * On the home screen it appears only while there is something for the person to do: turn them
 * on, or (on an iPhone) put Jaga on the home screen first. Once on, or where the phone cannot do
 * it at all, the home screen stays quiet and the Account page is where the state can be read and
 * changed. It says plainly that the phone, not Jaga, decides whether a notification makes a
 * sound, and it never stands in for the hotlines.
 */
export function PushCardView(props: ViewProps) {
  const t = useTranslations("push");
  const { state, place } = props;
  const own = place === "team" || place === "case";
  const hasArea = own || props.hasArea;
  if (state === null || state === "unsupported") return null;
  if (place === "home" && (state === "on" || state === "blocked" || !hasArea)) return null;
  // On a board or a request's page, a card that only says "on" is in the way of the work.
  if (own && state === "on") return null;
  return (
    <section className={card} data-push={state} data-push-place={place}>
      <h2 className="flex items-start gap-3 text-h3 font-bold text-jaga-ink">
        <BellIcon size={26} aria-hidden="true" className="mt-0.5 shrink-0" />
        {t(place === "team" ? "teamTitle" : place === "case" ? "caseTitle" : "title")}
      </h2>
      {state === "ask" && (
        <>
          <p>
            {t(
              place === "team"
                ? "teamBody"
                : place === "case"
                  ? "caseBody"
                  : hasArea
                    ? "body"
                    : "noArea",
            )}
          </p>
          {hasArea && (
            <button
              type="button"
              className={buttonPrimary}
              disabled={props.busy}
              onClick={props.onEnable}
              data-push-enable="true"
            >
              {t(props.busy ? "busy" : "button")}
            </button>
          )}
        </>
      )}
      {state === "needsInstall" && <p>{t("needsInstall")}</p>}
      {state === "blocked" && <p>{t("blocked")}</p>}
      {state === "on" && (
        <>
          <p className="font-medium">{t("on")}</p>
          <button
            type="button"
            className={buttonSecondary}
            disabled={props.busy}
            onClick={props.onDisable}
          >
            {t("off")}
          </button>
        </>
      )}
      {props.failed && (
        <p role="alert" className={errorNotice}>
          {t("failed")}
        </p>
      )}
      <p className={hint}>{t("note")}</p>
    </section>
  );
}

/**
 * On the page of one's own request: once this phone has notifications on, it is registered to
 * hear about this case (a team accepted, is on its way, has arrived). Shown only after the
 * request has been sent, never before it (safety rule 1). The registration is repeated per case,
 * and only the sender's own token lets it through.
 */
export function CasePush({ id, token }: { id: string; token: string | null }) {
  const locale = useLocale();
  const area = useStored<Area>("area");
  const me = useStored<MyPlaces>("me");
  const push = usePush(myTambons(area, me), locale);
  const on = push.state === "on";
  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    void currentSubscription().then((sub) => {
      if (cancelled || !sub) return;
      const json = sub.toJSON();
      void fetch(`/api/sos/${id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-jaga-sos-token": token } : {}),
        },
        body: JSON.stringify({
          action: "follow_push",
          token,
          endpoint: json.endpoint,
          keys: json.keys,
          locale,
        }),
        cache: "no-store",
      }).catch(() => {});
    });
    return () => {
      cancelled = true;
    };
  }, [on, id, token, locale]);
  return (
    <PushCardView
      state={push.state}
      place="case"
      hasArea
      busy={push.busy}
      failed={push.failed}
      onEnable={() => void push.enable()}
      onDisable={() => void push.disable()}
    />
  );
}

/** The live card: the tambons are the ones the bell already follows for this phone. */
export function PushCard({ place }: { place: "home" | "account" | "team" }) {
  const locale = useLocale();
  const area = useStored<Area>("area");
  const me = useStored<MyPlaces>("me");
  const tambons = myTambons(area, me);
  const push = usePush(tambons, locale);
  return (
    <PushCardView
      state={push.state}
      place={place}
      hasArea={tambons.length > 0}
      busy={push.busy}
      failed={push.failed}
      onEnable={() => void push.enable()}
      onDisable={() => void push.disable()}
    />
  );
}
