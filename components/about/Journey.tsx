import { useTranslations } from "next-intl";
import { SECTORS } from "@/lib/about";
import { ABOUT_ICONS } from "./icons";
import styles from "./Journey.module.css";

/**
 * "Journey across industries" (the owner, 20 Oct 2026), taken from their own portfolio and made
 * to move: water infrastructure and energy, then defence and space, then aviation and airports.
 *
 * It goes above the career cards because it is the whole shape in one line. The cards below then
 * say what each move actually produced, so a reader meets the argument twice: once as a picture,
 * once as a record.
 *
 * The movement is a signal reaching three stations in turn, and it is decoration only - the list
 * reads exactly the same when it is still, which is what a reader who has asked for less motion
 * gets (Journey.module.css). An icon per industry, as asked.
 */
export function Journey() {
  const t = useTranslations("about.journey");
  return (
    <section className="flex flex-col gap-4" aria-labelledby="about-journey" id="journey">
      <h2 id="about-journey" className="text-h3 font-bold text-jaga-ink">
        {t("title")}
      </h2>
      <p className="text-jaga-text">{t("lead")}</p>

      <div className={styles.board} data-about-journey>
        <div className={styles.head}>
          <p className={styles.line}>
            {SECTORS.map((sector, i) => (
              <span key={sector.key} className="contents">
                {i > 0 && (
                  <span aria-hidden="true" className={styles.arrow}>
                    &rarr;
                  </span>
                )}
                <span>{t(`sectors.${sector.key}.short`)}</span>
              </span>
            ))}
          </p>
        </div>

        <ol className={styles.track}>
          {SECTORS.map((sector) => (
            <li key={sector.key} className={styles.station} data-about-sector={sector.key}>
              {/* The leg of track arriving here; the first station has nothing before it. */}
              <span aria-hidden="true" className={styles.leg} />
              <span className={styles.badge}>{ABOUT_ICONS[sector.icon](24)}</span>
              <span className={styles.years}>{t(`sectors.${sector.key}.years`)}</span>
              <span className={styles.name}>{t(`sectors.${sector.key}.name`)}</span>
              <span className={styles.tag}>{t(`sectors.${sector.key}.tag`)}</span>
            </li>
          ))}
        </ol>

        <p className={styles.foot}>{t("note")}</p>
      </div>

      <p className="text-jaga-text">{t("andJaga")}</p>
    </section>
  );
}
