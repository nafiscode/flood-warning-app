/* eslint-disable @next/next/no-img-element -- one small static file, sized in the markup */
import { useTranslations } from "next-intl";
import { initialsOf, PORTRAIT } from "@/lib/about";
import styles from "./Portrait.module.css";

/**
 * The founder's portrait on "Who built Jaga". A face is what makes the page land for the reader
 * who knows the owner personally, so there is a slot for one - but the page has to be complete
 * before the file exists, and it has to stay cheap on a slow connection.
 *
 * `show` is false until a compressed portrait sits at `public/about/<PORTRAIT>` (the repo's own
 * limit: longest side 1600 px or less, quality about 0.7). Until then the slot draws the initials
 * in the brand colours, the way a credits card does for an organisation with no logo. The box is
 * the same size either way, so nothing moves when the photo arrives.
 *
 * The treatment that makes a formal photo read as relaxed lives in Portrait.module.css; `cut`
 * switches it off for a portrait that has been properly cut out and carries real transparency.
 */
export function Portrait({ show = false, cut = false }: { show?: boolean; cut?: boolean }) {
  const t = useTranslations("about");
  return (
    <span
      data-about-portrait={show ? "photo" : "initials"}
      className={`${styles.slot} ${cut ? styles.cut : ""}`}
    >
      {show ? (
        <>
          <img
            src={`/about/${PORTRAIT}`}
            alt={t("portraitAlt")}
            width={304}
            height={304}
            decoding="async"
            className={styles.photo}
          />
          <span aria-hidden="true" className={styles.wash} />
        </>
      ) : (
        <span aria-hidden="true" className={styles.initials} data-about-initials>
          {initialsOf(t("name"))}
        </span>
      )}
    </span>
  );
}
