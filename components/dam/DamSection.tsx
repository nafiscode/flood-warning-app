"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { DamFigure } from "@/lib/dam-figure";
import styles from "./DamFigures.module.css";

/**
 * The dam in cross-section, with its figures written on it (the owner, 18 Oct 2026: "add the
 * details like storage, live capacity now, flow, reservoir level... make the animation look more
 * real dam, cooler yet easy to understand").
 *
 * What is drawn is a real embankment dam, in the order water meets it: the reservoir standing
 * against the line the operator works to, the intake tower, the fill and its clay core, the gated
 * spillway cut into the crest, the powerhouse at the toe, and the tailwater carrying the release
 * away. Two ways out, because the dam publishes two and they mean different things downstream:
 * the turbines, which run most days, and the spillway gate, which opens only when the reservoir
 * cannot hold what is arriving.
 *
 * **Every moving and every measured thing on it is a published figure**: the water stands at the
 * storage, the gate lifts only when the dam reports a spill, the jet runs at the release, and the
 * arrow arrives at the inflow. Nothing is modelled and nothing is a forecast (safety rule 8), and
 * a dam that has published nothing stands still in grey with its readings left off rather than
 * drawn at zero (safety rule 10).
 *
 * The numbers are HTML over the drawing, not text inside the SVG: SVG text scales with the box,
 * which would leave Thai at 8 px on a phone and 30 px on a laptop. The box itself is capped so
 * the figure never becomes a billboard in the dam's full report.
 */

/* The drawing's own grid: 320 x 180, water to the left, the river to the right. */
const BED = 152; // the reservoir floor
const CREST = 44; // the top of the embankment
const FULL = 56; // where the water stands at the dam's maximum capacity
const UP_TOE = 150; // where the upstream face meets the floor
const CREST_L = 190;
const CREST_R = 222;
const DOWN_TOE = 266; // where the downstream face meets the ground
const GROUND = 156; // the ground below the dam, a little lower than the reservoir floor
const NOTCH_L = 206; // the spillway, cut into the crest
const NOTCH_R = 222;
const NOTCH_Y = 58;
const TOWER_X = 139; // the intake tower, standing in the reservoir
const BANK_X = 40; // the far bank: the valley narrows as it deepens
const BANK_Y = 64;
const TAIL_X = 258; // where the tailwater begins

/** Where the upstream face of the dam stands at a given height. */
const faceX = (y: number) => UP_TOE + ((BED - y) * (CREST_L - UP_TOE)) / (BED - CREST);
/** Where the far bank stands at a given height. */
const bankX = (y: number) => Math.max(0, ((y - BANK_Y) * BANK_X) / (BED - BANK_Y));
/** The height of the water for a share of the dam's capacity. */
export const waterTop = (share: number) => BED - share * (BED - FULL);
/** A point in the box as a percentage of it, for an HTML label over the drawing. */
const pc = (value: number, of: number) => `${((value / of) * 100).toFixed(2)}%`;

/*
 * A reading can end up over the water, over the fill or over the sky as the reservoir rises and
 * falls, so each one carries the box's own background behind it rather than trusting its spot.
 */
const PLATE = "rounded bg-jaga-ground/80 px-1";

function Tag({
  x,
  y,
  align = "start",
  children,
}: {
  x: number;
  y: number;
  align?: "start" | "end";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`absolute flex flex-col ${align === "end" ? "items-end" : "items-start"}`}
      style={{
        left: align === "end" ? undefined : pc(x, 320),
        right: align === "end" ? pc(320 - x, 320) : undefined,
        top: pc(y, 180),
      }}
    >
      {children}
    </div>
  );
}

/** A reading on the drawing: what it is, then the figure, then its unit. */
function Reading({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <p className={`${PLATE} leading-tight whitespace-nowrap`}>
      <span className="block text-[13px] text-jaga-text-2">{label}</span>
      <span className="text-[16px] font-bold tabular-nums">{value}</span>{" "}
      <span className="text-[13px] text-jaga-text-2">{unit}</span>
    </p>
  );
}

export function DamSectionScene({ f }: { f: DamFigure }) {
  const water = waterTop(f.fullness ?? 0);
  const normal = f.normalMark === null ? null : waterTop(f.normalMark);
  const dry = f.fullness === null;
  // The river below the dam stands a little higher the more is coming down it.
  const tail = 146 - f.flow * 4;
  // A gate that is passing water is drawn lifted out of the notch, by how much it is passing.
  const gateY = NOTCH_Y - 13 - (f.spilling ? Math.min(8, 2 + f.flow * 12) : 0);
  const running = !f.still && (f.releasedCms ?? 0) > 0;
  return (
    <svg viewBox="0 0 320 180" className="block h-auto w-full" aria-hidden="true">
      <defs>
        {/* Deep water is darker: one colour, two opacities, so the state's ink still carries it. */}
        <linearGradient id="jaga-dam-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.3" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.62" />
        </linearGradient>
        <linearGradient id="jaga-dam-tail" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.34" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.52" />
        </linearGradient>
        {/* The embankment is not one flat mass: the fill lightens towards the crest. */}
        <linearGradient id="jaga-dam-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--jaga-edge)" stopOpacity="0.78" />
          <stop offset="100%" stopColor="var(--jaga-edge)" stopOpacity="1" />
        </linearGradient>
        <linearGradient id="jaga-dam-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--jaga-line)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--jaga-line)" stopOpacity="0" />
        </linearGradient>
        {/* The water is cut off by the far bank and by the face of the dam. */}
        <clipPath id="jaga-dam-basin">
          <path
            d={`M0 ${BANK_Y} L${faceX(CREST)} ${CREST} L${UP_TOE} ${BED} L${BANK_X} ${BED} Z`}
          />
        </clipPath>
      </defs>

      {/* The sky over the valley, and the hills standing behind the dam. */}
      <rect x="0" y="0" width="320" height="96" fill="url(#jaga-dam-sky)" />
      <path
        d="M196 44 L236 8 L268 30 L292 14 L320 44 L320 96 L196 96 Z"
        className="fill-jaga-line"
        opacity="0.6"
      />
      <path d="M0 56 L22 34 L54 56 L54 96 L0 96 Z" className="fill-jaga-line" opacity="0.4" />

      {/* The ground: the far bank, the reservoir floor, and the land the dam stands on. */}
      <path
        d={`M0 180 L0 ${BANK_Y} L${BANK_X} ${BED} L${UP_TOE} ${BED} L${CREST_L} ${CREST} L${CREST_R} ${CREST} L${DOWN_TOE} ${GROUND} L320 ${GROUND} L320 180 Z`}
        className="fill-jaga-line"
        opacity="0.55"
      />

      {/* The reservoir, from the floor up to the storage the dam has published. */}
      {!dry && (
        <g clipPath="url(#jaga-dam-basin)">
          <rect x="0" y={water} width={UP_TOE} height={BED - water} fill="url(#jaga-dam-water)" />
          {/* Two slow sheets of light on the surface, so the water is never quite still. */}
          <g className={f.still ? undefined : styles.ripple}>
            <rect
              x="-12"
              y={water + 4}
              width={UP_TOE + 24}
              height="1.5"
              className="fill-current"
              opacity="0.3"
            />
          </g>
          <g className={f.still ? undefined : styles.rippleSlow}>
            <rect
              x="-12"
              y={water + 11}
              width={UP_TOE + 24}
              height="1.1"
              className="fill-current"
              opacity="0.2"
            />
          </g>
          <rect x="0" y={water - 1.3} width={UP_TOE} height="2.6" className="fill-current" />
        </g>
      )}

      {/* The line the operator works to, drawn across the open water only. */}
      {normal !== null && (
        <line
          x1={bankX(normal) + 2}
          x2={faceX(normal) - 1}
          y1={normal}
          y2={normal}
          className="stroke-jaga-text-2"
          strokeWidth="1.2"
          strokeDasharray="5 4"
        />
      )}

      {/* The intake tower, standing in the water, with its walkway to the crest. */}
      <path
        d={`M${TOWER_X + 9} 68 L${CREST_L + 2} ${CREST + 3}`}
        className="stroke-jaga-edge"
        strokeWidth="1.6"
        fill="none"
        opacity="0.9"
      />
      <rect x={TOWER_X} y="70" width="9" height={BED - 70} className="fill-jaga-edge" />
      <rect
        x={TOWER_X - 2.5}
        y="64"
        width="14"
        height="7"
        rx="1.5"
        className="fill-jaga-ink"
        opacity="0.75"
      />

      {/* The embankment: rockfill, with its clay core and the road along the crest. */}
      <path
        d={`M${UP_TOE} ${BED} L${CREST_L} ${CREST} L${CREST_R} ${CREST} L${DOWN_TOE} ${GROUND} Z`}
        fill="url(#jaga-dam-fill)"
      />
      {/* The clay core, and the berm that steps the downstream shoulder. */}
      <path
        d={`M190 ${BED} L202 ${CREST + 2} L210 ${CREST + 2} L222 ${BED} Z`}
        className="fill-jaga-ink"
        opacity="0.25"
      />
      <path
        d={`M214 104 L${DOWN_TOE - 22} 104 L${DOWN_TOE - 16} 110 L214 110 Z`}
        className="fill-jaga-ground"
        opacity="0.22"
      />
      <rect
        x={CREST_L - 3}
        y={CREST - 3.5}
        width={CREST_R - CREST_L + 6}
        height="4"
        rx="1.2"
        className="fill-jaga-ink"
        opacity="0.6"
      />
      {[0, 1, 2, 3, 4].map((i) => (
        <line
          key={i}
          x1={CREST_L - 1 + i * 9}
          y1={CREST - 4}
          x2={CREST_L - 1 + i * 9}
          y2={CREST - 8}
          className="stroke-jaga-ink"
          strokeWidth="1"
          opacity="0.45"
        />
      ))}
      <line
        x1={CREST_L - 2}
        y1={CREST - 8}
        x2={CREST_R + 2}
        y2={CREST - 8}
        className="stroke-jaga-ink"
        strokeWidth="1"
        opacity="0.45"
      />
      {/* The benches cut across the face the water works at, as a built slope really has. */}
      {[0, 1].map((i) => {
        const y = BED - 34 - i * 34;
        return (
          <line
            key={i}
            x1={faceX(y) + 1}
            y1={y}
            x2={faceX(y) + 13 + i * 4}
            y2={y - 1.5}
            className="stroke-jaga-ground"
            strokeWidth="1.3"
            opacity="0.3"
          />
        );
      })}

      {/* The spillway: a gate cut into the crest, and the concrete chute it pours down. */}
      <path
        d={`M${NOTCH_R} ${NOTCH_Y} L${DOWN_TOE - 1} ${GROUND - 2} L${DOWN_TOE - 9} ${GROUND - 1} L${NOTCH_R - 9} ${NOTCH_Y + 1} Z`}
        className="fill-jaga-ground"
        opacity="0.75"
      />
      <rect
        x={NOTCH_L}
        y={NOTCH_Y - 1}
        width={NOTCH_R - NOTCH_L}
        height="3"
        className="fill-jaga-ground"
      />
      {f.spilling && (
        <g className={styles.sheet}>
          <path
            d={`M${NOTCH_L + 1} ${NOTCH_Y - 4} L${NOTCH_R} ${NOTCH_Y - 4} L${DOWN_TOE - 2} ${GROUND - 3} L${DOWN_TOE - 8} ${GROUND - 2} Z`}
            className="fill-current"
            opacity="0.8"
          />
        </g>
      )}
      <rect
        x={NOTCH_L}
        y={gateY}
        width={NOTCH_R - NOTCH_L}
        height="13"
        rx="1.5"
        className={`fill-jaga-ink ${styles.gate}`}
        opacity="0.85"
      />

      {/*
       * The powerhouse, on the bank beside the tailrace. It stands clear of the chute on purpose:
       * the two ways water leaves a dam must never be drawn on top of one another.
       */}
      <rect x="282" y="114" width="26" height="28" rx="1.5" className="fill-jaga-edge" />
      <rect
        x="279"
        y="109"
        width="32"
        height="6"
        rx="1.5"
        className="fill-jaga-ink"
        opacity="0.6"
      />
      <rect x="287" y="120" width="7" height="7" className="fill-jaga-ground" opacity="0.85" />
      <rect x="298" y="120" width="7" height="7" className="fill-jaga-ground" opacity="0.85" />

      {/* The tailwater, and the jet the turbines send into it. */}
      <rect
        x={TAIL_X}
        y={tail}
        width={320 - TAIL_X}
        height={180 - tail}
        fill="url(#jaga-dam-tail)"
        opacity={dry ? 0.5 : 1}
      />
      {!dry && (
        <rect
          x={TAIL_X}
          y={tail - 1.2}
          width={320 - TAIL_X}
          height="2.4"
          className="fill-current"
          opacity="0.85"
        />
      )}
      {/* The outlet the turbines discharge through, under the building. */}
      <rect
        x="262"
        y="140"
        width="10"
        height="9"
        rx="1.5"
        className="fill-jaga-ink"
        opacity="0.75"
      />
      {running && (
        <>
          {/* A standing stub, so water is always seen leaving while the jet itself runs out. */}
          <path
            d="M271 141 L286 142.5 L286 148 L271 148 Z"
            className="fill-current"
            opacity="0.6"
          />
          <g className={styles.jet}>
            <path
              d="M271 141 L298 143 L298 149 L271 148 Z"
              className="fill-current"
              opacity="0.9"
            />
          </g>
          {[0, 1, 2].map((i) => (
            <circle
              key={i}
              cx={284 + i * 9}
              cy={142}
              r={2 - i * 0.4}
              className={`fill-current ${styles.spray}`}
              style={{ animationDelay: `${i * 0.3}s` }}
            />
          ))}
        </>
      )}
    </svg>
  );
}

/** The figures themselves, written over the drawing where the thing they measure is. */
export function DamSectionLabels({ f }: { f: DamFigure }) {
  const t = useTranslations("dam");
  const format = useFormatter();
  const n = (value: number, digits = 0) => format.number(value, { maximumFractionDigits: digits });
  const cms = (value: number) => n(value, value < 10 ? 1 : 0);
  const water = waterTop(f.fullness ?? 0);
  const normal = f.normalMark === null ? null : waterTop(f.normalMark);
  /*
   * The reading about the water rides with the water: inside it when the reservoir is deep enough
   * to hold the words, above the surface when it is not. Either way it stays clear of the dam.
   */
  const deep = (f.fullness ?? 0) > 0.45;
  const readingTop = deep ? water + 5 : Math.max(44, water - 48);
  return (
    <div className="pointer-events-none absolute inset-0 text-jaga-text">
      {f.inflowCms !== null && (
        <Tag x={7} y={7}>
          <Reading
            label={`${t("figure.tag.inflow")} →`}
            value={cms(f.inflowCms)}
            unit={t("figure.unit.cms")}
          />
        </Tag>
      )}
      {f.outflowCms !== null && (
        <Tag x={313} y={7} align="end">
          <Reading
            label={`${t("figure.tag.outflow")} →`}
            value={cms(f.outflowCms)}
            unit={t("figure.unit.cms")}
          />
        </Tag>
      )}
      {f.spilling && f.spilledCms !== null && (
        <Tag x={313} y={44} align="end">
          <p className="rounded-full bg-jaga-ground/85 px-1.5 text-[13px] leading-tight font-medium whitespace-nowrap">
            {t("figure.tag.spill")} {cms(f.spilledCms)}
          </p>
        </Tag>
      )}
      {normal !== null && (
        <Tag x={7} y={normal - 14}>
          <p className={`${PLATE} text-[13px] leading-tight whitespace-nowrap text-jaga-text-2`}>
            {t("figure.tag.normal")}
          </p>
        </Tag>
      )}
      {f.fullness !== null && (
        <Tag x={9} y={readingTop}>
          <p className={`${PLATE} leading-none`}>
            <span className="text-[26px] font-bold tabular-nums">{n(f.percentFull ?? 0)}%</span>{" "}
            <span className="text-[13px] text-jaga-text-2">{t("figure.tag.ofCapacity")}</span>
          </p>
          {f.storageMcm !== null && (
            <p className={`${PLATE} mt-0.5 text-[13px] leading-snug tabular-nums`}>
              {n(f.storageMcm, f.storageMcm < 10 ? 1 : 0)}{" "}
              <span className="text-[13px] text-jaga-text-2">{t("figure.unit.mcm")}</span>
            </p>
          )}
          {f.levelM !== null && (
            <p className={`${PLATE} text-[13px] leading-snug tabular-nums`}>
              {t("figure.tag.level")} {n(f.levelM, 2)}{" "}
              <span className="text-[13px] text-jaga-text-2">{t("figure.unit.m")}</span>
            </p>
          )}
        </Tag>
      )}
      {f.fullness === null && (
        <Tag x={9} y={100}>
          <p className={`${PLATE} text-[13px] leading-snug text-jaga-text-2`}>
            {t("figure.tag.noStorage")}
          </p>
        </Tag>
      )}
    </div>
  );
}
