import { useTranslations } from "next-intl";
import { CheckIcon, TriangleIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { buttonPrimary, card, hint } from "@/lib/ui";

const RULES = ["one", "two", "three", "four"] as const;
const WILL = ["one", "two", "three", "four", "five"] as const;

/**
 * The public impact page while there is nothing real to report (spec section 16, owner 24 Oct).
 *
 * It carries no figure at all - not a zero, not an example - because a zero reads as "nothing
 * happened" and an invented count is a claim about rescues that never took place. It says what
 * the page will hold and the honesty rules it will keep, so the promise is public before the
 * numbers are. The made-up season stays on /dev/impact, which production cannot open.
 *
 * It points to SOS and the hotlines, never the other way round: nothing in an SOS, report or alert
 * flow links here (spec section 16).
 */
export function ImpactSoon() {
  const t = useTranslations("impactPublic");
  return (
    <div className="flex flex-col gap-7" data-impact-soon>
      <header className="flex flex-col gap-2">
        <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
        <p className="max-w-prose font-medium">{t("lead")}</p>
      </header>

      <section
        className="flex gap-3 rounded-2xl border-2 border-jaga-edge bg-jaga-surface px-4 py-3"
        aria-labelledby="impact-status"
      >
        <TriangleIcon size={24} className="mt-1 shrink-0 text-jaga-ink" />
        <div className="flex flex-col gap-1">
          <p className="text-small font-bold uppercase text-jaga-text-2">{t("status.tag")}</p>
          <h2 id="impact-status" className="font-bold text-jaga-ink">
            {t("status.title")}
          </h2>
          <p className="max-w-prose text-jaga-text">{t("status.body")}</p>
        </div>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="impact-rules">
        <h2 id="impact-rules" className="text-h3 font-bold text-jaga-ink">
          {t("rules.title")}
        </h2>
        <ul className="flex flex-col gap-3">
          {RULES.map((key) => (
            <li key={key} className={`${card} flex-row items-start gap-3`}>
              <CheckIcon size={24} className="mt-1 shrink-0 text-jaga-ink" />
              <p className="max-w-prose">{t(`rules.${key}`)}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="impact-will">
        <h2 id="impact-will" className="text-h3 font-bold text-jaga-ink">
          {t("will.title")}
        </h2>
        <p className="text-jaga-text">{t("will.lead")}</p>
        <ul className="list-disc ps-6 marker:text-jaga-text-2">
          {WILL.map((key) => (
            <li key={key} className="max-w-prose py-1">
              {t(`will.${key}`)}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="impact-privacy">
        <h2 id="impact-privacy" className="text-h3 font-bold text-jaga-ink">
          {t("privacy.title")}
        </h2>
        <p className={`${hint} max-w-prose`}>{t("privacy.body")}</p>
      </section>

      <section className={card} aria-labelledby="impact-help">
        <h2 id="impact-help" className="text-h3 font-bold text-jaga-ink">
          {t("help.title")}
        </h2>
        <p className="max-w-prose">{t("help.body")}</p>
        <Link href="/sos" prefetch={false} className={buttonPrimary}>
          {t("help.sos")}
        </Link>
      </section>
    </div>
  );
}
