"use client";

import { useTranslations } from "next-intl";
import { InstallCardView } from "@/components/InstallCard";
import { QuietGuideView } from "@/components/push/QuietGuide";
import type { InstallGuide } from "@/lib/install";

const GUIDES: InstallGuide[] = [
  "iosSafari",
  "iosOther",
  "android",
  "desktop",
  "macSafari",
  "inApp",
];

/** Every device's moving guide at once. A real visitor only ever gets the one for their own. */
export function InstallExample() {
  const t = useTranslations("devHome.installGuide");
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {GUIDES.map((guide) => (
        <div key={guide} className="flex flex-col gap-2" data-example={guide}>
          <h2 className="text-body font-bold text-jaga-ink">{t(guide)}</h2>
          <InstallCardView
            device={guide === "desktop" || guide === "macSafari" ? "computer" : "phone"}
            guide={guide}
            canAsk={false}
            onInstall={async () => "unavailable"}
            startOpen
          />
        </div>
      ))}
      {(["ios", "android"] as const).map((guide) => (
        <div key={guide} className="flex flex-col gap-2" data-example={`quiet-${guide}`}>
          <h2 className="text-body font-bold text-jaga-ink">
            {t(guide === "ios" ? "quietIos" : "quietAndroid")}
          </h2>
          <QuietGuideView guide={guide} startOpen />
        </div>
      ))}
    </div>
  );
}
