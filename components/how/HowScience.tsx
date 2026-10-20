import { useTranslations } from "next-intl";
import { ForwardIcon, MapIcon, QuestionIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { creditById, SCIENCE_PARTS, type SciencePart } from "@/lib/how-it-works";
import { buttonPrimary, buttonSecondary } from "@/lib/ui";
import { ShareThisPage } from "@/components/ShareThisPage";
import { Credits } from "./Credits";
import { FIGURES, WorkflowFigure } from "./Figures";
import { HowNav } from "./HowNav";
import { HOW_ICONS } from "./icons";

/** The headline numbers, as the analysis left them. Results, not settings. */
const STATS = ["seasons", "passes", "land", "buildings", "gauges", "places"] as const;

/**
 * What was checked, and against what. Every figure here is a measured result from
 * each module's METHODS.md in `pipeline/`; the words beside it say plainly what the check does and does not
 * prove. Two of the rows are deliberately unflattering, because that is the point of the table.
 */
const CHECKS = [
  { key: "holdout", value: "74% · CSI 0.36" },
  { key: "radarSelf", value: "CSI 0.41" },
  { key: "gistda", value: "79-97%" },
  { key: "travel", value: "14 h / 14 h" },
  { key: "thresholds", value: "1-14" },
  { key: "recession", value: "456" },
  { key: "sea", value: "7%" },
  { key: "outlook", value: "4 / 10" },
] as const;

/**
 * "How Jaga works: the science" (A18, the owner's request of 15 Oct 2026). For readers who want
 * to judge the work: what each part of the map is, the idea behind it, which open data it rests
 * on, what it can and cannot tell, and how it was checked.
 *
 * It is a page to understand and to judge, not a recipe: no parameter values, no thresholds, no
 * step order. Anyone who needs those can ask for the methods notes - the contact line at the end
 * is for exactly that (A18 point 4).
 */
export function HowScience() {
  const t = useTranslations("howItWorks.science");
  const contact = process.env.CONTACT_EMAIL?.trim();
  return (
    <div className="flex flex-col gap-8" data-how="science">
      <HowNav current="science" />

      <section className="flex flex-col gap-4 rounded-3xl bg-jaga-slate px-5 py-7 text-white lg:px-10 lg:py-10">
        <h1 className="text-h2 font-bold leading-tight lg:text-h1">{t("title")}</h1>
        <p className="text-body text-white/90">{t("lead")}</p>
        <p className="text-small text-white/80">{t("audience")}</p>
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

      {/* How to read the page: the same four questions for every layer, in the same order. */}
      <section className="flex flex-col gap-3 rounded-2xl border border-jaga-line bg-jaga-surface p-5">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("read.title")}</h2>
        <p className="text-jaga-text">{t("read.text")}</p>
        <ul className="grid gap-2 sm:grid-cols-2">
          {(["concept", "can", "cannot", "checked"] as const).map((key) => (
            <li key={key} className="flex items-start gap-2 text-jaga-text">
              <span className="mt-0.5 size-2 shrink-0 translate-y-2 rounded-full bg-jaga-teal-ink" />
              <span>
                <span className="font-bold text-jaga-ink">{t(`labels.${key}`)}: </span>
                {t(`read.${key}`)}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-small text-jaga-text-2">{t("read.notRecipe")}</p>
      </section>

      {/* The whole workflow on one chart: data in, analysis, product, screen (owner, 16 Oct). */}
      <section className="flex flex-col gap-3" aria-labelledby="how-workflow" id="workflow">
        <h2 id="how-workflow" className="text-h3 font-bold text-jaga-ink">
          {t("workflow.title")}
        </h2>
        <p className="text-jaga-text">{t("workflow.lead")}</p>
        <WorkflowFigure />
        <p className="text-small text-jaga-text-2">{t("workflow.note")}</p>
      </section>

      {/* The contents: ten parts, each its own address. */}
      <nav aria-labelledby="how-contents" className="flex flex-col gap-3">
        <h2 id="how-contents" className="text-h3 font-bold text-jaga-ink">
          {t("contents")}
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SCIENCE_PARTS.map((part, i) => (
            <li key={part.key}>
              <a
                href={`#part-${part.key}`}
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
        {SCIENCE_PARTS.map((part, i) => (
          <PartCard key={part.key} part={part} n={i + 1} />
        ))}
      </div>

      {/* What was measured against what. The uncomfortable rows stay in. */}
      <section className="flex flex-col gap-3" aria-labelledby="how-checks" id="checks">
        <h2 id="how-checks" className="text-h3 font-bold text-jaga-ink">
          {t("checks.title")}
        </h2>
        <p className="text-jaga-text">{t("checks.lead")}</p>
        <ul className="flex flex-col gap-2">
          {CHECKS.map(({ key, value }) => (
            <li
              key={key}
              className="flex flex-col gap-1 rounded-2xl border border-jaga-line bg-jaga-surface p-4 sm:flex-row sm:items-baseline sm:gap-4"
              data-how-check={key}
            >
              <span className="shrink-0 font-bold tabular-nums text-jaga-teal-ink sm:w-32">
                {value}
              </span>
              <span className="flex flex-col gap-1">
                <span className="font-medium text-jaga-ink">{t(`checks.${key}.title`)}</span>
                <span className="text-jaga-text">{t(`checks.${key}.text`)}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-small text-jaga-text-2">{t("checks.note")}</p>
      </section>

      {/* Built and deliberately left out: the part of a method note that papers rarely print. */}
      <section className="flex flex-col gap-3 rounded-2xl border-2 border-jaga-edge bg-jaga-surface p-5">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("leftOut.title")}</h2>
        <p className="text-jaga-text">{t("leftOut.lead")}</p>
        <ul className="flex flex-col gap-3">
          {(["stage", "highways", "forecast"] as const).map((key) => (
            <li key={key} className="flex flex-col gap-1">
              <span className="font-bold text-jaga-ink">{t(`leftOut.${key}.title`)}</span>
              <span className="text-jaga-text">{t(`leftOut.${key}.text`)}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Open data in, open layers out. */}
      <section className="flex flex-col gap-3" aria-labelledby="how-open">
        <h2 id="how-open" className="text-h3 font-bold text-jaga-ink">
          {t("open.title")}
        </h2>
        <p className="text-jaga-text">{t("open.text")}</p>
        <p className="text-jaga-text">{t("open.layers")}</p>
        <p className="text-small text-jaga-text-2">{t("open.caution")}</p>
      </section>

      <Credits />

      {/* For researchers who want to work on it, not for the methods themselves (A18 point 4). */}
      <section className="flex flex-col gap-4 rounded-3xl border border-jaga-line bg-jaga-surface p-5 lg:p-8">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("contact.title")}</h2>
        <p className="text-jaga-text">{t("contact.text")}</p>
        {/* The project's own address, never hardcoded (CLAUDE.md); no address, no line. */}
        {contact && (
          <p className="text-jaga-text">
            <a
              href={`mailto:${contact}`}
              className="inline-flex min-h-tap items-center font-bold text-jaga-ink underline"
              data-how-contact
            >
              {contact}
            </a>
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Link href="/map" prefetch={false} className={buttonPrimary}>
            <MapIcon size={22} />
            {t("closing.map")}
          </Link>
          <Link href="/features" prefetch={false} className={buttonSecondary}>
            <QuestionIcon size={22} />
            {t("closing.features")}
          </Link>
        </div>
        <Link
          href="/how-it-works/system"
          prefetch={false}
          className="inline-flex min-h-tap items-center gap-2 font-medium text-jaga-ink underline"
        >
          {t("closing.system")}
          <ForwardIcon size={20} className="rtl:-scale-x-100" />
        </Link>
      </section>

      {/* Pass it on: this page, or Jaga. */}
      <ShareThisPage path="/how-it-works" title={t("title")} text={t("lead")} />
    </div>
  );
}

function PartCard({ part, n }: { part: SciencePart; n: number }) {
  const t = useTranslations("howItWorks.science");
  const Figure = part.figure ? FIGURES[part.figure] : null;
  return (
    <article
      id={`part-${part.key}`}
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

      <p className="text-jaga-text">{t(`parts.${part.key}.concept`)}</p>

      {Figure && <Figure />}

      <div className="grid gap-3 sm:grid-cols-2">
        <Says kind="can" text={t(`parts.${part.key}.can`)} label={t("labels.can")} />
        <Says kind="cannot" text={t(`parts.${part.key}.cannot`)} label={t("labels.cannot")} />
      </div>

      {part.checked && (
        <p className="rounded-2xl bg-jaga-teal-ink/10 px-4 py-3 text-jaga-ink">
          <span className="font-bold">{t("labels.checked")}: </span>
          {t(`parts.${part.key}.checked`)}
        </p>
      )}

      {part.sources.length > 0 && (
        <p className="flex flex-wrap items-baseline gap-2 text-small">
          <span className="font-medium text-jaga-text-2">{t("labels.sources")}:</span>
          {part.sources.map((id) => {
            const credit = creditById(id);
            return credit ? (
              <a
                key={id}
                href="#credits"
                className="rounded-full border border-jaga-line bg-jaga-ground px-3 py-1 text-jaga-text hover:border-jaga-teal-ink"
                data-how-source={id}
              >
                {credit.short}
              </a>
            ) : null;
          })}
        </p>
      )}
    </article>
  );
}

function Says({ kind, label, text }: { kind: "can" | "cannot"; label: string; text: string }) {
  return (
    <div
      className={`flex flex-col gap-1 rounded-2xl border p-4 ${
        kind === "can"
          ? "border-jaga-teal-ink/40 bg-jaga-teal-ink/5"
          : "border-jaga-line bg-jaga-ground"
      }`}
    >
      <h3 className="text-small font-bold uppercase tracking-wide text-jaga-text-2">{label}</h3>
      <p className="text-jaga-text">{text}</p>
    </div>
  );
}
