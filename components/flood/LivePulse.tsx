import styles from "./FloodPlace.module.css";

/**
 * The teal "live" pulse, beside a figure that is current. Teal and never an alert colour: it says
 * "this reading is recent", not what the reading means (safety rule 2, docs/brand.md). The caller
 * shows it only for a current reading; a dot on a stopped feed would say "live" about nothing.
 */
export function LivePulse({ size = 12 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 12 12"
      className="shrink-0 overflow-visible"
      data-live-pulse="true"
    >
      <circle cx="6" cy="6" r="6" className={`fill-jaga-teal-ink ${styles.ring}`} />
      <circle cx="6" cy="6" r="4" className={`fill-jaga-teal-ink ${styles.beat}`} />
    </svg>
  );
}
