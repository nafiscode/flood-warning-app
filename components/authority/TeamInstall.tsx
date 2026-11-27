"use client";

import { CheckIcon } from "@/components/icons";
import { InstallCardView } from "@/components/InstallCard";
import { installDevice, installGuide } from "@/lib/install";
import { useOnPhone } from "@/lib/phone-store";
import { notice } from "@/lib/ui";
import { askToInstall, useInstallOffer, useStandalone } from "@/lib/use-install";

/**
 * The install guide for a verified team's people (27 Nov 2026), already open so its animation
 * plays. Where the browser has its own install dialog the button opens it; everywhere else the
 * guide shows where the browser's "Add to Home Screen" or "Install" is. When Jaga is already
 * running from its own icon it says so instead.
 */
export function TeamInstall({ installedText }: { installedText: string }) {
  const ready = useOnPhone();
  const installed = useStandalone();
  const canAsk = useInstallOffer();
  if (!ready) return null;
  if (installed) {
    return (
      <p className={`${notice} flex items-center gap-2`} data-team-installed="true">
        <CheckIcon size={20} />
        {installedText}
      </p>
    );
  }
  const touch = navigator.maxTouchPoints ?? 0;
  return (
    <InstallCardView
      device={installDevice(navigator.userAgent, touch)}
      guide={installGuide(navigator.userAgent, touch)}
      canAsk={canAsk}
      onInstall={askToInstall}
      startOpen
    />
  );
}
