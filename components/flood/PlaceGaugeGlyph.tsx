import { GAUGE_FILL, type GaugeLook } from "@/lib/gauge-marks";
import styles from "@/components/map/GaugeGlyph.module.css";

/**
 * A river gauge as the map draws it - a glass with water in it, rippling near and over the bank -
 * coloured from the page's own variables, so it turns with the sunset theme on its own. (The map's
 * `GaugeGlyph` takes a `dark` flag; a server-drawn page cannot know the time of day.)
 *
 * Water colour only, never an alert colour: a gauge is a measurement (safety rule 2). Decorative:
 * the words beside it say what it means.
 */
export function PlaceGaugeGlyph({
  look,
  uid,
  size = 44,
}: {
  look: GaugeLook;
  uid: string;
  size?: number;
}) {
  const r = 7;
  const fill = GAUGE_FILL[look];
  const surface = 14 + r - fill * 2 * r;
  const ripple = look === "over" || look === "near";
  const water = "var(--jaga-dam)";
  const muted = "var(--jaga-text-2)";
  const id = `place-gauge-${uid}`;
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
            style={{ stroke: water }}
            strokeWidth={look === "over" ? 2 : 1.5}
            className={`${styles.ripple} ${look === "over" ? styles.quick : ""} ${extra}`}
          />
        ))}
      <circle cx="14" cy="14" r={r + 2.5} style={{ fill: "var(--jaga-surface)" }} opacity={0.85} />
      <circle cx="14" cy="14" r={r} style={{ fill: "var(--jaga-surface)" }} />
      {fill > 0 && (
        <g clipPath={`url(#${id})`}>
          <path
            className={look === "quiet" ? undefined : styles.wave}
            style={{ fill: look === "nolevels" ? muted : water }}
            d={`M2 28 L2 ${surface} Q6 ${surface - 1.4} 10 ${surface} T18 ${surface} T26 ${surface} T34 ${surface} L34 28 Z`}
          />
        </g>
      )}
      <circle
        cx="14"
        cy="14"
        r={r}
        fill="none"
        style={{ stroke: look === "quiet" || look === "nolevels" ? muted : "var(--jaga-ink)" }}
        strokeWidth={look === "over" ? 1.8 : 1.4}
        strokeDasharray={look === "quiet" ? "1.8 1.4" : undefined}
      />
    </svg>
  );
}
