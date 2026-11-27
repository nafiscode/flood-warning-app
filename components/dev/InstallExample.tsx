"use client";

import { useTranslations } from "next-intl";
import { InstallBannerView } from "@/components/InstallBanner";
import { InstallCardView } from "@/components/InstallCard";
import { QuietGuideView } from "@/components/push/QuietGuide";
import type { InstallGuide, InstallReason } from "@/lib/install";

const GUIDES: InstallGuide[] = [
  "iosSafari",
  "iosOther",
  "android",
  "desktop",
  "macSafari",
  "inApp",
];

/** The four wordings of the banner, in the order a person meets them. */
const REASONS: InstallReason[] = ["first", "again", "place", "push"];

const REASON_LABEL: Record<InstallReason, string> = {
  first: "bannerFirst",
  again: "bannerAgain",
  place: "bannerPlace",
  push: "bannerPush",
};

/** Every device's moving guide at once. A real visitor only ever gets the one for their own. */
export function InstallExample() {
  const t = useTranslations("devHome.installGuide");
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {/*
       * The banner that asks, above the cards that explain. Both wordings of each reason, because
       * a phone is told about its home screen and a laptop about its own desktop.
       */}
      {REASONS.map((reason) => (
        <div
          key={reason}
          className="flex flex-col gap-2 sm:col-span-2 lg:col-span-3"
          data-example={`banner-${reason}`}
        >
          <h2 className="text-body font-bold text-jaga-ink">{t(REASON_LABEL[reason])}</h2>
          {(["phone", "computer"] as const).map((device) => (
            <InstallBannerView
              key={device}
              reason={reason}
              device={device}
              canAsk={false}
              onInstall={async () => "unavailable"}
              onShowHow={() => {}}
              onLater={() => {}}
            />
          ))}
        </div>
      ))}
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
