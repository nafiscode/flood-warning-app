import { useId } from "react";
import { useTranslations } from "next-intl";
import { LEVEL_ICON } from "@/components/alerts/AlertBadge";
import {
  riverSection,
  SECTION_H,
  SECTION_W,
  WAVE_BANDS,
  waveLine,
  wavePath,
  type SectionLevelKey,
} from "@/lib/gauge-section";
import type { Gauge } from "@/lib/map-data";
import { hint } from "@/lib/ui";
import styles from "./GaugeSection.module.css";

/**
 * The river at one gauge, seen across the channel (the owner, 19 Nov 2026): the bed, the water in
 * it now, and the station's Watch, Warning and Evacuate levels as lines across it - the picture
 * residents already know from Nara flood. It belongs to the gauge's **details** card; the mark on
 * the map itself keeps the small animated glass it has always had (lib/gauge-marks.ts).
 *
 * What is measured and what is only drawn are kept apart, here and in the words under it: the
 * water level and the three levels are figures, printed as metres above mean sea level as well as
 * drawn; the shape of the channel and the depth of the bed are a drawing, because Jaga has no
 * surveyed section for these stations. The bed carries no height, for that reason.
 *
 * The lines wear the alert palette, as the explainer's own gauge figure does, and each is named in
 * words beneath with its level's icon: never colour alone. The water keeps the map's water colour
 * at every height, because a reading is a measurement and not an alert (safety rule 2) - and a
 * station that has gone quiet is drawn as an empty channel with its last reading as a grey dashed
 * line, never as water still standing there (safety rule 3's habit).
 */
export function GaugeSection({ gauge }: { gauge: Gauge }) {
  const t = useTranslations("map.gauge.section");
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const section = riverSection(gauge);
  const { surfaceY, bankY, bankMetres, lines, overBank } = section;
  const live = gauge.status !== "no_recent_data" && gauge.value !== null;
  const value = typeof gauge.value === "number" ? gauge.value : null;
  // The bank is drawn as a line of its own only where it is not the Evacuate level under another
  // name, which on most gauges it is.
  const evacuate = lines.find((l) => l.key === "evacuate")?.metres ?? null;
  const ownBank =
    bankMetres !== null && (evacuate === null || Math.abs(bankMetres - evacuate) >= 0.05);
  const metres = (m: number) => t("metres", { value: m.toFixed(2) });
  // The glint follows the front band, so the light sits on the wave a reader can see.
  const glint = WAVE_BANDS[0] ?? { length: 170, amplitude: 2.6 };

  return (
    <div className="flex flex-col gap-2" data-gauge-section={gauge.id}>
      {/* Capped, so the drawing does not grow to half a laptop panel. */}
      <svg
        viewBox={`0 0 ${SECTION_W} ${SECTION_H}`}
        className="h-auto w-full max-w-[26rem]"
        role="img"
        aria-label={live && value !== null ? t("alt", { value: value.toFixed(2) }) : t("altQuiet")}
      >
        <defs>
          <clipPath id={`${uid}-channel`}>
            {/* Two shapes in the one path, so water fills the channel and, only once it is over
                the bank, the ground beside it. */}
            <path d={section.channelPath} />
          </clipPath>
          <linearGradient id={`${uid}-water`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--jaga-dam)" stopOpacity="0.95" />
            <stop offset="1" stopColor="var(--jaga-dam)" stopOpacity="0.7" />
          </linearGradient>
          {/* The light that sits in the first few centimetres of a water surface. */}
          <linearGradient
            id={`${uid}-sheen`}
            x1="0"
            y1={-6}
            x2="0"
            y2={16}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.38" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* The ground, with the channel cut out of it. Nothing is written on it: it is a drawing. */}
        <path d={section.groundPath} fill="var(--jaga-line)" />
        <path
          d={section.groundPath}
          fill="none"
          stroke="var(--jaga-text-2)"
          strokeWidth="1.5"
          strokeOpacity="0.55"
        />

        {surfaceY !== null && live && (
          <g clipPath={`url(#${uid}-channel)`}>
            {/*
             * The water's height is carried by this group alone, so stepping to the next station
             * moves it: it slides up or down to the new level instead of jumping (the owner, 19
             * Nov 2026). Everything inside is drawn with its surface at nought.
             */}
            <g className={styles.level} style={{ "--surface": `${surfaceY}px` } as object}>
              <g className={styles.water} style={{ "--rise": `${section.riseFrom}px` } as object}>
                <rect
                  x="0"
                  y="0"
                  width={SECTION_W}
                  height={SECTION_H}
                  fill={`url(#${uid}-water)`}
                />
                {/* The surface: two bands of different length and speed drifting across each other. */}
                <g>
                  {WAVE_BANDS.map((band) => (
                    <g
                      key={band.length}
                      className={`${styles.drift} ${band.back ? styles.back : ""}`}
                      style={{ "--length": band.length, "--seconds": `${band.seconds}s` } as object}
                    >
                      <path
                        d={wavePath(band.length, band.amplitude, SECTION_H)}
                        fill="var(--jaga-dam)"
                        fillOpacity={band.opacity}
                      />
                      {!band.back && (
                        <path
                          d={wavePath(band.length, band.amplitude, SECTION_H)}
                          fill={`url(#${uid}-sheen)`}
                        />
                      )}
                    </g>
                  ))}
                  {/* The light that runs along a water surface. */}
                  <g className={styles.glint}>
                    <path
                      d={waveLine(glint.length, glint.amplitude)}
                      fill="none"
                      stroke="var(--jaga-surface)"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                  </g>
                </g>
              </g>
            </g>
          </g>
        )}

        {/* The three levels. Each line is named, with its icon, in the list below. */}
        {lines.map(({ key, metres: m, y }) => (
          <g key={key} data-section-line={key}>
            <path
              d={`M4 ${y} L ${SECTION_W - 4} ${y}`}
              stroke={`var(--alert-${key})`}
              strokeWidth="2"
              strokeDasharray="7 5"
              fill="none"
            />
            <rect
              x={SECTION_W - 50}
              y={y - 8.5}
              width="46"
              height="17"
              rx="3.5"
              fill={`var(--alert-${key})`}
            />
            <text
              x={SECTION_W - 27}
              y={y + 5.5}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              fill={`var(--alert-${key}-fg)`}
            >
              {m.toFixed(2)}
            </text>
          </g>
        ))}

        {/*
         * The bank, with its height on it (the owner, 19 Nov 2026: "the river bank level number
         * should be at the bank in the illustration"). Its own dashed line only where it is a
         * level of its own; where the bank IS the Evacuate level, which is the usual case, the
         * alert line already runs at that height and a second line over it would only blur it.
         * The figure is drawn either way, at the left, so the top of the ground always carries
         * the height it stands at.
         */}
        {bankMetres !== null && (
          <g data-section-bank={bankMetres.toFixed(2)}>
            {ownBank && (
              <path
                d={`M4 ${bankY} L ${SECTION_W - 4} ${bankY}`}
                stroke="var(--jaga-text-2)"
                strokeWidth="1.5"
                strokeDasharray="3 4"
                fill="none"
                data-section-line="bank"
              />
            )}
            <rect x="4" y={bankY - 8.5} width="52" height="17" rx="3.5" fill="var(--jaga-slate)" />
            <text
              x="30"
              y={bankY + 5}
              textAnchor="middle"
              fontSize="12"
              fontWeight="700"
              fill="#ffffff"
            >
              {bankMetres.toFixed(2)}
            </text>
          </g>
        )}

        {/* Where the water stands now, as a figure on the surface itself. */}
        {surfaceY !== null && value !== null && (
          /* The figure rides on the surface, so it travels with the water to the next station. */
          <g
            className={styles.level}
            style={{ "--surface": `${surfaceY}px` } as object}
            data-section-now={live ? "live" : "quiet"}
          >
            {!live && (
              <path
                d={`M4 0 L ${SECTION_W - 4} 0`}
                stroke="var(--alert-stale)"
                strokeWidth="2"
                strokeDasharray="4 4"
                fill="none"
              />
            )}
            <rect
              x="6"
              y="-9"
              width="52"
              height="18"
              rx="4"
              fill={live ? "var(--jaga-dam)" : "var(--alert-stale)"}
            />
            <text
              x="32"
              y="5.5"
              textAnchor="middle"
              fontSize="12.5"
              fontWeight="700"
              fill="#ffffff"
            >
              {value.toFixed(2)}
            </text>
          </g>
        )}
      </svg>

      {/* The words. Neither a level nor a height is ever only in the drawing. */}
      <ul className="flex flex-col gap-1 text-small">
        {[...lines].reverse().map(({ key, metres: m }) => {
          const Icon = LEVEL_ICON[key as SectionLevelKey];
          const reached = live && value !== null && value >= m;
          return (
            <li key={key} className="flex items-start gap-2" data-section-level={key}>
              <span
                aria-hidden="true"
                className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-sm"
                style={{ background: `var(--alert-${key})`, color: `var(--alert-${key}-fg)` }}
              >
                <Icon size={16} />
              </span>
              {/* Name, height and distance in one column, so a line that wraps on a 360 px phone
                  wraps under the words rather than under the icon. */}
              <span className="min-w-0 flex-1">
                <span className="font-medium">{t(`level.${key}`)}</span> {metres(m)}
                {live && value !== null && (
                  <>
                    {" "}
                    <span className={hint} data-section-gap={reached ? "reached" : "below"}>
                      {reached ? t("reached") : t("toGo", { value: (m - value).toFixed(2) })}
                    </span>
                  </>
                )}
              </span>
            </li>
          );
        })}
        {bankMetres !== null && (
          <li className="flex items-start gap-2" data-section-level="bank">
            <span
              aria-hidden="true"
              className="mt-2.5 inline-block size-6 shrink-0 rounded-sm bg-jaga-slate"
            />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{t("level.bank")}</span> {metres(bankMetres)}
              {!ownBank && (
                <>
                  {" "}
                  <span className={hint}>{t("bankIsEvacuate")}</span>
                </>
              )}
            </span>
          </li>
        )}
      </ul>

      {/*
       * Two different silences, never said as one. `no_levels` is the database saying this station
       * has no reference levels; lines missing while the status word says otherwise means the
       * levels exist but did not reach this screen (an older `station_status()`, say). Claiming
       * the first when it is the second would tell a reader a station is unjudged when it is not.
       */}
      {lines.length === 0 && (
        <p className={hint}>{t(gauge.status === "no_levels" ? "noLevels" : "levelsUnavailable")}</p>
      )}
      {overBank && <p className="font-medium">{t("overBank")}</p>}
      {!live && value !== null && <p className={hint}>{t("lastReading")}</p>}
      {/* What the picture is, and what it is not. */}
      <p className={hint}>{t("drawing")}</p>
      {lines.length > 0 && gauge.provisionalLevels !== false && (
        <p className={hint}>{t("provisional")}</p>
      )}
    </div>
  );
}
