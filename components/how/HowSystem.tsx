import { useTranslations } from "next-intl";
import { CheckIcon, ForwardIcon, MapIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { SYSTEM_PARTS, type SystemPart } from "@/lib/how-it-works";
import { buttonSecondary } from "@/lib/ui";
import { FIGURES } from "./Figures";
import { HowNav } from "./HowNav";
import { HOW_ICONS } from "./icons";

/** The numbers the system can be judged by: how much is written down and checked. */
const STATS = ["tables", "migrations", "tests", "languages"] as const;

/**
 * "How Jaga works: the system" (A18). The app as a concept: five parts, the rules that live in
 * the database rather than in the screens, how a request for help travels, how an alert is
 * published and why only people publish them, and what happens when parts fail.
 *
 * **No vendor, product or brand name appears on this page**, and a test holds it to that in all
 * three languages (`FORBIDDEN_VENDOR_WORDS`). Two reasons, both stated on the page: a reader
 * should learn the shape of the thing, not our shopping list, and a public page naming every
 * service we depend on is a map for anyone looking for a way in.
 */
export function HowSystem() {
  const t = useTranslations("howItWorks.system");
  return (
    <div className="flex flex-col gap-8" data-how="system">
      <HowNav current="system" />

      <section className="flex flex-col gap-4 rounded-3xl bg-jaga-slate px-5 py-7 text-white lg:px-10 lg:py-10">
        <h1 className="text-h2 font-bold leading-tight lg:text-h1">{t("title")}</h1>
        <p className="text-body text-white/90">{t("lead")}</p>
        <p className="text-small text-white/80">{t("noNames")}</p>
        <ul className="flex flex-wrap gap-2" data-how-stats>
          {STATS.map((key) => (
            <li
              key={key}
              className="rounded-full bg-white/10 px-3 py-1 text-small font-medium ring-1 ring-white/20"
            >
              {t(`stats.${key}`)}
            </li>
          ))}
        </ul>
      </section>

      <nav aria-labelledby="sys-contents" className="flex flex-col gap-3">
        <h2 id="sys-contents" className="text-h3 font-bold text-jaga-ink">
          {t("contents")}
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {SYSTEM_PARTS.map((part, i) => (
            <li key={part.key}>
              <a
                href={`#sys-${part.key}`}
                className="flex min-h-tap items-center gap-3 rounded-xl border border-jaga-line bg-jaga-surface px-3 py-2 hover:border-jaga-teal-ink"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-jaga-ground text-small font-bold text-jaga-ink">
                  {i + 1}
                </span>
                <span className="font-medium text-jaga-ink">{t(`parts.${part.key}.title`)}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-6">
        {SYSTEM_PARTS.map((part, i) => (
          <SystemCard key={part.key} part={part} n={i + 1} />
        ))}
      </div>

      <section className="flex flex-col gap-4 rounded-3xl border border-jaga-line bg-jaga-surface p-5 lg:p-8">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("closing.title")}</h2>
        <p className="text-jaga-text">{t("closing.text")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Link href="/how-it-works" prefetch={false} className={buttonSecondary}>
            <ForwardIcon size={22} className="rtl:-scale-x-100" />
            {t("closing.science")}
          </Link>
          <Link href="/map" prefetch={false} className={buttonSecondary}>
            <MapIcon size={22} />
            {t("closing.map")}
          </Link>
        </div>
      </section>
    </div>
  );
}

function SystemCard({ part, n }: { part: SystemPart; n: number }) {
  const t = useTranslations("howItWorks.system");
  const Figure = part.figure ? FIGURES[part.figure] : null;
  const points = Array.from({ length: part.points }, (_, i) =>
    t(`parts.${part.key}.points.${i + 1}`),
  );
  return (
    <article
      id={`sys-${part.key}`}
      data-how-part={part.key}
      className="flex scroll-mt-28 flex-col gap-4 rounded-3xl border border-jaga-line bg-jaga-surface p-5 lg:p-7"
    >
      <h2 className="flex items-start gap-3 text-h3 font-bold leading-snug text-jaga-ink">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-jaga-ground text-jaga-teal-ink">
          {HOW_ICONS[part.icon](22)}
        </span>
        <span>
          <span className="text-small font-medium text-jaga-text-2">{n}. </span>
          {t(`parts.${part.key}.title`)}
        </span>
      </h2>

      <p className="text-jaga-text">{t(`parts.${part.key}.text`)}</p>

      {Figure && <Figure />}

      <ul className="flex flex-col gap-2">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-2 text-jaga-text">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-jaga-teal-ink text-jaga-surface">
              <CheckIcon size={14} />
            </span>
            {point}
          </li>
        ))}
      </ul>
    </article>
  );
}
