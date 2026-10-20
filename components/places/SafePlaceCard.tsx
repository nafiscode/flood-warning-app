import { useFormatter, useLocale, useTranslations } from "next-intl";
import { ClockIcon, PinIcon } from "@/components/icons";
import { CheckThisPlace, ResidentsSaidLine } from "@/components/places/PlaceCheck";
import { freshness } from "@/lib/place-checks";
import { localName, navigateChoices, roughTravel, type SafePlace } from "@/lib/places";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { buttonSecondary, hint } from "@/lib/ui";

type Props = {
  place: SafePlace;
  /** The phone's user agent, to open the right maps app; empty on the server. */
  userAgent?: string;
  /**
   * Draw "Is this still right?" on this card. The owner, 20 Oct: the pin only. So the map's
   * expanded card (reached by tapping a pin, then More) asks, and the home screen's top-three
   * list does not - three folded buttons on a screen already reported as too long on a phone.
   * What residents have said is shown on every card either way: that is a reading, not an ask.
   */
  canCheck?: boolean;
};

/**
 * One safe place as spec 4.3 lists it. Distances are straight lines and travel times rough, and
 * both say so (safety rule 8). "Navigate" offers the maps apps and hands the one chosen the
 * coordinates: free, no routing service.
 */
export function SafePlaceCard({ place, userAgent = "", canCheck = false }: Props) {
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
      <LastChecked place={place} />
      <ResidentsSaidLine said={place.residentsSaid} />
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
      <NavigateChooser id={place.id} lat={place.lat} lon={place.lon} userAgent={userAgent} />
      {/* Anybody standing here can say what it is really like (the owner, 20 Oct). Where there
          is no team covering the tambon it writes the status itself; everywhere else it can only
          tell people and reach the team. See components/places/PlaceCheck.tsx. */}
      {canCheck && <CheckThisPlace placeId={place.id} status={place.status} />}
    </article>
  );
}

/**
 * When somebody was last at the place and said what it was like, and who that was. Never a
 * verdict: a time and a speaker, because "verified" on this card would read as "safe to go".
 *
 * Past its window the line turns into a grey "not checked since 14:20" marker and the status
 * above it is left exactly as it was - stale is a marker, never a downgrade (safety rule 3).
 */
export function LastChecked({ place }: { place: SafePlace }) {
  const t = useTranslations("places");
  const format = useFormatter();
  const checked = freshness({
    checkedAt: place.checkedAt,
    source: place.checkedSource,
    dueAt: place.checkDueAt,
  });
  if (checked.state === "never") {
    return (
      <p className={hint} data-checked="never">
        {t("checkedNever")}
      </p>
    );
  }
  const time = format.dateTime(new Date(checked.at), BANGKOK_DATE_TIME);
  return (
    <p
      className={`flex items-center gap-1.5 ${hint}`}
      data-checked={checked.state}
      data-checked-source={checked.source}
    >
      <ClockIcon size={18} aria-hidden="true" />
      {checked.state === "stale"
        ? t("checkedStale", { time })
        : t(`checkedBy.${checked.source}`, { time })}
    </p>
  );
}

/**
 * "Navigate" asks which app first (owner, 13 Oct). A native disclosure, so it opens with no
 * script and with no signal, like the list it sits in. The same chooser sits on the home
 * screen's list and in the map's pop-up for a safe place (owner, 14 Oct), so the two behave alike.
 */
export function NavigateChooser({
  id,
  lat,
  lon,
  userAgent = "",
}: {
  id: string;
  lat: number;
  lon: number;
  userAgent?: string;
}) {
  const t = useTranslations("places");
  return (
    <details className="group/nav flex flex-col" data-navigate-place={id}>
      <summary
        className={`${buttonSecondary} cursor-pointer list-none gap-2 [&::-webkit-details-marker]:hidden`}
      >
        <PinIcon size={22} />
        {t("navigate")}
      </summary>
      <div className="flex flex-col gap-2 pt-3">
        <p className="font-medium">{t("navigateWith")}</p>
        {navigateChoices(lat, lon, userAgent).map(({ app, href }) => (
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
  );
}
