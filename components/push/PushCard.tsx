"use client";

import { useLocale, useTranslations } from "next-intl";
import { BellIcon } from "@/components/icons";
import type { Area } from "@/lib/area";
import type { MyPlaces } from "@/lib/me";
import { myTambons } from "@/lib/notices";
import { useStored } from "@/lib/phone-store";
import type { PushState } from "@/lib/push";
import { buttonPrimary, buttonSecondary, card, errorNotice, hint } from "@/lib/ui";
import { usePush } from "@/lib/use-push";

type ViewProps = {
  state: PushState | null;
  place: "home" | "account";
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
  if (state === null || state === "unsupported") return null;
  if (place === "home" && (state === "on" || state === "blocked" || !props.hasArea)) return null;
  return (
    <section className={card} data-push={state}>
      <h2 className="flex items-start gap-3 text-h3 font-bold text-jaga-ink">
        <BellIcon size={26} aria-hidden="true" className="mt-0.5 shrink-0" />
        {t("title")}
      </h2>
      {state === "ask" && (
        <>
          <p>{t(props.hasArea ? "body" : "noArea")}</p>
          {props.hasArea && (
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

/** The live card: the tambons are the ones the bell already follows for this phone. */
export function PushCard({ place }: { place: "home" | "account" }) {
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
