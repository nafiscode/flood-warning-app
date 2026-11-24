"use client";

import { useCallback, useEffect, useRef } from "react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import {
  riverSection,
  SECTION_H,
  SECTION_W,
  WAVE_BANDS,
  waveLine,
  wavePath,
} from "@/lib/gauge-section";
import { overBankMetres, SCENE_SOURCE, type SceneGauge } from "@/lib/flood-scene";
import { localName } from "@/lib/places";
import styles from "./FloodScene.module.css";

/**
 * The flood scene (the owner, 24 Nov 2026): when a river has reached its bank, the moment shown
 * full-screen from the real channel at that gauge - the live reading rising against the station's
 * own banks and spilling over the lower one. The geography is measured (lib/gauge-section.ts); the
 * water's height is the latest reading. Nothing is modelled or forecast.
 *
 * It is a **measurement**, not an alert: the scene never wears an alert colour as its own voice
 * (the water keeps the map's water colour), it names the time and source of the reading, and it
 * says in words that this is not an official alert and where to call in danger (safety rules 2, 3,
 * 4, 8). Where a real alert is in force, the alert's own alarm has already sounded; this only shows
 * what the river is doing.
 *
 * The caller opens it only when `canPlayScene(gauge)` is true, so `value`, the bank and a recent
 * reading are all present here.
 */
export function FloodScene({
  gauge,
  areaName = null,
  onClose,
}: {
  gauge: SceneGauge;
  /** The person's own area, when the scene is opened for it, so it can say "your area". */
  areaName?: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("map.gauge.scene");
  const locale = useLocale();
  const format = useFormatter();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const section = riverSection(gauge);
  const value = typeof gauge.value === "number" ? gauge.value : null;
  const over = overBankMetres(gauge);
  const { surfaceY, channel } = section;
  const glint = WAVE_BANDS[0] ?? { length: 170, amplitude: 2.6 };
  const name = localName(gauge.name, locale);

  // Replaying restarts the animations: remounting the inner scene with a fresh key is the simplest
  // way to let the water rise again from the bed (the owner wanted to watch it happen).
  const replay = useCallback(() => {
    const node = dialogRef.current?.querySelector(`.${styles.camera}`);
    if (!node) return;
    const svg = node as SVGElement;
    svg.getAnimations?.().forEach((a) => {
      a.cancel();
      a.play();
    });
    svg.querySelectorAll("*").forEach((el) => {
      (el as SVGElement).getAnimations?.().forEach((a) => {
        a.cancel();
        a.play();
      });
    });
  }, []);

  const observed = gauge.observedAt ? new Date(gauge.observedAt) : null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={t("title", { name })}
      data-flood-scene={gauge.id}
      // Stops above the hotline bar, which is never covered: the four numbers stay one tap away
      // (safety rule 4), the same clearance the bell panel keeps.
      className="fixed inset-x-0 top-0 bottom-[8.5rem] z-40 overflow-hidden bg-jaga-slate text-white sm:bottom-28"
    >
      {/* The channel, filling the width. A sky-to-water wash behind it blends the letterboxing on a
          tall phone, so the scene reads as one picture rather than a drawing on a card. */}
      <div className="absolute inset-0 flex items-center justify-center">
        <svg
          viewBox={`0 0 ${SECTION_W} ${SECTION_H}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full"
          role="img"
          aria-label={
            value !== null && over !== null
              ? t("alt", { name, value: over.toFixed(2) })
              : t("title", { name })
          }
        >
          <defs>
            <clipPath id="scene-channel">
              <path d={section.channelPath} />
            </clipPath>
            <linearGradient id="scene-sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#152C3F" />
              <stop offset="1" stopColor="#264B68" />
            </linearGradient>
            <linearGradient id="scene-water" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--jaga-dam)" stopOpacity="0.95" />
              <stop offset="1" stopColor="var(--jaga-dam)" stopOpacity="0.72" />
            </linearGradient>
            <linearGradient
              id="scene-sheen"
              x1="0"
              y1={-6}
              x2="0"
              y2={16}
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.4" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* The sky behind everything, so the meet-fit letterbox is never a bare rectangle. */}
          <rect x="0" y="0" width={SECTION_W} height={SECTION_H} fill="url(#scene-sky)" />

          <g className={styles.camera}>
            {/* The ground with the channel cut out of it. */}
            <path d={section.groundPath} fill="#0F2334" />
            <path
              d={section.groundPath}
              fill="none"
              stroke="#ffffff"
              strokeWidth="1"
              strokeOpacity="0.25"
            />

            {/* The water: it rises once from below the bank to the reading, then the two bands drift
                across each other. The surface sits where the reading really stands, and spills over
                the lower bank through the clip, which is the whole picture. */}
            {surfaceY !== null && (
              <g clipPath="url(#scene-channel)">
                <g style={{ transform: `translateY(${surfaceY}px)`, transformBox: "view-box" }}>
                  <g
                    className={styles.water}
                    style={{ "--rise": `${section.riseFrom}px` } as object}
                  >
                    <rect x="0" y="0" width={SECTION_W} height={SECTION_H} fill="url(#scene-water)" />
                    {WAVE_BANDS.map((band) => (
                      <g
                        key={band.length}
                        className={`${styles.drift} ${band.back ? styles.back : ""}`}
                        style={
                          { "--length": band.length, "--seconds": `${band.seconds}s` } as object
                        }
                      >
                        <path
                          d={wavePath(band.length, band.amplitude, SECTION_H)}
                          fill="var(--jaga-dam)"
                          fillOpacity={band.opacity}
                        />
                        {!band.back && (
                          <path
                            d={wavePath(band.length, band.amplitude, SECTION_H)}
                            fill="url(#scene-sheen)"
                          />
                        )}
                      </g>
                    ))}
                    <g className={styles.glint}>
                      <path
                        d={waveLine(glint.length, glint.amplitude)}
                        fill="none"
                        stroke="#ffffff"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </g>
                  </g>
                </g>
              </g>
            )}

            {/* The station's three levels, each dashed in its own alert colour. A line, not a fill:
                the water above carries the map's colour, so the alert palette here only marks where
                the thresholds are, never the reading. */}
            {section.lines.map(({ key, y }) => (
              <path
                key={key}
                d={`M0 ${y} L ${SECTION_W} ${y}`}
                stroke={`var(--alert-${key})`}
                strokeWidth="1.6"
                strokeDasharray="7 5"
                strokeOpacity="0.9"
                fill="none"
                data-flood-line={key}
              />
            ))}

            {/* The bank the river has left, drawn where it stands. */}
            {section.bankMetres !== null && (
              <path
                d={`M${channel.bankL} ${section.bankY} L0 ${section.bankY} M${channel.bankR} ${section.rightY} L${SECTION_W} ${section.rightY}`}
                stroke="#ffffff"
                strokeWidth="1.4"
                strokeOpacity="0.6"
                strokeDasharray="3 4"
                fill="none"
                data-flood-bank=""
              />
            )}
          </g>
        </svg>
      </div>

      {/* The words. Measured facts first, then what this is and is not. */}
      <div className={`${styles.caption} pointer-events-none absolute inset-x-0 top-0 p-4 sm:p-6`}>
        <div className="max-w-xl rounded-xl bg-jaga-slate/70 p-4 backdrop-blur-sm">
          <p className="text-small font-semibold uppercase tracking-wide text-white/80">
            {t("eyebrow")}
          </p>
          <h2 className="mt-1 text-2xl font-bold leading-tight">{t("title", { name })}</h2>
          {over !== null && (
            <p className="mt-1 text-lg font-semibold" data-flood-over="">
              {t("over", { value: over.toFixed(2) })}
            </p>
          )}
          <p className="mt-1 text-white/85">
            {value !== null && t("level", { value: value.toFixed(2) })}
            {observed && (
              <>
                {" · "}
                {t("at", {
                  time: format.dateTime(observed, {
                    timeZone: "Asia/Bangkok",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                  source: SCENE_SOURCE,
                })}
              </>
            )}
          </p>
          {areaName && <p className="mt-1 text-white/85">{t("area", { name: areaName })}</p>}
        </div>
      </div>

      {/* The footer: the disclaimer, the hotline reminder, and the controls. Pointer events are on
          again here so the buttons work; the scene above stays non-interactive. */}
      <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6">
        <div className={`${styles.caption} max-w-xl rounded-xl bg-jaga-slate/70 p-4 backdrop-blur-sm`}>
          <p className="font-medium" data-flood-measurement="">
            {t("notAlert")}
          </p>
          <p className="mt-1 text-white/85">{t("hotlineHint")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={replay}
              className="inline-flex min-h-tap items-center rounded-lg bg-white/15 px-4 font-semibold text-white"
              data-flood-replay=""
            >
              {t("replay")}
            </button>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="inline-flex min-h-tap items-center rounded-lg bg-white px-4 font-semibold text-jaga-slate"
              data-flood-close=""
            >
              {t("close")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
