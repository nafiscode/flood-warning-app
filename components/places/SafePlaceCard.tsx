import { useLocale, useTranslations } from "next-intl";
import { PinIcon } from "@/components/icons";
import { localName, navigateHref, roughTravel, type SafePlace } from "@/lib/places";
import { buttonSecondary, hint } from "@/lib/ui";

type Props = {
  place: SafePlace;
  /** The phone's user agent, to open the right maps app; empty on the server. */
  userAgent?: string;
};

/**
 * One safe place as spec 4.3 lists it. Distances are straight lines and travel times rough, and
 * both say so (safety rule 8). "Navigate" opens the phone's own maps app with the coordinates:
 * free, no routing service.
 */
export function SafePlaceCard({ place, userAgent = "" }: Props) {
  const t = useTranslations("places");
  const locale = useLocale();
  const d = place.distanceM;
  const travel = d === null ? null : roughTravel(d);
  const flooded =
    place.flooded2024 && place.flooded2025
      ? "floodedBoth"
      : place.flooded2024
        ? "flooded2024"
        : place.flooded2025
          ? "flooded2025"
          : place.flooded2024 === false && place.flooded2025 === false
            ? "notFlooded"
            : null;
  return (
    <article
      data-safe-place={place.id}
      className="flex flex-col gap-2 rounded-xl border border-jaga-line bg-jaga-surface p-4"
    >
      <h3 className="text-body font-bold">{localName(place.name, locale)}</h3>
      <p className={hint}>
        {t(`type.${place.type}`)} · {t(place.verified ? "verified" : "unverified")}
      </p>
      <p className="font-medium">{t(`status.${place.status}`)}</p>
      {d !== null && travel && (
        <p>
          {d < 1000
            ? t("m", { value: Math.round(d / 10) * 10 })
            : t("km", { value: (d / 1000).toFixed(1) })}{" "}
          <span className={hint}>
            ({t("straight")}) · {t(travel.by, { minutes: travel.minutes })}
          </span>
        </p>
      )}
      <ul className={`flex flex-col ${hint}`}>
        {place.freeboardM !== null && place.freeboardM > 0 && (
          <li>{t("freeboard", { value: place.freeboardM.toFixed(1) })}</li>
        )}
        {flooded && <li>{t(flooded)}</li>}
        {place.capacity !== null && <li>{t("capacity", { count: place.capacity })}</li>}
        {place.needs && <li>{t("needs", { text: place.needs })}</li>}
      </ul>
      <a
        href={navigateHref(place.lat, place.lon, userAgent)}
        target="_blank"
        rel="noopener noreferrer"
        className={`${buttonSecondary} gap-2`}
      >
        <PinIcon size={22} />
        {t("navigate")}
      </a>
    </article>
  );
}
