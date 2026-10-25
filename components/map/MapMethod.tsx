"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

const POINTS = [
  "radar",
  "height",
  "towns",
  "checked",
  "gistda",
  "damzone",
  "live",
  "places",
  "sea",
  "gate",
  "weather",
  "names",
] as const;

/**
 * How the Flood Risk Map was made, in plain words (the owner, 15 Oct: the science behind it should
 * be seen, and it is what earns the map trust). Closed until asked for, so it costs a first visit
 * nothing; the line under its title says the two things that matter most. It ends with the limits
 * (safety rules 8 and 10) and the sources the data comes from.
 */
export function MapMethod() {
  const t = useTranslations("mapMethod");
  return (
    <details
      data-map-method="true"
      className="group rounded-xl border-2 border-jaga-line bg-jaga-surface px-4"
    >
      <summary className="flex min-h-tap cursor-pointer list-none items-center justify-between gap-3 py-2">
        <span className="flex flex-col">
          <span className="font-bold text-jaga-ink">{t("title")}</span>
          <span className="text-small text-jaga-text-2">{t("teaser")}</span>
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 text-jaga-ink transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="flex flex-col gap-3 pb-4">
        <ul className="flex flex-col gap-2">
          {POINTS.map((p) => (
            <li key={p} className="border-s-4 border-jaga-teal-ink ps-3" data-method-point={p}>
              <p className="font-bold text-jaga-ink">{t(`${p}.lead`)}</p>
              <p className="text-small">{t(`${p}.text`)}</p>
            </li>
          ))}
        </ul>
        <p className="rounded-lg bg-jaga-ground p-3 text-small">{t("limits")}</p>
        <p className="text-small text-jaga-text-2">{t("credits")}</p>
        {/* The whole method, for anyone who wants it in full (the owner, 16 Oct): phase A18. */}
        <p>
          <Link
            href="/how-it-works"
            prefetch={false}
            data-method-more
            className="inline-flex min-h-tap items-center font-medium text-jaga-ink underline"
          >
            {t("more")}
          </Link>
        </p>
      </div>
    </details>
  );
}
