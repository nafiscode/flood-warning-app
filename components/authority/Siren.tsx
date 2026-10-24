"use client";

import { useTranslations } from "next-intl";
import styles from "./Siren.module.css";

/**
 * The war room's siren (the owner, 24 Oct 2026: "grey and not moving when nothing happen, but
 * when there are people request came should show red and blue with rotating, realistic").
 *
 * It is a picture of one fact the page already says in words - how many requests are ringing for
 * the team - so it decides nothing and a reader who cannot see it loses nothing: the label is the
 * same sentence the alarm line carries. Red and blue are the rescuer's lamp, not a level.
 */
export function Siren({ ringing }: { ringing: number }) {
  const t = useTranslations("authority");
  const on = ringing > 0;
  return (
    <span
      role="img"
      data-siren={on ? "on" : "idle"}
      aria-label={on ? t("alarm.ringing", { count: ringing }) : t("war.siren.idle")}
      className={`${styles.siren} ${on ? styles.on : styles.idle}`}
    >
      <span className={styles.glow} aria-hidden="true" />
      <span className={styles.dome} aria-hidden="true">
        <span className={styles.rotor} />
        <span className={styles.gloss} />
      </span>
      <span className={styles.base} aria-hidden="true" />
    </span>
  );
}
