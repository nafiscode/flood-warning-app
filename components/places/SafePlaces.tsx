import { useTranslations } from "next-intl";
import type { NearbyPlaces } from "@/lib/places";
import type { LoadState } from "@/lib/use-public";
import { hint, notice } from "@/lib/ui";
import { SafePlaceCard } from "./SafePlaceCard";

type Props = { places: NearbyPlaces | null; state: LoadState; userAgent?: string };

/**
 * The top-3 safe places from the person's point, and high ground for cars as its own list (spec
 * 4.3). An empty list says where to ask instead; it never reads as "you don't need one".
 *
 * On the home screen the list is folded under its own button and opens only when the person asks
 * for it (owner, 12 Oct): the screen stays short, and the places are one tap away. It is a native
 * disclosure, so it opens without any script and offline, and the list is already on the phone
 * when it does - it is fetched and stored as before, whether or not it is ever opened (safety
 * rule 7). The button carries the count, so "nothing listed here" is not hidden behind a tap.
 */
export function SafePlaces({ places, state, userAgent }: Props) {
  const t = useTranslations("places");
  const count = places ? places.people.length + places.parking.length : null;
  return (
    <details className="group flex flex-col" data-safe-places={state}>
      <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 rounded-xl border-2 border-jaga-edge bg-jaga-surface px-5 py-2 font-medium text-jaga-ink [&::-webkit-details-marker]:hidden">
        <h2 className="text-body font-bold">
          {t("title")}
          {count !== null && <span className="font-normal tabular-nums"> · {count}</span>}
        </h2>
        {/* A chevron drawn in CSS: it points down when folded and up when open. */}
        <span
          aria-hidden="true"
          className="size-3 shrink-0 -translate-y-0.5 rotate-45 border-b-2 border-e-2 border-jaga-ink transition-transform group-open:translate-y-0.5 group-open:-rotate-135"
        />
      </summary>
      <div className="flex flex-col gap-3 pt-3">
        {!places && (
          <p className={hint}>{t(state === "unavailable" ? "unavailable" : "loading")}</p>
        )}
        {places && places.people.length === 0 && <p className={notice}>{t("none")}</p>}
        {places?.people.map((place) => (
          <SafePlaceCard key={place.id} place={place} userAgent={userAgent} />
        ))}
        {places && places.parking.length > 0 && (
          <>
            <h3 className="text-h3 font-bold text-jaga-ink">{t("parkingTitle")}</h3>
            {places.parking.map((place) => (
              <SafePlaceCard key={place.id} place={place} userAgent={userAgent} />
            ))}
          </>
        )}
      </div>
    </details>
  );
}
