"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { CrossIcon, TackIcon } from "@/components/icons";
import type { Dam } from "@/lib/dam";
import {
  METER_CENTRE,
  METER_LABELS,
  meterAngle,
  meterArc,
  meterPoint,
  meterReading,
  meterShare,
  meterTicks,
} from "@/lib/dam-meter";
import { damTally, type DamTally } from "@/lib/map-console";
import { localName } from "@/lib/places";
import dial from "./DamMeters.module.css";
import live from "./FeatureIcon.module.css";

/** The instrument's own palette: a dark face in every theme, like a real one. Water, never alert. */
const RIM = ["#6F94A8", "#14303F"] as const;
const FACE = ["#1D4259", "#0A1A26"] as const;
const WATER = ["#1F7A74", "#8FE0D8"] as const;
const INK = "#F4FAFC";
const SOFT = "#A8BCC6";

/** True when water is going over the spillway, or the level is past the one it is held at. */
function attentionOf(tally: DamTally): boolean {
  if ((tally.spilledCms ?? 0) > 0) return true;
  const { percentFull, normalMark } = tally;
  return percentFull !== null && normalMark !== null && percentFull / 100 > normalMark;
}

/**
 * One dial: a 270-degree gauge for a reservoir's water level as a share of its capacity.
 *
 * It draws what lib/dam-meter.ts works out and decides nothing. The reading is the number in the
 * dial and, in words, beside it; the arc and needle are the same number as a picture, so a reader
 * who cannot tell the shades apart loses nothing (accessibility: never by colour alone).
 */
export function DamMeter({
  percent,
  normalMark,
  attention = false,
  stale = false,
}: {
  percent: number | null;
  /** The share the reservoir is normally held at, 0-1, or null when it is not published. */
  normalMark: number | null;
  /** Water is going over the spillway, or the level is past normal: the ring breathes. */
  attention?: boolean;
  stale?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const share = meterShare(percent);
  const angle = meterAngle(percent);
  const reading = meterReading(percent);
  const normal = normalMark !== null ? meterAngle(normalMark * 100) : null;
  return (
    <svg
      viewBox="0 0 200 200"
      aria-hidden="true"
      data-dam-dial="true"
      className={`${stale ? dial.stale : ""} ${attention ? dial.attention : ""} size-full`}
    >
      <defs>
        <linearGradient id={`${uid}rim`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor={RIM[0]} />
          <stop offset="1" stopColor={RIM[1]} />
        </linearGradient>
        <radialGradient id={`${uid}face`} cx="50%" cy="34%" r="75%">
          <stop offset="0" stopColor={FACE[0]} />
          <stop offset="1" stopColor={FACE[1]} />
        </radialGradient>
        <linearGradient id={`${uid}water`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={WATER[0]} />
          <stop offset="1" stopColor={WATER[1]} />
        </linearGradient>
        <linearGradient id={`${uid}gloss`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <circle cx={METER_CENTRE} cy={METER_CENTRE} r="98" fill={`url(#${uid}rim)`} />
      <circle cx={METER_CENTRE} cy={METER_CENTRE} r="93" fill="#071520" />
      <circle cx={METER_CENTRE} cy={METER_CENTRE} r="90" fill={`url(#${uid}face)`} />

      {/* The track, and the water in it up to the reading. */}
      <path
        d={meterArc(70)}
        pathLength={100}
        fill="none"
        stroke="#244B60"
        strokeWidth="11"
        strokeLinecap="butt"
      />
      {share > 0 && (
        <path
          className={dial.fill}
          d={meterArc(70)}
          pathLength={100}
          fill="none"
          stroke={`url(#${uid}water)`}
          strokeWidth="11"
          strokeLinecap="butt"
          style={{ "--share": share * 100 } as React.CSSProperties}
        />
      )}

      {meterTicks().map((tick) => (
        <line
          key={tick.percent}
          x1={tick.from.x}
          y1={tick.from.y}
          x2={tick.to.x}
          y2={tick.to.y}
          stroke={tick.major ? "#D4E4EB" : "#6F8FA0"}
          strokeWidth={tick.major ? 2 : 1}
        />
      ))}
      {METER_LABELS.map((label) => {
        const at = meterPoint(53, meterAngle(label));
        return (
          <text
            key={label}
            x={at.x}
            y={at.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="12"
            fontWeight="600"
            fill={SOFT}
          >
            {label}
          </text>
        );
      })}

      {/* Where the reservoir is normally held: a bright notch through the scale. */}
      {normal !== null && (
        <g data-dam-normal="true">
          <line
            x1={meterPoint(60, normal).x}
            y1={meterPoint(60, normal).y}
            x2={meterPoint(92, normal).x}
            y2={meterPoint(92, normal).y}
            stroke={INK}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx={meterPoint(94, normal).x} cy={meterPoint(94, normal).y} r="3" fill={INK} />
        </g>
      )}

      {/* The needle, with the hub it turns on. */}
      <g className={dial.needle} style={{ "--to": `${angle}deg` } as React.CSSProperties}>
        <path d="M100 28 L104.2 100 L100 118 L95.8 100 Z" fill={INK} />
        <path d="M100 28 L102.2 52 L97.8 52 Z" fill={WATER[1]} />
      </g>
      <circle cx={METER_CENTRE} cy={METER_CENTRE} r="9" fill={`url(#${uid}rim)`} />
      <circle cx={METER_CENTRE} cy={METER_CENTRE} r="3.2" fill="#071520" />

      <text
        x={METER_CENTRE}
        y="152"
        textAnchor="middle"
        fill={INK}
        fontWeight="700"
        fontSize="29"
        opacity={stale ? 0.65 : 1}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {reading ?? "—"}
      </text>
      {reading !== null && (
        <text
          x={METER_CENTRE}
          y="170"
          textAnchor="middle"
          fill={SOFT}
          fontWeight="600"
          fontSize="13"
          opacity={stale ? 0.65 : 1}
        >
          %
        </text>
      )}

      {/* Glass over all of it. */}
      <ellipse cx={METER_CENTRE} cy="54" rx="64" ry="34" fill={`url(#${uid}gloss)`} />
    </svg>
  );
}

/**
 * Every reservoir as a meter, in a column over the map where the reservoir's own card opens (the
 * owner, 23 Oct 2026: "float with the same background filled like the 5 cards on the right ...
 * show the same location where the detail info of dams opened up ... align vertically").
 *
 * It is the war room's view of the reservoirs: the live level of all of them at a glance, each a
 * press away from its full card. It can be pinned to stay on the map while the reader works.
 */
export function DamMetersPanel({
  dams,
  locale,
  time,
  pinned,
  onPin,
  onClose,
  onOpenDam,
}: {
  /** In the readout's own order: theirs and in trouble first, then nearest, then largest. */
  dams: readonly Dam[];
  locale: string;
  time: (iso: string) => string;
  pinned: boolean;
  onPin: () => void;
  onClose: () => void;
  onOpenDam: (dam: Dam) => void;
}) {
  const t = useTranslations("map.meters");
  const tConsole = useTranslations("map.console");
  const rows = dams.flatMap((dam) => {
    const tally = damTally(dam);
    return tally ? [{ dam, tally }] : [];
  });
  const glass = {
    background: "color-mix(in srgb, var(--jaga-surface) 88%, transparent)",
    backdropFilter: "blur(10px) saturate(1.15)",
    boxShadow: "0 8px 24px rgb(29 59 83 / 0.28)",
  } as const;
  return (
    <section
      data-dam-meters="true"
      aria-labelledby="dam-meters-title"
      className="flex flex-col gap-2"
    >
      <header
        data-dam-meters-head="true"
        className="flex items-start justify-between gap-2 rounded-xl border border-jaga-line px-3 py-2"
        style={glass}
      >
        <div className="min-w-0">
          <h2 id="dam-meters-title" className="font-bold leading-snug text-jaga-ink">
            {t("title")}
          </h2>
          <p className="text-small leading-snug text-jaga-text-2">{t("basis")}</p>
        </div>
        <span className="flex shrink-0 items-center">
          <button
            type="button"
            data-dam-meters-pin="true"
            aria-pressed={pinned}
            onClick={onPin}
            className="grid min-h-tap min-w-tap place-items-center rounded-lg text-jaga-text-2 hover:text-jaga-ink"
          >
            <TackIcon size={20} on={pinned} aria-hidden="true" />
            <span className="sr-only">{pinned ? t("unpin") : t("pin")}</span>
          </button>
          <button
            type="button"
            data-dam-meters-close="true"
            onClick={onClose}
            className="grid min-h-tap min-w-tap place-items-center rounded-lg text-jaga-text-2 hover:text-jaga-ink"
          >
            <CrossIcon size={20} aria-hidden="true" />
            <span className="sr-only">{t("close")}</span>
          </button>
        </span>
      </header>

      <ul className="flex flex-col gap-2">
        {rows.map(({ dam, tally }) => {
          const name = localName(dam.name, locale);
          const current = !tally.stale && tally.observedAt !== null;
          const attention = attentionOf(tally);
          const what =
            (tally.spilledCms ?? 0) > 0
              ? t("spilling")
              : attention
                ? t("aboveNormal")
                : t("normalNow");
          return (
            <li key={dam.code}>
              <button
                type="button"
                data-dam-meter={dam.code}
                onClick={() => onOpenDam(dam)}
                aria-label={t("label", {
                  dam: name,
                  percent: tally.percentFull !== null ? Math.round(tally.percentFull) : "-",
                })}
                className="grid w-full grid-cols-[8rem_minmax(0,1fr)] items-center gap-3 rounded-xl border border-jaga-line p-2 text-start hover:border-jaga-teal-ink active:translate-y-px"
                style={glass}
              >
                <span className="block size-[8rem]">
                  <DamMeter
                    percent={tally.percentFull}
                    normalMark={tally.normalMark}
                    attention={attention}
                    stale={tally.stale}
                  />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex items-start gap-1.5 font-bold leading-snug text-jaga-ink">
                    {current && (
                      <svg
                        aria-hidden="true"
                        data-live-dot="true"
                        width="8"
                        height="8"
                        viewBox="0 0 8 8"
                        className="mt-2 shrink-0"
                      >
                        <circle cx="4" cy="4" r="4" className={`fill-jaga-teal-ink ${live.live}`} />
                      </svg>
                    )}
                    <span className="min-w-0">{name}</span>
                  </span>
                  <span className="text-small leading-snug text-jaga-ink">
                    {tally.percentFull === null ? t("noReading") : what}
                  </span>
                  {tally.normalMark !== null && (
                    <span className="text-small leading-snug text-jaga-text-2">
                      {t("normalAt", { percent: Math.round(tally.normalMark * 100) })}
                    </span>
                  )}
                  <span className="text-small leading-snug text-jaga-text-2">
                    {[
                      tally.observedAt
                        ? tConsole("newest", { time: time(tally.observedAt) })
                        : null,
                      tally.stale ? t("stale") : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p
        className="rounded-xl border border-jaga-line px-3 py-2 text-small leading-snug text-jaga-text-2"
        style={glass}
      >
        {t("hint")}
      </p>
    </section>
  );
}

/** A small dial, for the button that opens the meters: the same 270 degrees, in outline. */
export function MeterIcon({ size = 24 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5.6 18.4a9 9 0 1 1 12.8 0" />
      <path d="M12 13l3.6-4.6" />
      <circle cx="12" cy="13" r="1.2" />
    </svg>
  );
}
