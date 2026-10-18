import styles from "./SatelliteFlyby.module.css";

export function SatelliteFlyby() {
  return (
    <div className={styles.track} aria-hidden="true">
      <svg className={styles.earth} viewBox="0 0 320 44" preserveAspectRatio="none">
        <path d="M0 40 Q160 26 320 40" />
      </svg>
      <svg className={styles.satellite} viewBox="0 0 88 44">
        <path className={styles.scan} d="M42 23h4l11 17H31z" />
        <g className={styles.panels}>
          <rect x="2" y="14" width="27" height="12" rx="1.5" />
          <path d="M11 14v12m9-12v12M2 20h27" />
          <rect x="59" y="14" width="27" height="12" rx="1.5" />
          <path d="M68 14v12m9-12v12m-18-6h27" />
        </g>
        <path className={styles.arm} d="M29 20h10m10 0h10" />
        <rect className={styles.body} x="39" y="14" width="10" height="12" rx="2" />
        <path className={styles.antenna} d="M44 14V9m-4 0h8" />
        <path className={styles.sensor} d="M42 26v4h4v-4" />
        <circle className={styles.lens} cx="44" cy="32" r="2.4" />
      </svg>
    </div>
  );
}
