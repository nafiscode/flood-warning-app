"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { InstallIcon } from "@/components/icons";
import { useInstallWanted } from "@/components/InstallCard";
import { installDevice, installReason, type InstallReason } from "@/lib/install";
import type { MyPlaces } from "@/lib/me";
import { readStored, useOnPhone, useStored, writeStored } from "@/lib/phone-store";
import { reveal } from "@/lib/reveal";
import { askToInstall, openGuide, useInstallOffer } from "@/lib/use-install";

/**
 * How many times this device has opened Jaga. Counted once per browser session, so opening a
 * second page is not a second visit. It is only ever read to choose the banner's wording.
 */
const VISITS = "install.visits";
const SESSION = "jaga.install.counted";

export function countVisit(): number {
  const before = readStored<number>(VISITS) ?? 0;
  let counted = false;
  try {
    counted = window.sessionStorage.getItem(SESSION) === "1";
    if (!counted) window.sessionStorage.setItem(SESSION, "1");
  } catch {
    // Storage switched off: every page then counts as the first visit, which only picks wording.
  }
  if (counted) return before;
  const now = before + 1;
  writeStored(VISITS, now);
  return now;
}

export type InstallBannerViewProps = {
  reason: InstallReason;
  device: "phone" | "computer";
  /** True when the browser will open its install dialog for us. */
  canAsk: boolean;
  onInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
  /** Points at the card's own steps, and hides the banner for three weeks. */
  onShowHow: () => void;
  onLater: () => void;
};

/**
 * A band under the hero, asking plainly that Jaga be put on the home screen or the desktop. No
 * browser lets a page do that by itself (`lib/install.ts`), so this is the clearest Jaga can be:
 * one button that opens the browser's own dialog where there is one, and that otherwise sends
 * them to the steps on the card below, with the steps already open.
 *
 * It is never drawn above the hero - the level of their own tambon stays the first thing on the
 * screen - never while a place of theirs is at Warning or Evacuate (HomeView's `tense`), and
 * never anywhere in the SOS flow (safety rule 1).
 */
export function InstallBannerView({
  reason,
  device,
  canAsk,
  onInstall,
  onShowHow,
  onLater,
}: InstallBannerViewProps) {
  const t = useTranslations("install.banner");
  return (
    <section
      aria-label={t(`title.${device}`)}
      data-install-banner={reason}
      data-install-banner-device={device}
      className="flex flex-col gap-3 rounded-xl border-2 border-jaga-teal-ink bg-jaga-surface p-4 sm:flex-row sm:items-center sm:gap-4"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-jaga-teal-ink/15 text-jaga-teal-ink">
        <InstallIcon size={22} />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5 sm:flex-1">
        <p className="font-bold text-jaga-ink">{t(`title.${device}`)}</p>
        <p className="text-small text-jaga-text-2">{t(`why.${reason}.${device}`)}</p>
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
        <button
          type="button"
          data-install-banner-button="true"
          onClick={async () => {
            if (canAsk && (await onInstall()) !== "unavailable") return;
            onShowHow();
          }}
          className="inline-flex min-h-tap items-center justify-center gap-2 rounded-xl bg-jaga-slate px-5 py-2 font-medium text-white active:translate-y-px"
        >
          <InstallIcon size={20} />
          {t(canAsk ? "do" : "how")}
        </button>
        <button
          type="button"
          data-install-banner-later="true"
          onClick={onLater}
          className="min-h-tap self-center underline"
        >
          {t("later")}
        </button>
      </div>
    </section>
  );
}

/**
 * The live banner. It asks the same question as the card below it and is silenced by the same
 * "Not now" (`install.later`), so one dismissal ends all of it for three weeks.
 */
export function InstallBanner() {
  const ready = useOnPhone();
  const wanted = useInstallWanted("home");
  const canAsk = useInstallOffer();
  const me = useStored<MyPlaces>("me");
  const visits = useStored<number>(VISITS) ?? 0;
  /*
   * Whether this browser has been given leave to show notifications. Only the wording hangs on
   * it, so the permission is read straight rather than through usePush, which also talks to the
   * server. On an iPhone it is always false in a tab - there the bell needs the home screen
   * first, which is the very thing being asked for.
   */
  const [pushOn, setPushOn] = useState(false);

  useEffect(() => {
    countVisit();
    setPushOn("Notification" in window && Notification.permission === "granted");
  }, []);

  if (!ready || !wanted) return null;
  const savedPlaces = me?.signedIn ? (me.home ? 1 : 0) + me.places.length : 0;
  return (
    <InstallBannerView
      reason={installReason({ pushOn, savedPlaces, visits })}
      device={installDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0)}
      canAsk={canAsk}
      onInstall={askToInstall}
      onShowHow={() => {
        openGuide();
        reveal(() => document.querySelector<HTMLElement>("[data-install]"));
      }}
      onLater={() => writeStored("install.later", Date.now())}
    />
  );
}
