import styles from "./SatelliteFlyby.module.css";

/**
 * The strip of "live downlink" across the head of the laptop console (the owner, 19 Oct 2026:
 * it should "feel like they are seeing something live projected from satellite data").
 *
 * It is decoration, and it is deliberately the only decoration on this page that says nothing:
 * no figures, no times, no station names, nothing that could be read as a measurement. Jaga's
 * own satellite work has its own layer and its own card, with dates and a source; a strip that
 * invented numbers to look technical would be the opposite of what this app owes a reader
 * (safety rule 8). What moves here is a craft, the swath its sensor sees, the ground it has
 * covered, and the pass being downlinked as it goes over the station.
 *
 * Drawn only on the console - a phone pays nothing for it - and animated with transforms,
 * opacity and one dash offset, so it costs the compositor and not the layout. Asked for less
 * motion, the scene holds still at the moment it is all built towards.
 */
export function SatelliteFlyby() {
  return (
    <div className={styles.panel} data-flyby="true" aria-hidden="true">
      {/* The graticule, drifting the way the ground does under an orbit. */}
      <div className={styles.field} />
      <div className={styles.stars} />

      {/*
       * The ground: its curve, the air on it, and the part of the track already covered - one
       * path, so what is covered lies exactly on the horizon rather than near it. Stretched to
       * whatever width the head row leaves, with the strokes held at their own weight.
       */}
      <svg className={styles.ground} viewBox="0 0 400 44" preserveAspectRatio="none">
        <defs>
          <linearGradient id="jaga-earth" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1b4e6d" />
            <stop offset="55%" stopColor="#0d2a3c" />
            <stop offset="100%" stopColor="#07171f" />
          </linearGradient>
        </defs>
        <path className={styles.earth} d="M-20 36Q200 27 420 36V44H-20Z" fill="url(#jaga-earth)" />
        <path
          className={styles.horizon}
          d="M-20 36Q200 27 420 36"
          vectorEffect="non-scaling-stroke"
        />
        <path
          className={styles.covered}
          d="M-20 36Q200 27 420 36"
          pathLength={100}
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* Weather over the ground, moving at its own pace: the thing this craft is up there for. */}
      <div className={styles.clouds} />
      <div className={`${styles.clouds} ${styles.cloudsFar}`} />

      {/* The orbit it is on, drawn as the ephemeris of a pass and not as a road. */}
      <div className={styles.orbit} />

      <div className={styles.station}>
        <svg viewBox="0 0 14 14" className={styles.dish}>
          <path d="M1 13h12M7 13V8.5" />
          <path d="M2.8 8a4.2 4.2 0 0 1 8.4 0z" />
        </svg>
        <span className={styles.beam} />
      </div>

      {/*
       * The craft rides a full-width carriage, because a percentage in a transform is a share of
       * the element being moved and not of what it is moving across: the craft on its own crossed
       * about half the strip, and the station was fed while it was still on its way (caught by
       * measuring where it was, 19 Oct).
       */}
      <div className={styles.flight}>
        <svg className={styles.craft} viewBox="0 0 120 44">
        <defs>
          <linearGradient id="jaga-swath" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.45" />
            <stop offset="72%" stopColor="currentColor" stopOpacity="0.12" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className={styles.look}>
          {/* What the sensor has in view: a swath, and its footprint on the ground. */}
          <path className={styles.swath} d="M58 21h4l19 15H39z" fill="url(#jaga-swath)" />
          <path className={styles.swathEdge} d="M58 21 39 36M62 21l19 15" />
          <ellipse className={styles.footprint} cx="60" cy="35.5" rx="13" ry="1.8" />
        </g>
        <g className={styles.wings}>
          <rect x="29" y="13" width="21" height="5.6" rx="0.5" />
          <path d="M34 13v5.6m5-5.6v5.6m5-5.6v5.6M29 15.8h21" />
          <rect x="70" y="13" width="21" height="5.6" rx="0.5" />
          <path d="M75 13v5.6m5-5.6v5.6m5-5.6v5.6M70 15.8h21" />
        </g>
        <path className={styles.boom} d="M50 15.8h4m12 0h4" />
        <path className={styles.sar} d="M48 20h24l-1.6 2.4H49.6z" />
        <rect className={styles.bus} x="54" y="11.6" width="12" height="8.4" rx="1.2" />
        <path className={styles.mast} d="M60 11.6V8" />
          <circle className={styles.beacon} cx="60" cy="7" r="1.3" />
        </svg>
      </div>

      {/* A screen that is being fed refreshes; this is that, and nothing more. */}
      <div className={styles.sweep} />
      <div className={styles.scanlines} />
    </div>
  );
}
