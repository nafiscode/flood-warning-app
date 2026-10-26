"use client";

import { useTranslations } from "next-intl";
import styles from "./Siren.module.css";

/**
 * The war room's siren (the owner, 24 Oct 2026: "grey and not moving when nothing happen, but
 * when there are people request came should show red and blue with rotating, realistic"; and on
 * 27 Oct: a food-and-water board lights it too, in yellow, and the lamps turn horizontally).
 *
 * It is a picture of one fact the page already says in words - how many requests are waiting for
 * the team - so it decides nothing and a reader who cannot see it loses nothing: the label is the
 * same sentence the header carries. A rescue request wins over a request for food and water when
 * both wait. The lamp colours are the lamp's, not a level.
 */
export function Siren({ ringing, supplies = 0 }: { ringing: number; supplies?: number }) {
  const t = useTranslations("authority");
  const tone = ringing > 0 ? "on" : supplies > 0 ? "supplies" : "idle";
  const lit = tone !== "idle";
  const label =
    tone === "on"
      ? t("alarm.ringing", { count: ringing })
      : tone === "supplies"
        ? t("war.suppliesOffered", { count: supplies })
        : t("war.siren.idle");
  return (
    <span
      role="img"
      data-siren={tone}
      aria-label={label}
      className={`${styles.siren} ${lit ? styles.on : styles.idle} ${
        tone === "supplies" ? styles.supplies : ""
      }`}
    >
      <span className={styles.glow} aria-hidden="true">
        <span className={`${styles.halo} ${styles.haloA}`} />
        <span className={`${styles.halo} ${styles.haloB}`} />
      </span>
      <span className={styles.dome} aria-hidden="true">
        <span className={styles.rotor}>
          <span className={`${styles.lamp} ${styles.lampA}`} />
          <span className={`${styles.lamp} ${styles.lampB}`} />
        </span>
        <span className={styles.gloss} />
      </span>
      <span className={styles.base} aria-hidden="true" />
    </span>
  );
}
