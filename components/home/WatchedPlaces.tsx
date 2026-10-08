import { useLocale, useTranslations } from "next-intl";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import { AlertStatus } from "@/components/alerts/AlertStatus";
import { LifebuoyIcon, PhoneIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { areaName } from "@/lib/area";
import type { WatchedPlace } from "@/lib/me";
import type { HeroStatus } from "./AlertHero";
import { buttonSecondary, card, hint } from "@/lib/ui";

export type WatchedStatus = { place: WatchedPlace; status: HeroStatus | { kind: "outside" } };

function CallButton({ place }: { place: WatchedPlace }) {
  const t = useTranslations("home.watched");
  if (!place.contactPhone) return null;
  return (
    <a href={`tel:${place.contactPhone}`} className={`${buttonSecondary} gap-2`}>
      <PhoneIcon size={22} />
      {t("call", { name: place.contactName ?? place.label })}
    </a>
  );
}

/** A level badge with the stale marker, or plain grey words for the states that are not levels. */
function PlaceStatus({ status, now }: { status: WatchedStatus["status"]; now: number }) {
  const t = useTranslations("home");
  if (status.kind === "alert") {
    return (
      <AlertStatus
        level={status.alert.level}
        nextUpdateAt={new Date(status.alert.nextUpdateAt)}
        now={new Date(now)}
      />
    );
  }
  if (status.kind === "normal") return <AlertBadge level="normal" />;
  return (
    <p className={hint} data-no-level={status.kind}>
      {status.kind === "outside"
        ? t("watched.outside")
        : status.kind === "notInService"
          ? t("notInService.short")
          : t("watched.unknown")}
    </p>
  );
}

/**
 * Most severe first (spec 4.1): a watched place with a more severe alert than home, shown above
 * the home hero with one tap to call the person there and one to send an SOS for them.
 */
export function WorseBanner({ item, now }: { item: WatchedStatus; now: number }) {
  const t = useTranslations("home.watched");
  const locale = useLocale();
  const { place } = item;
  return (
    <section
      data-worse-place={place.id}
      className="flex flex-col gap-3 rounded-2xl border-4 border-jaga-slate bg-jaga-surface p-4"
    >
      <h2 className="text-body font-bold">
        {place.label}
        {place.area && (
          <span className={`block font-normal ${hint}`}>{areaName(locale, place.area)}</span>
        )}
      </h2>
      <PlaceStatus status={item.status} now={now} />
      <CallButton place={place} />
      <Link
        href={{ pathname: "/sos", query: { place: place.id } }}
        prefetch={false}
        className="inline-flex min-h-tap w-full items-center justify-center gap-2 rounded-xl bg-sos px-5 py-2 text-center font-bold text-sos-fg active:translate-y-px"
      >
        <LifebuoyIcon size={24} />
        {t("sosFor", { label: place.label })}
      </Link>
    </section>
  );
}

/** Places you watch (spec 4.1, 4.9): each with its level, the stale marker when late, and Call. */
export function WatchedPlaces({ items, now }: { items: WatchedStatus[]; now: number }) {
  const t = useTranslations("home.watched");
  const locale = useLocale();
  if (items.length === 0) return null;
  return (
    <section className={card} data-watched="true">
      <h2 className="text-body font-bold">{t("title")}</h2>
      <ul className="flex flex-col gap-4">
        {items.map((item) => (
          <li key={item.place.id} className="flex flex-col gap-2">
            <p className="font-medium">
              {item.place.label}
              {item.place.area && (
                <span className={`block font-normal ${hint}`}>
                  {areaName(locale, item.place.area)}
                </span>
              )}
            </p>
            <PlaceStatus status={item.status} now={now} />
            <CallButton place={item.place} />
          </li>
        ))}
      </ul>
    </section>
  );
}
