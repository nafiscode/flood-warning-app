import { HOUSE } from "@/lib/place-icons";
import type { MapFocus } from "@/lib/map-focus";
import styles from "./FeatureIcon.module.css";

/**
 * A small picture of each of the map's five features, drawn the way the map draws it: the risk
 * pinks, the safe-place square, the hatched land below the dam, a river gauge's glass of water and
 * the dam's wall. Decorative; the words beside it say what it is. Light enough for the home screen
 * (no map library). The risk pinks are never the alert colours (lib/hazard-layer.ts).
 */
export function FeatureIcon({ feature, size = 32 }: { feature: MapFocus; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className="shrink-0"
      data-feature-icon={feature}
    >
      {feature === "risk" && (
        <>
          <rect x="3" y="3" width="26" height="26" rx="6" className={styles.risk1} />
          <path
            d="M3 18 Q10 12 16 17 T29 14 V23 a6 6 0 0 1 -6 6 H9 a6 6 0 0 1 -6 -6 Z"
            className={styles.risk2}
          />
          <path
            d="M3 24 Q11 19 17 23 T29 21 V23 a6 6 0 0 1 -6 6 H9 a6 6 0 0 1 -6 -6 Z"
            className={styles.risk3}
          />
        </>
      )}
      {feature === "places" && (
        <>
          <rect x="3" y="3" width="26" height="26" rx="6" className="fill-jaga-slate" />
          <polygon
            points={HOUSE.map(([x, y]) => `${3 + x * 26},${3 + y * 26}`).join(" ")}
            className="fill-white"
          />
        </>
      )}
      {feature === "damzone" && (
        <>
          <defs>
            <clipPath id="feature-zone-clip">
              <rect x="3" y="3" width="26" height="26" rx="6" />
            </clipPath>
          </defs>
          <rect
            x="3"
            y="3"
            width="26"
            height="26"
            rx="6"
            className={`fill-none ${styles.waterLine}`}
            strokeWidth="2.5"
          />
          <g clipPath="url(#feature-zone-clip)" className={styles.waterLine} strokeWidth="2.2">
            {[-8, -1, 6, 13, 20, 27].map((x) => (
              <line key={x} x1={x} y1="32" x2={x + 16} y2="0" />
            ))}
          </g>
        </>
      )}
      {feature === "gauges" && (
        <>
          <rect
            x="9"
            y="3"
            width="14"
            height="26"
            rx="4"
            className="fill-none stroke-jaga-ink"
            strokeWidth="2.2"
          />
          <path
            d="M10.5 15 Q13 13 16 15 T21.5 15 V25 a2.5 2.5 0 0 1 -2.5 2.5 H13 a2.5 2.5 0 0 1 -2.5 -2.5 Z"
            className={styles.water}
          />
          <circle cx="27" cy="6" r="3.2" className={`${styles.water} ${styles.live}`} />
        </>
      )}
      {feature === "dam" && (
        <>
          <path d="M3 9 H14 V29 H3 Z" className={styles.water} />
          <path d="M14 5 L20 5 L24 29 L14 29 Z" className="fill-jaga-ink" />
          <path d="M24 22 Q27 20 30 22 V29 H24 Z" className={styles.water} opacity="0.6" />
          <circle cx="27" cy="6" r="3.2" className={`${styles.water} ${styles.live}`} />
        </>
      )}
    </svg>
  );
}
