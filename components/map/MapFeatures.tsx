"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { CHIP_ORDER, focusHref, MAP_FOCUSES, type MapFocus } from "@/lib/map-focus";
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
 * Whether the row of chips has scrolled up behind the frozen header, and how tall that header is.
 * Read on scroll and resize, once a frame at most. A test page has no layout, so it never floats.
 */
export function chipsGone(barBottom: number, headerHeight: number): boolean {
  return barBottom < headerHeight - 0.5;
}

function useFloating(ref: RefObject<HTMLElement | null>) {
  const [state, setState] = useState({ float: false, top: 0 });
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      const top = document.querySelector("header")?.getBoundingClientRect().height ?? 0;
      const float = chipsGone(el.getBoundingClientRect().bottom, top);
      setState((s) => (s.float === float && s.top === top ? s : { float, top }));
    };
    const later = () => {
      if (!frame) frame = window.requestAnimationFrame(check);
    };
    later();
    window.addEventListener("scroll", later, { passive: true });
    window.addEventListener("resize", later);
    return () => {
      window.removeEventListener("scroll", later);
      window.removeEventListener("resize", later);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ref]);
  return state;
}

function Chip({
  focus: f,
  on,
  onToggle,
  floating = false,
}: {
  focus: MapFocus;
  on: boolean;
  onToggle: (focus: MapFocus) => void;
  floating?: boolean;
}) {
  const t = useTranslations("mapFeatures");
  // In the floating row a phone shows the drawings only; the name stays for screen readers.
  const small = floating ? "max-sm:size-12 max-sm:justify-center max-sm:p-0" : "";
  return (
    <button
      type="button"
      data-map-chip={f}
      aria-pressed={on}
      title={floating ? t(`${f}.short`) : undefined}
      onClick={() => onToggle(f)}
      className={`inline-flex min-h-tap items-center gap-2 rounded-full border-2 py-1 ps-1.5 pe-4 font-bold active:translate-y-px ${small} ${
        on
          ? "border-jaga-edge bg-jaga-slate text-white"
          : "border-jaga-line bg-jaga-surface text-jaga-ink hover:border-jaga-teal-ink"
      }`}
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-jaga-surface">
        <FeatureIcon feature={f} size={26} />
      </span>
      <span className={floating ? "max-sm:sr-only" : undefined}>{t(`${f}.short`)}</span>
      {LIVE.has(f) && (
        <svg
          aria-hidden="true"
          width="8"
          height="8"
          viewBox="0 0 8 8"
          className={floating ? "max-sm:hidden" : undefined}
        >
          <circle
            cx="4"
            cy="4"
            r="4"
            className={`${on ? "fill-jaga-teal-light" : "fill-jaga-teal-ink"} ${styles.live}`}
          />
        </svg>
      )}
    </button>
  );
}

/**
 * The same six on the map page itself, as a row of switches above the map (the owner, 15 Oct):
 * each shows or hides its layer, several can be on at once, and none moves the map - except the
 * dam, which also brings its report into view below the map.
 *
 * Once the row has scrolled up behind the header, a copy of it stays frozen under the header
 * (the owner, 15 Oct); on a phone that copy is the six drawings only, one line. The row in the
 * page never moves or changes size, so nothing below it jumps. `after` (the fishermen's button)
 * goes under the row, and into the frozen copy from tablet width up.
 */
export function MapFeatureChips({
  on,
  onToggle,
  after,
}: {
  on: Record<MapFocus, boolean>;
  onToggle: (focus: MapFocus) => void;
  after?: ReactNode;
}) {
  const t = useTranslations("mapFeatures");
  const ref = useRef<HTMLElement>(null);
  const { float, top } = useFloating(ref);
  return (
    <>
      <section
        ref={ref}
        aria-labelledby="map-chips-title"
        className="flex flex-col gap-2"
        data-map-features="map"
      >
        <p id="map-chips-title" className="font-medium">
          {t("mapTitle")}
        </p>
        <ul className="flex flex-wrap gap-2">
          {CHIP_ORDER.map((f) => (
            <li key={f}>
              <Chip focus={f} on={on[f]} onToggle={onToggle} />
            </li>
          ))}
        </ul>
        {after}
      </section>
      {float && (
        <div
          data-map-chips-float="true"
          role="group"
          aria-label={t("mapTitle")}
          style={{ top }}
          className="fixed inset-x-0 z-[19] border-b border-jaga-line bg-jaga-ground shadow-sm"
        >
          <div className="mx-auto flex w-full max-w-screen-sm flex-col gap-2 px-4 py-2 lg:max-w-6xl lg:px-6">
            <ul className="flex justify-between gap-1 sm:flex-wrap sm:justify-start sm:gap-2">
              {CHIP_ORDER.map((f) => (
                <li key={f}>
                  <Chip focus={f} on={on[f]} onToggle={onToggle} floating />
                </li>
              ))}
            </ul>
            {after && <div className="flex max-sm:hidden">{after}</div>}
          </div>
        </div>
      )}
    </>
  );
}
