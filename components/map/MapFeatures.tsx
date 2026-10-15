"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { focusHref, MAP_FOCUSES, type MapFocus } from "@/lib/map-focus";
import { FeatureIcon } from "./FeatureIcon";
import styles from "./FeatureIcon.module.css";

/** The features that change while someone looks: they carry a small "live" mark. */
const LIVE: ReadonlySet<MapFocus> = new Set(["gauges", "dam", "sea"]);

/**
 * The flood-risk tile is wide; so is the last one when it would otherwise sit alone on its row.
 */
const wide = (i: number) =>
  i === 0 || (i === MAP_FOCUSES.length - 1 && (MAP_FOCUSES.length - 1) % 2 === 1);

function LiveTag() {
  const t = useTranslations("mapFeatures");
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-jaga-line px-2 text-small font-bold text-jaga-ink">
      <svg aria-hidden="true" width="8" height="8" viewBox="0 0 8 8">
        <circle cx="4" cy="4" r="4" className={`fill-jaga-teal-ink ${styles.live}`} />
      </svg>
      {t("live")}
    </span>
  );
}

/**
 * The home screen's way into the map (the owner, 15 Oct: the science should not go unseen). Six
 * tiles, one per feature, each opening the map on it; the flood-risk one first and wide. Plain
 * links with words and a small drawing: no map is loaded here, so the home screen stays light on
 * a slow connection (CLAUDE.md).
 */
export function MapFeatureTiles() {
  const t = useTranslations("mapFeatures");
  const tHome = useTranslations("home");
  return (
    <section
      aria-labelledby="map-features-title"
      className="flex flex-col gap-3"
      data-map-features="home"
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="map-features-title" className="text-body font-bold text-jaga-ink">
          {t("homeTitle")}
        </h2>
      </div>
      <ul className="grid grid-cols-2 gap-2">
        {MAP_FOCUSES.map((f, i) => (
          <li key={f} className={wide(i) ? "col-span-2" : undefined}>
            <Link
              href={focusHref(f)}
              prefetch={false}
              data-map-feature={f}
              className="flex h-full min-h-tap flex-col gap-1.5 rounded-xl border-2 border-jaga-line bg-jaga-surface p-3 text-jaga-ink transition-colors hover:border-jaga-teal-ink active:translate-y-px"
            >
              <span className="flex items-center justify-between gap-2">
                <FeatureIcon feature={f} size={i === 0 ? 40 : 32} />
                {LIVE.has(f) && <LiveTag />}
              </span>
              <span className="font-bold leading-snug">{t(`${f}.name`)}</span>
              <span className="text-small leading-snug text-jaga-text-2">{t(`${f}.note`)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href="/map"
        prefetch={false}
        data-map-link="true"
        className="inline-flex min-h-tap items-center justify-center gap-2 rounded-xl bg-jaga-slate px-4 font-bold text-white"
      >
        {tHome("mapLink")}
        <span aria-hidden="true">→</span>
      </Link>
    </section>
  );
}

/**
 * The same six on the map page itself, as a row of buttons above the map: each one switches its
 * layer on, frames it and brings the map into view, so a first visit shows what the map can do
 * instead of leaving it in the legend.
 */
export function MapFeatureChips({
  active,
  onPick,
}: {
  active: MapFocus | null;
  onPick: (focus: MapFocus) => void;
}) {
  const t = useTranslations("mapFeatures");
  return (
    <section
      aria-labelledby="map-chips-title"
      className="flex flex-col gap-2"
      data-map-features="map"
    >
      <p id="map-chips-title" className="font-medium">
        {t("mapTitle")}
      </p>
      <ul className="flex flex-wrap gap-2">
        {MAP_FOCUSES.map((f) => (
          <li key={f}>
            <button
              type="button"
              data-map-chip={f}
              aria-pressed={active === f}
              onClick={() => onPick(f)}
              className={`inline-flex min-h-tap items-center gap-2 rounded-full border-2 py-1 ps-1.5 pe-4 font-bold active:translate-y-px ${
                active === f
                  ? "border-jaga-edge bg-jaga-slate text-white"
                  : "border-jaga-line bg-jaga-surface text-jaga-ink hover:border-jaga-teal-ink"
              }`}
            >
              <span className="grid size-9 place-items-center rounded-full bg-jaga-surface">
                <FeatureIcon feature={f} size={26} />
              </span>
              {t(`${f}.short`)}
              {LIVE.has(f) && (
                <svg aria-hidden="true" width="8" height="8" viewBox="0 0 8 8">
                  <circle
                    cx="4"
                    cy="4"
                    r="4"
                    className={`${active === f ? "fill-jaga-teal-light" : "fill-jaga-teal-ink"} ${styles.live}`}
                  />
                </svg>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
