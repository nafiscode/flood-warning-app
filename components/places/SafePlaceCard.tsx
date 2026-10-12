import { useLocale, useTranslations } from "next-intl";
import { PinIcon } from "@/components/icons";
import { localName, navigateChoices, roughTravel, type SafePlace } from "@/lib/places";
import { buttonSecondary, hint } from "@/lib/ui";

type Props = {
  place: SafePlace;
  /** The phone's user agent, to open the right maps app; empty on the server. */
  userAgent?: string;
};

/**
 * One safe place as spec 4.3 lists it. Distances are straight lines and travel times rough, and
 * both say so (safety rule 8). "Navigate" offers the maps apps and hands the one chosen the
 * coordinates: free, no routing service.
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
      {/*
       * "Navigate" asks which app first (owner, 13 Oct). A native disclosure, so it opens with no
       * script and with no signal, like the list it sits in.
       */}
      <details className="group/nav flex flex-col" data-navigate-place={place.id}>
        <summary
          className={`${buttonSecondary} cursor-pointer list-none gap-2 [&::-webkit-details-marker]:hidden`}
        >
          <PinIcon size={22} />
          {t("navigate")}
        </summary>
        <div className="flex flex-col gap-2 pt-3">
          <p className="font-medium">{t("navigateWith")}</p>
          {navigateChoices(place.lat, place.lon, userAgent).map(({ app, href }) => (
            <a
              key={app}
              href={href}
              // A geo: link is handed to the phone itself; a new tab would only show an error.
              {...(app === "other" ? {} : { target: "_blank", rel: "noopener noreferrer" })}
              data-navigate-app={app}
              className={buttonSecondary}
            >
              {t(`navigateApp.${app}`)}
            </a>
          ))}
          <p className={hint}>{t("navigateNote")}</p>
        </div>
      </details>
    </article>
  );
}
