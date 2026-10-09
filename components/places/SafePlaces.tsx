import { useTranslations } from "next-intl";
import type { NearbyPlaces } from "@/lib/places";
import type { LoadState } from "@/lib/use-public";
import { hint, notice } from "@/lib/ui";
import { SafePlaceCard } from "./SafePlaceCard";

type Props = { places: NearbyPlaces | null; state: LoadState; userAgent?: string };

/**
 * The top-3 safe places from the person's point, and high ground for cars as its own list (spec
 * 4.3). An empty list says where to ask instead; it never reads as "you don't need one".
 */
export function SafePlaces({ places, state, userAgent }: Props) {
  const t = useTranslations("places");
  return (
    <section className="flex flex-col gap-3" data-safe-places={state}>
      <h2 className="text-h3 font-bold text-jaga-ink">{t("title")}</h2>
      {!places && <p className={hint}>{t(state === "unavailable" ? "unavailable" : "loading")}</p>}
      {places && places.people.length === 0 && <p className={notice}>{t("none")}</p>}
      {places?.people.map((place) => (
        <SafePlaceCard key={place.id} place={place} userAgent={userAgent} />
      ))}
      {places && places.parking.length > 0 && (
        <>
          <h2 className="text-h3 font-bold text-jaga-ink">{t("parkingTitle")}</h2>
          {places.parking.map((place) => (
            <SafePlaceCard key={place.id} place={place} userAgent={userAgent} />
          ))}
        </>
      )}
    </section>
  );
}
