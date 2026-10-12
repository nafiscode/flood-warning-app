"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { AddSquareIcon, CheckIcon, InstallIcon, MenuDotsIcon, ShareIcon } from "@/components/icons";
import {
  installDevice,
  installGuide,
  installSnoozed,
  type InstallDevice,
  type InstallGuide,
} from "@/lib/install";
import { useOnPhone, useStored, writeStored } from "@/lib/phone-store";
import { buttonSecondary, card } from "@/lib/ui";
import { askToInstall, useInstallOffer, useStandalone } from "@/lib/use-install";
import { useNow } from "@/lib/use-public";

/** The picture beside each written step, in the order of the steps. */
const STEPS: Record<InstallGuide, ReactNode[]> = {
  inApp: [<InstallIcon key="1" />, <MenuDotsIcon key="2" />],
  iosSafari: [<ShareIcon key="1" />, <AddSquareIcon key="2" />, <CheckIcon key="3" />],
  iosOther: [<ShareIcon key="1" />, <AddSquareIcon key="2" />, <CheckIcon key="3" />],
  android: [<MenuDotsIcon key="1" />, <AddSquareIcon key="2" />],
  macSafari: [<MenuDotsIcon key="1" />, <AddSquareIcon key="2" />],
  desktop: [<InstallIcon key="1" />, <CheckIcon key="2" />],
};

export type InstallCardViewProps = {
  device: InstallDevice;
  guide: InstallGuide;
  /** True when the browser will open its own install dialog for us. */
  canAsk: boolean;
  onInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
  /** "Not now", on the home screen only. */
  onLater?: () => void;
};

/**
 * The card itself, drawn from what it is given. Where the browser has an install dialog, the
 * button opens it; everywhere else (every iPhone, Safari, Firefox) the button shows where the
 * browser's own "Add to Home Screen" is, because no page can do that step for the person.
 */
export function InstallCardView({
  device,
  guide,
  canAsk,
  onInstall,
  onLater,
}: InstallCardViewProps) {
  const t = useTranslations("install");
  const [open, setOpen] = useState(false);

  async function tap() {
    if (canAsk && (await onInstall()) !== "unavailable") return;
    setOpen(true);
  }

  return (
    <section className={card} data-install={device}>
      <h2 className="text-body font-bold text-jaga-ink">{t(`title.${device}`)}</h2>
      <p>{t(`body.${device}`)}</p>
      <button
        type="button"
        onClick={tap}
        aria-expanded={canAsk ? undefined : open}
        data-install-button="true"
        className={`${buttonSecondary} gap-2`}
      >
        <InstallIcon size={22} />
        {t(`button.${device}`)}
      </button>
      {open && (
        <ol className="flex flex-col gap-3" data-install-guide={guide}>
          {STEPS[guide].map((icon, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-jaga-line bg-jaga-ground text-jaga-ink">
                {icon}
              </span>
              <span className="pt-1">
                <span className="font-bold">{i + 1}. </span>
                {t(`guide.${guide}.s${i + 1}`)}
              </span>
            </li>
          ))}
        </ol>
      )}
      {onLater && (
        <button
          type="button"
          onClick={onLater}
          data-install-later="true"
          className="min-h-tap self-start underline"
        >
          {t("later")}
        </button>
      )}
    </section>
  );
}

/**
 * "Put Jaga on your home screen". On the home screen it is a quiet card at the very end, gone
 * once Jaga is installed and for three weeks after "Not now"; on the Account page it stays, as
 * the place to come back to. Nothing is drawn when Jaga is already open from its own icon.
 */
export function InstallCard({ place }: { place: "home" | "account" }) {
  const ready = useOnPhone();
  const canAsk = useInstallOffer();
  const installed = useStandalone();
  const done = useStored<boolean>("install.done");
  const later = useStored<number>("install.later");
  const now = useNow();
  if (!ready || installed) return null;
  if (place === "home" && (done || now === 0 || installSnoozed(later, now))) return null;
  const touch = navigator.maxTouchPoints ?? 0;
  return (
    <InstallCardView
      device={installDevice(navigator.userAgent, touch)}
      guide={installGuide(navigator.userAgent, touch)}
      canAsk={canAsk}
      onInstall={askToInstall}
      onLater={place === "home" ? () => writeStored("install.later", Date.now()) : undefined}
    />
  );
}
