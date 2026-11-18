import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BackLink } from "@/components/BackLink";
import { SitrepReport } from "@/components/authority/SitrepReport";
import { Link } from "@/i18n/navigation";
import { readMyUnits } from "@/lib/authority-board";
import { getSessionProfile, localePath } from "@/lib/auth";
import { PRIVATE_PAGE } from "@/lib/seo";
import {
  fileName,
  periodFromQuery,
  readSitrep,
  toLocalInput,
  MAX_DAYS,
  type Period,
} from "@/lib/sitrep";
import { createClient } from "@/lib/supabase/server";
import { buttonPrimary, buttonSecondary, card, hint, input, label, notice } from "@/lib/ui";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/authority/sitrep">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "sitrep" });
  return { title: t("title"), ...PRIVATE_PAGE };
}

export const dynamic = "force-dynamic";

/**
 * The SITREP page (owner, 18 Nov 2026): a verified unit's own situation report, for a period, to
 * read on screen, print, save as PDF, or download as Word or CSV.
 *
 * Who may open it is decided in the database (`unit_sitrep`), never here: the owner or an active
 * dispatcher of a verified field unit, for that unit's coverage. An office-only unit - a dam
 * operator or a planning office - is not a team in the field and is refused, like every other
 * team read (safety rule 5). What the report may contain is also the database's decision: counts,
 * and nothing that names or locates a person (rules 5 and 6).
 *
 * The page's own job is only the period and the formats.
 */
export default async function SitrepPage({
  params,
  searchParams,
}: PageProps<"/[locale]/authority/sitrep">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const session = await getSessionProfile();
  if (!session) {
    redirect(`${localePath(locale, "/sign-in")}?next=${localePath(locale, "/authority/sitrep")}`);
  }
  const t = await getTranslations("sitrep");
  const tNav = await getTranslations("nav");

  // Only field units: an office-only unit would be refused by the database anyway, and showing it
  // a chooser it cannot use would be worse than not offering the page.
  const OFFICE = ["dam", "planning"];
  const units = (await readMyUnits(session.userId)).filter(
    (u) => !u.capabilities.every((c) => OFFICE.includes(c)),
  );
  if (units.length === 0) {
    return (
      <div className="flex flex-col gap-5">
        <section className={card} data-sitrep-not-allowed="true">
          <h1 className="text-h3 font-bold text-jaga-ink">{t("notAllowed.title")}</h1>
          <p>{t("notAllowed.body")}</p>
        </section>
        <BackLink label={tNav("backBoard")} href="/authority" />
      </div>
    );
  }

  const asked = typeof query.unit === "string" ? query.unit : undefined;
  const unit = units.find((u) => u.id === asked) ?? units[0]!;
  const period: Period = periodFromQuery(
    typeof query.from === "string" ? query.from : null,
    typeof query.to === "string" ? query.to : null,
  );

  const supabase = await createClient();
  const sitrep = await readSitrep(supabase, unit.id, period);

  const download = (format: "docx" | "csv") => ({
    pathname: "/api/authority/sitrep" as const,
    query: {
      unit: unit.id,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      format,
      locale,
    },
  });

  return (
    <div className="flex flex-col gap-5">
      {/* Everything in this block is screen furniture: the print rules hide it. */}
      <section className={`${card} print:hidden`} data-sitrep-controls="true">
        <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
        <p>{t("lead")}</p>
        <p className={notice} data-sitrep-not-alert="true">
          {t("notAlert")}
        </p>

        {units.length > 1 && (
          <nav className="flex flex-wrap gap-2" aria-label={t("unitPick")}>
            {units.map((u) => (
              <Link
                key={u.id}
                href={{ pathname: "/authority/sitrep", query: { unit: u.id } }}
                data-unit-pick={u.id}
                aria-current={u.id === unit.id ? "page" : undefined}
                className={u.id === unit.id ? buttonPrimary : buttonSecondary}
              >
                {u.name}
              </Link>
            ))}
          </nav>
        )}

        {/* A plain GET form: the period is in the URL, so a report can be bookmarked and sent to a
            colleague as a link that opens the same hours. */}
        <form method="get" className="flex flex-col gap-3" data-sitrep-period="true">
          <input type="hidden" name="unit" value={unit.id} />
          <p className={hint}>{t("periodHelp", { days: MAX_DAYS })}</p>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1">
              <span className={label}>{t("fromLabel")}</span>
              <input
                type="datetime-local"
                name="from"
                defaultValue={toLocalInput(period.from)}
                className={input}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>{t("toLabel")}</span>
              <input
                type="datetime-local"
                name="to"
                defaultValue={toLocalInput(period.to)}
                className={input}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={buttonPrimary}>
              {t("apply")}
            </button>
            <Link
              href={{ pathname: "/authority/sitrep", query: { unit: unit.id } }}
              className={buttonSecondary}
            >
              {t("resetPeriod")}
            </Link>
          </div>
        </form>

        {sitrep && (
          <div className="flex flex-wrap gap-2" data-sitrep-downloads="true">
            {/* Printing is the browser's own dialogue, where "Save as PDF" lives on every phone
                and laptop: no PDF library, no server render, and one set of wording to review. */}
            <a
              href={`/api/authority/sitrep?${new URLSearchParams(
                download("docx").query as Record<string, string>,
              )}`}
              className={buttonSecondary}
              download={fileName(unit.id, period, "docx")}
              data-sitrep-docx="true"
            >
              {t("downloadDocx")}
            </a>
            <a
              href={`/api/authority/sitrep?${new URLSearchParams(
                download("csv").query as Record<string, string>,
              )}`}
              className={buttonSecondary}
              download={fileName(unit.id, period, "csv")}
              data-sitrep-csv="true"
            >
              {t("downloadCsv")}
            </a>
          </div>
        )}
        <p className={hint}>{t("printHint")}</p>
      </section>

      {sitrep ? (
        <SitrepReport sitrep={sitrep} period={period} locale={locale} />
      ) : (
        <section className={card} data-sitrep-unavailable="true">
          <h2 className="text-h3 font-bold text-jaga-ink">{t("unavailable.title")}</h2>
          <p>{t("unavailable.body")}</p>
        </section>
      )}

      <div className="print:hidden">
        <BackLink label={tNav("backBoard")} href="/authority" />
      </div>
    </div>
  );
}
