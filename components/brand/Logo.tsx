/* eslint-disable @next/next/no-img-element -- small static SVGs; next/image adds nothing here */
import { useTranslations } from "next-intl";

import { SpinningMark } from "./SpinningMark";

type Props = {
  /** Mark height in px. Below 64 px the simplified mark is used (docs/brand.md). */
  size?: number;
  layout?: "horizontal" | "stacked" | "mark";
  /** "light" on light backgrounds, "reverse" on the brand slate. */
  tone?: "light" | "reverse";
  /** Trial (9 Oct 2026): the mark turns three times when the page opens, then rests. */
  animated?: boolean;
};

export const SMALL_MARK_BELOW = 64;
/** The mark files are 84 × 120: the j under its canopy is taller than it is wide. */
export const MARK_ASPECT = 84 / 120;

export function markSrc(size: number, tone: "light" | "reverse"): string {
  const small = size < SMALL_MARK_BELOW ? "-small" : "";
  const rev = tone === "reverse" ? "-reverse" : "";
  return `/brand/jaga-mark${small}${rev}.svg`;
}

/**
 * The Jaga lockup: mark, then the wordmark "Jaga" (700, -0.01em) with "จากา" underneath at
 * about 35% of the wordmark size. Horizontal: the mark is about 1.7× the wordmark cap height.
 * Clear space: about 12% of the mark height on every side. Never recolored (docs/brand.md).
 */
export function Logo({
  size = 48,
  layout = "horizontal",
  tone = "light",
  animated = false,
}: Props) {
  const t = useTranslations("app");
  const mark = animated ? (
    <SpinningMark
      width={Math.round(size * MARK_ASPECT)}
      height={size}
      small={size < SMALL_MARK_BELOW}
      tone={tone}
      label={layout === "mark" ? t("name") : ""}
    />
  ) : (
    <img
      src={markSrc(size, tone)}
      width={Math.round(size * MARK_ASPECT)}
      height={size}
      alt={layout === "mark" ? t("name") : ""}
      className="shrink-0"
    />
  );
  if (layout === "mark") return <span style={{ padding: size * 0.12 }}>{mark}</span>;

  // Cap height of IBM Plex Sans Thai is about 0.7 em, so 1.7 × cap height ≈ 1.19 em.
  const wordmarkPx = layout === "horizontal" ? size / 1.19 : size * 0.55;
  const textColor = tone === "reverse" ? "text-white" : "text-jaga-slate";

  return (
    <span
      className={`inline-flex items-center ${layout === "stacked" ? "flex-col text-center" : "flex-row"} ${textColor}`}
      style={{ gap: size * 0.2, padding: size * 0.12 }}
    >
      {mark}
      <span className="flex flex-col leading-none">
        <span className="font-bold" style={{ fontSize: wordmarkPx, letterSpacing: "-0.01em" }}>
          {t("name")}
        </span>
        <span
          className="font-medium"
          style={{ fontSize: Math.max(wordmarkPx * 0.35, 12), marginTop: wordmarkPx * 0.12 }}
        >
          {t("nameThai")}
        </span>
      </span>
    </span>
  );
}
