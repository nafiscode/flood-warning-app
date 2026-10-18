"use client";

import { useFormatter, useTranslations } from "next-intl";
import { CheckIcon, ClockIcon, TriangleIcon, WaveIcon } from "@/components/icons";
import { DamSectionLabels, DamSectionScene } from "@/components/dam/DamSection";
import type { Dam, DamLevel } from "@/lib/dam";
import { damFigure, FIGURE_INK, type DamFigure } from "@/lib/dam-figure";
import { hint } from "@/lib/ui";
import styles from "./DamFigures.module.css";

/**
 * Three ways of drawing what Bang Lang is doing, for the owner to choose between (12 Oct).
 *
 * What they have in common, because it is not negotiable:
 *
 *   * **Everything that moves is a published figure.** The water level is the storage against the
 *     dam's capacity, the speed is the outflow against the largest release in the record, and a
 *     dam that has published nothing stands still in grey (safety rule 10).
 *   * **Motion is never the only channel.** Each figure carries the state's colour, an icon and a
 *     word, and the numbers sit beneath it; someone with motion turned off, or not looking, loses
 *     nothing (CLAUDE.md accessibility, docs/brand.md).
 *   * **It is not an alert.** The colours are the dam's own state chip of 12 Oct, and the caption
 *     says these are the dam's figures; only a person issues a level (safety rule 2).
 *   * Drawn as inline SVG on a fixed viewBox and animated with CSS transform and opacity only:
 *     no canvas, no library, nothing downloaded, and the same geometry on every screen.
 */

const ICON: Record<DamLevel, typeof CheckIcon> = {
  unknown: ClockIcon,
  normal: CheckIcon,
  watch: TriangleIcon,
  releasing: WaveIcon,
};

export type DamFigureName = "section" | "river" | "dial";

function Caption({ figure }: { figure: DamFigure }) {
  const t = useTranslations("dam");
  const format = useFormatter();
  const Icon = ICON[figure.level];
  const n = (value: number, digits = 0) => format.number(value, { maximumFractionDigits: digits });
  return (
    <div className="flex flex-col gap-1">
      <p className={`flex items-center gap-2 font-bold ${FIGURE_INK[figure.level]}`}>
        <Icon size={22} aria-hidden="true" />
        {t(`state.${figure.level}`)}
      </p>
      <p className="tabular-nums">
        {figure.outflowCms === null
          ? t("figures.none")
          : t("figure.caption", {
              cms: n(figure.outflowCms),
              percent: figure.fullness === null ? "—" : n(figure.fullness * 100, 1),
            })}
      </p>
      {figure.stale && <p className={hint}>{t("state.stale")}</p>}
    </div>
  );
}

function label(t: ReturnType<typeof useTranslations>, figure: DamFigure, which: string): string {
  return t(`figure.${which}.alt`, {
    state: t(`state.${figure.level}`),
    cms: figure.outflowCms ?? 0,
    percent: figure.fullness === null ? 0 : Math.round(figure.fullness * 100),
  });
}

/** The frame every figure sits in: one border, and the state's colour as `currentColor`. */
function Frame({
  figure,
  alt,
  viewBox,
  name,
  caption = true,
  overlay,
  capWidth = false,
  children,
}: {
  figure: DamFigure;
  alt: string;
  /** Left out by a drawing that owns its own svg, like the cross-section. */
  viewBox?: string;
  name: DamFigureName;
  /**
   * The figures themselves, as HTML over the drawing (the owner, 18 Oct). They are not read
   * aloud: the box is a single `img` to a screen reader, which the caption and the report's own
   * panel both say in words.
   */
  overlay?: React.ReactNode;
  /** A drawing with writing on it must not become a billboard in the dam's full report. */
  capWidth?: boolean;
  /**
   * False where the screen already says the state in words below the drawing - the dam's full
   * report does, three lines running (seen in a browser, 13 Oct). The drawing keeps its own
   * description for a screen reader either way.
   */
  caption?: boolean;
  children: React.ReactNode;
}) {
  return (
    <figure className="flex flex-col gap-2" data-dam-figure={name} data-dam-level={figure.level}>
      <div
        role="img"
        aria-label={alt}
        className={`relative mx-auto w-full overflow-hidden rounded-xl border border-jaga-line bg-jaga-ground ${capWidth ? "max-w-[560px]" : ""} ${FIGURE_INK[figure.level]}`}
        style={{ ["--cycle" as string]: `${figure.cycleSeconds}s` }}
      >
        {viewBox ? (
          <svg viewBox={viewBox} className="block h-auto w-full" aria-hidden="true">
            {children}
          </svg>
        ) : (
          children
        )}
        {overlay}
      </div>
      {caption && (
        <figcaption>
          <Caption figure={figure} />
        </figcaption>
      )}
    </figure>
  );
}

/**
 * 1. **The cross-section**, the figure the owner chose on 13 Oct and asked to have the readings
 * written on to on 18 Oct. The drawing itself is in DamSection.tsx, which explains what each part
 * of it is; here it is only put in its frame, with its labels over it and its caption under it.
 */
export function DamSectionFigure({ dam, caption = true }: { dam: Dam; caption?: boolean }) {
  const t = useTranslations("dam");
  const f = damFigure(dam);
  return (
    <Frame
      figure={f}
      name="section"
      alt={label(t, f, "section")}
      caption={caption}
      capWidth
      overlay={<DamSectionLabels f={f} />}
    >
      <DamSectionScene f={f} />
    </Frame>
  );
}

/**
 * 2. **The river.** The water below the dam seen from above, with lines travelling downstream as
 * fast as the dam is releasing: a quiet day drifts, a release runs. The flattest of the three,
 * which suits a home screen where everything else is a card of words.
 */
export function DamRiverFigure({ dam }: { dam: Dam }) {
  const t = useTranslations("dam");
  const f = damFigure(dam);
  const lines = f.still ? 4 : 5 + Math.round(f.flow * 5);
  return (
    <Frame figure={f} name="river" viewBox="0 0 160 56" alt={label(t, f, "river")}>
      {/* The banks, and the water between them, kept pale so the streaks read against it. */}
      <rect x="0" y="14" width="160" height="28" className="fill-current" opacity="0.12" />
      <line x1="0" x2="160" y1="14" y2="14" className="stroke-jaga-line" strokeWidth="1.5" />
      <line x1="0" x2="160" y1="42" y2="42" className="stroke-jaga-line" strokeWidth="1.5" />
      {Array.from({ length: lines }, (_, i) => {
        const y = 19 + ((i * 5) % 19);
        const width = 20 + (i % 3) * 10;
        return (
          <g
            key={i}
            className={f.still ? undefined : styles.flowLine}
            // Evenly spread through one cycle, so the lines never arrive in a clump.
            style={{ animationDelay: `-${((i * f.cycleSeconds) / lines).toFixed(2)}s` }}
          >
            {/* The bob rides inside the travel: one transform each, or they cancel out. */}
            <g
              className={f.still ? undefined : styles.drift}
              style={{ animationDelay: `${(i % 3) * 0.4}s` }}
            >
              <rect
                x={f.still ? 18 + i * 34 : -width}
                y={y}
                width={width}
                height="3.5"
                rx="1.75"
                className="fill-current"
                opacity={0.7 + (i % 3) * 0.15}
              />
            </g>
          </g>
        );
      })}
      {/* The dam at the head of it. */}
      <rect x="8" y="10" width="5" height="36" rx="1.5" className="fill-jaga-edge" opacity="0.85" />
    </Frame>
  );
}

/**
 * 3. **The dial.** An instrument: outflow from nothing to the largest release in the record, with
 * the turbines' own range shaded, and a needle that eases to where the figures are. The most
 * exact of the three, and the one that shows at a glance whether a gate must be open.
 */
export function DamDialFigure({ dam }: { dam: Dam }) {
  const t = useTranslations("dam");
  const f = damFigure(dam);
  // A half-dial on a 160 x 92 box, centred at (80, 76) with a radius of 58.
  const cx = 80;
  const cy = 76;
  const r = 58;
  const point = (share: number, radius = r) => {
    const angle = Math.PI * (1 - share);
    return [cx + radius * Math.cos(angle), cy - radius * Math.sin(angle)];
  };
  const arc = (from: number, to: number) => {
    const [x1, y1] = point(from);
    const [x2, y2] = point(to);
    return `M ${x1!.toFixed(2)} ${y1!.toFixed(2)} A ${r} ${r} 0 0 1 ${x2!.toFixed(2)} ${y2!.toFixed(2)}`;
  };
  // -90 degrees is nothing, on the left; +90 is the record release, on the right.
  const angle = -90 + f.flow * 180;
  return (
    <Frame figure={f} name="dial" viewBox="0 0 160 92" alt={label(t, f, "dial")}>
      <path
        d={arc(0, 1)}
        className="stroke-jaga-line"
        strokeWidth="9"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d={arc(0, Math.max(0.005, f.flow))}
        className="stroke-current"
        strokeWidth="9"
        fill="none"
        strokeLinecap="round"
      />
      {/*
       * The turbines' own limit, as a mark across the scale rather than a band beneath it: a band
       * disappeared under the value the moment the dam released more than the turbines can pass,
       * which is exactly when a reader wants to see where that line is.
       */}
      <line
        x1={point(f.turbineMark, r - 7)[0]}
        y1={point(f.turbineMark, r - 7)[1]}
        x2={point(f.turbineMark, r + 7)[0]}
        y2={point(f.turbineMark, r + 7)[1]}
        className="stroke-jaga-text-2"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <g className={styles.needle} style={{ transform: `rotate(${angle}deg)` }}>
        <line
          x1={cx}
          y1={cy}
          x2={cx}
          y2={cy - r + 13}
          className="stroke-current"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
      <circle cx={cx} cy={cy} r="6" className="fill-jaga-ground stroke-current" strokeWidth="2.5" />
      <circle cx={cx} cy={cy} r="2.5" className={`fill-current ${f.still ? "" : styles.pulse}`} />
    </Frame>
  );
}

export const DAM_FIGURES: Record<DamFigureName, (props: { dam: Dam }) => React.JSX.Element> = {
  section: DamSectionFigure,
  river: DamRiverFigure,
  dial: DamDialFigure,
};

/** Which figure a dam is drawn with, once one has been chosen. */
export function DamFigureBy({ name, dam }: { name: DamFigureName; dam: Dam }) {
  const Figure = DAM_FIGURES[name];
  return <Figure dam={dam} />;
}
