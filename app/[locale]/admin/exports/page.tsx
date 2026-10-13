import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { isAdminHere } from "@/lib/admin-guard";
import { EXPORT_DAYS } from "@/lib/export-format";
import { buttonPrimary, card, checkBox, checkRow, hint, input, label } from "@/lib/ui";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/exports">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "adminTools" });
  return { title: t("exports.title") };
}

export const dynamic = "force-dynamic";

const KINDS = ["sos", "reports", "alerts"] as const;

/**
 * Exports (spec 6.5): SOS, reports and alerts as a CSV for a spreadsheet or a GeoJSON for a GIS.
 * No file carries a phone number, a name or free text. The SOS export is anonymized unless the
 * admin ticks otherwise: no case id, the place rounded to about a kilometre and the time to the
 * hour. Every export is written to the access log with how many rows it held.
 *
 * Plain GET forms: the browser downloads the file, nothing else on the page changes.
 */
export default async function Exports({ params }: PageProps<"/[locale]/admin/exports">) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await isAdminHere())) return null;
  const t = await getTranslations("adminTools");

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-h3 font-bold text-jaga-ink">{t("exports.title")}</h1>
      <p className={hint}>{t("exports.intro")}</p>
      <div className="grid gap-5 lg:grid-cols-3">
        {KINDS.map((kind) => (
          <form
            key={kind}
            method="get"
            action="/api/admin/export"
            className={card}
            data-export={kind}
          >
            <input type="hidden" name="what" value={kind} />
            <h2 className="text-body font-bold">{t(`exports.${kind}.title`)}</h2>
            <p className={hint}>{t(`exports.${kind}.note`)}</p>
            <label htmlFor={`days-${kind}`} className={label}>
              {t("exports.period")}
            </label>
            <select id={`days-${kind}`} name="days" defaultValue="30" className={input}>
              {EXPORT_DAYS.map((days) => (
                <option key={days} value={days}>
                  {t("exports.days", { days })}
                </option>
              ))}
            </select>
            <label htmlFor={`format-${kind}`} className={label}>
              {t("exports.format")}
            </label>
            <select id={`format-${kind}`} name="format" defaultValue="csv" className={input}>
              <option value="csv">{t("exports.csv")}</option>
              <option value="geojson">{t("exports.geojson")}</option>
            </select>
            {kind === "sos" && (
              <label className={checkRow}>
                <input type="checkbox" name="full" value="1" className={checkBox} />
                <span>
                  {t("exports.full")}
                  <span className={`block ${hint}`}>{t("exports.fullHint")}</span>
                </span>
              </label>
            )}
            <button type="submit" className={buttonPrimary}>
              {t("exports.download")}
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
