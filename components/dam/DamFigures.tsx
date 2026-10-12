"use client";

import { useFormatter, useTranslations } from "next-intl";
import { CheckIcon, ClockIcon, TriangleIcon, WaveIcon } from "@/components/icons";
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
  children,
}: {
  figure: DamFigure;
  alt: string;
  viewBox: string;
  name: DamFigureName;
  children: React.ReactNode;
}) {
  return (
    <figure className="flex flex-col gap-2" data-dam-figure={name} data-dam-level={figure.level}>
      <div
        role="img"
        aria-label={alt}
        className={`w-full overflow-hidden rounded-xl border border-jaga-line bg-jaga-ground ${FIGURE_INK[figure.level]}`}
        style={{ ["--cycle" as string]: `${figure.cycleSeconds}s` }}
      >
        <svg viewBox={viewBox} className="h-auto w-full" aria-hidden="true">
          {children}
        </svg>
      </div>
      <figcaption>
        <Caption figure={figure} />
      </figcaption>
    </figure>
  );
}

/**
 * 1. **The cross-section.** The dam seen from the side, the way a hydrologist draws one: the
 * reservoir on the left filling towards the line the operator works to, the wall, and the water
 * leaving on the right - through the outlet at the speed it is really leaving, and over the crest
 * when a gate is open. The most literal of the three: cause and effect in one picture.
 */
export function DamSectionFigure({ dam }: { dam: Dam }) {
  const t = useTranslations("dam");
  const f = damFigure(dam);
  // The box is 160 x 90: the bed at y = 78, the crest at y = 16, the wall at x = 96.
  const bed = 78;
  const crest = 16;
  const top = (share: number) => bed - share * (bed - crest);
  const water = top(f.fullness ?? 0);
  const normal = f.normalMark === null ? null : top(f.normalMark);
  // The tailwater below the dam rises a little with the release.
  const tail = bed - 4 - f.flow * 8;
  return (
    <Frame figure={f} name="section" viewBox="0 0 160 90" alt={label(t, f, "section")}>
      {/* The valley the dam sits in. */}
      <path
        d="M0 90 L0 26 L16 26 L30 78 L126 78 L140 18 L160 18 L160 90 Z"
        className="fill-jaga-line"
        opacity="0.55"
      />
      {/* The reservoir, from the bed up to the storage the dam has published. */}
      <rect
        x="16"
        y={water}
        width="80"
        height={Math.max(0, bed - water)}
        className="fill-current"
        opacity="0.28"
      />
      <g className={f.still ? undefined : styles.ripple}>
        <rect x="14" y={water - 1.5} width="84" height="3" rx="1.5" className="fill-current" />
      </g>
      {normal !== null && (
        <line
          x1="16"
          x2="104"
          y1={normal}
          y2={normal}
          className="stroke-jaga-text-2"
          strokeWidth="1"
          strokeDasharray="4 3"
        />
      )}
      {/* The wall, and the crest the water would go over. */}
      <path
        d={`M96 ${crest} L108 ${crest} L112 ${bed} L96 ${bed} Z`}
        className="fill-jaga-edge"
        opacity="0.85"
      />
      {/* Downstream: the tailwater, and the jet leaving the outlet at the foot of the wall. */}
      <rect
        x="112"
        y={tail}
        width="48"
        height={bed - tail + 12}
        className="fill-current"
        opacity="0.22"
      />
      {!f.still && (
        <g className={styles.jet}>
          <rect x="106" y={bed - 11} width="18" height="4.5" rx="2.25" className="fill-current" />
        </g>
      )}
      {f.spilling &&
        [0, 1, 2].map((i) => (
          <circle
            key={i}
            cx={109 + i * 4}
            cy={crest + 5}
            r="2.4"
            className={`fill-current ${styles.spill}`}
            style={{ animationDelay: `${i * 0.22}s` }}
          />
        ))}
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
