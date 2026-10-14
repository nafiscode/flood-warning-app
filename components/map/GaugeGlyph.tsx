import { GAUGE_FILL, gaugePaint, type GaugeLook } from "@/lib/gauge-marks";
import styles from "./GaugeGlyph.module.css";

/**
 * A gauge as the map draws it, for the legend: the same glass, water and ripples, in SVG so it
 * needs no map. Decorative: the words beside it say what it means.
 */
export function GaugeGlyph({
  look,
  dark,
  size = 28,
}: {
  look: GaugeLook;
  dark: boolean;
  size?: number;
}) {
  const p = gaugePaint(dark);
  const r = 7;
  const fill = GAUGE_FILL[look];
  const surface = 14 + r - fill * 2 * r;
  const ripple = look === "over" || look === "near";
  const id = `gauge-clip-${look}-${dark ? "n" : "d"}`;
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 28 28"
      className="shrink-0 overflow-visible"
      data-gauge-glyph={look}
    >
      <defs>
        <clipPath id={id}>
          <circle cx="14" cy="14" r={r - 0.8} />
        </clipPath>
      </defs>
      {ripple &&
        (look === "over" ? ["", styles.late] : [""]).map((extra) => (
          <circle
            key={extra || "first"}
            cx="14"
            cy="14"
            r={r}
            fill="none"
            stroke={p.water}
            strokeWidth={look === "over" ? 2 : 1.5}
            className={`${styles.ripple} ${look === "over" ? styles.quick : ""} ${extra}`}
          />
        ))}
      <circle cx="14" cy="14" r={r + 2.5} fill={p.halo} opacity={0.85} />
      <circle cx="14" cy="14" r={r} fill={p.glass} />
      {fill > 0 && (
        <g clipPath={`url(#${id})`}>
          <path
            className={look === "quiet" ? undefined : styles.wave}
            fill={look === "nolevels" ? p.muted : p.water}
            d={`M2 28 L2 ${surface} Q6 ${surface - 1.4} 10 ${surface} T18 ${surface} T26 ${surface} T34 ${surface} L34 28 Z`}
          />
        </g>
      )}
      <circle
        cx="14"
        cy="14"
        r={r}
        fill="none"
        stroke={look === "quiet" || look === "nolevels" ? p.muted : p.rim}
        strokeWidth={look === "over" ? 1.8 : 1.4}
        strokeDasharray={look === "quiet" ? "1.8 1.4" : undefined}
      />
    </svg>
  );
}

/** The small beating dot beside "Live". */
export function LiveDot({ dark }: { dark: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-2.5 shrink-0 rounded-full ${styles.live}`}
      style={{ backgroundColor: gaugePaint(dark).water }}
    />
  );
}
