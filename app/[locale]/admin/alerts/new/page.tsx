import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { AlertReview } from "@/components/admin/AlertReview";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import { CoverageMap } from "@/components/authority/CoverageMap";
import { Link } from "@/i18n/navigation";
import { readAlerts, readAreas, readTemplates } from "@/lib/admin-alerts";
import {
  alertReviewMessages,
  alertState,
  isUuid,
  ISSUABLE_LEVELS,
  NEXT_UPDATE_HOURS,
} from "@/lib/alert-console";
import { getSessionProfile, isAdminRole } from "@/lib/auth";
import { inService } from "@/lib/features";
import { card, checkBox, checkRow, errorNotice, hint, input, label, notice } from "@/lib/ui";
import { publishAlert } from "../actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/alerts/new">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "alertConsole" });
  return { title: t("form.title") };
}

export const dynamic = "force-dynamic";

const ERRORS = [
  "template",
  "nextUpdate",
  "window",
  "area",
  "gone",
  "evacuate",
  "drillMix",
  "save",
] as const;
const WINDOW_FIELDS = ["onsetFrom", "onsetTo", "returnFrom", "returnTo"] as const;

/**
 * A new alert (spec 6.2): level and reason from a reviewed template, the area, the admin's own
 * note, when the next update is due, and optionally when flooding and the return are expected.
 * Plain HTML up to the review step, so it works on a slow connection; nothing is sent until the
 * review has been read (components/admin/AlertReview).
 *
 * With `?supersedes=<id>` the new alert replaces one in force and starts from its area.
 */
export default async function NewAlert({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/alerts/new">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  // The layout turns a visitor away, but a page is rendered alongside its layout: read nothing
  // for someone who is not an admin, rather than ask the database and be refused.
  const session = await getSessionProfile();
  if (!session || !isAdminRole(session.role)) return null;
  const t = await getTranslations("alertConsole");
  const tAdmin = await getTranslations("admin");
  const [templates, areas, alerts] = await Promise.all([
    readTemplates(),
    readAreas(),
    isUuid(query.supersedes) ? readAlerts(500) : Promise.resolve([]),
  ]);
  const old = alerts.find((a) => a.id === query.supersedes && alertState(a) === "inForce") ?? null;
  const preset = new Set(old?.tambons ?? []);
  const error = ERRORS.find((e) => e === query.error);
  const name = (area: { name_th: string; name_en: string }) =>
    locale === "th" || !area.name_en ? area.name_th : area.name_en;
  const words = (text: Record<string, string>) => text[locale] ?? text.th ?? "";

  return (
    <form action={publishAlert.bind(null, locale)} className="flex flex-col gap-5">
      <h1 className="text-h3 font-bold text-jaga-ink">{t("form.title")}</h1>
      <p>
        <Link href="/admin/alerts" className="inline-flex min-h-tap items-center underline">
          {t("form.back")}
        </Link>
      </p>
      {!inService() && (
        <p className={errorNotice} data-drill-mode="true">
          {t("drillMode")}
        </p>
      )}
      {error && (
        <p role="alert" className={errorNotice}>
          {t(`form.error.${error}`)}
        </p>
      )}
      {old && (
        <div className={notice} data-superseding={old.id}>
          <input type="hidden" name="supersedes" value={old.id} />
          <p className="font-bold">{t("form.replacing")}</p>
          <p className="flex flex-wrap items-center gap-2 pt-2">
            <AlertBadge level={old.level} />
            <span>{t("card.tambons", { count: old.tambons.length })}</span>
          </p>
        </div>
      )}

      <fieldset className={card}>
        <legend className={`${label} float-start`}>{t("form.template.legend")}</legend>
        <p className={`clear-both ${hint}`}>{t("form.template.hint")}</p>
        {ISSUABLE_LEVELS.flatMap((level) => templates.filter((tpl) => tpl.level === level)).map(
          (tpl) => (
            <label key={tpl.id} className={`${checkRow} border-t border-jaga-line pt-3`}>
              <input
                type="radio"
                name="template"
                value={tpl.id}
                required
                className={checkBox}
                data-template={tpl.code}
              />
              <span className="flex flex-col gap-1">
                <AlertBadge level={tpl.level} />
                <span className="font-bold">{words(tpl.label)}</span>
                <span className={hint}>{words(tpl.reason)}</span>
              </span>
            </label>
          ),
        )}
        {templates.length === 0 && <p role="alert">{t("form.template.none")}</p>}
      </fieldset>

      <fieldset className={card}>
        <legend className={`${label} float-start`}>{t("form.area.legend")}</legend>
        <p className={`clear-both ${hint}`}>{t("form.area.hint")}</p>
        <CoverageMap
          text={{
            useMap: t("form.area.useMap"),
            hideMap: t("form.area.hideMap"),
            mapHint: t("form.area.mapHint"),
            count: t("form.area.mapCount", { count: "{n}" }),
            locked: t("form.area.mapLocked"),
            mapFailed: t("form.area.mapFailed"),
          }}
        />
        {areas.zones.length > 0 && (
          <div className="flex flex-col border-t border-jaga-line pt-2">
            <p className="font-bold">{t("form.area.zones")}</p>
            {areas.zones.map((zone) => (
              <label key={zone.id} className={checkRow}>
                <input type="checkbox" name="zone" value={zone.id} className={checkBox} />
                <span>
                  {words(zone.name)}
                  <span className={`block ${hint}`}>
                    {t("card.tambons", { count: zone.tambons.length })}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
        {areas.provinces.map((province) => (
          <div key={province.code} className="flex flex-col border-t border-jaga-line pt-2">
            <label className={checkRow}>
              <input type="checkbox" name="province" value={province.code} className={checkBox} />
              <span className="font-bold">
                {t("form.area.wholeProvince", { name: name(province) })}
              </span>
            </label>
            <details>
              <summary className="min-h-tap cursor-pointer py-2 text-jaga-teal-ink underline">
                {t("form.area.chooseDistricts", { name: name(province) })}
              </summary>
              <div className="flex flex-col ps-4">
                {areas.districts
                  .filter((d) => d.province_code === province.code)
                  .map((district) => (
                    <div key={district.code}>
                      <label className={checkRow}>
                        <input
                          type="checkbox"
                          name="district"
                          value={district.code}
                          className={checkBox}
                        />
                        <span>{t("form.area.wholeDistrict", { name: name(district) })}</span>
                      </label>
                      <details>
                        <summary className="min-h-tap cursor-pointer py-2 text-small text-jaga-teal-ink underline">
                          {t("form.area.chooseTambons", { name: name(district) })}
                        </summary>
                        <div className="flex flex-col ps-4">
                          {areas.tambons
                            .filter((tb) => tb.district_code === district.code)
                            .map((tambon) => (
                              <label key={tambon.code} className={checkRow}>
                                <input
                                  type="checkbox"
                                  name="tambon"
                                  value={tambon.code}
                                  defaultChecked={preset.has(tambon.code)}
                                  className={checkBox}
                                />
                                <span>{name(tambon)}</span>
                              </label>
                            ))}
                        </div>
                      </details>
                    </div>
                  ))}
              </div>
            </details>
          </div>
        ))}
        {areas.provinces.length === 0 && <p role="alert">{t("form.area.unavailable")}</p>}
      </fieldset>

      <section className={card}>
        <label htmlFor="note" className={label}>
          {t("form.note.label")}
        </label>
        <input id="note" name="note" maxLength={400} className={input} />
        <p className={hint}>{t("form.note.hint")}</p>

        <label htmlFor="hours" className={label}>
          {t("form.nextUpdate.label")}
        </label>
        <select id="hours" name="hours" defaultValue="3" required className={input}>
          {NEXT_UPDATE_HOURS.map((hours) => (
            <option key={hours} value={hours}>
              {t("hours", { hours })}
            </option>
          ))}
        </select>
        <p className={hint}>{t("form.nextUpdate.hint")}</p>
      </section>

      <details className={card}>
        <summary className="flex min-h-tap cursor-pointer items-center font-medium underline">
          {t("form.windows.summary")}
        </summary>
        <p className={hint}>{t("form.windows.hint")}</p>
        {WINDOW_FIELDS.map((field) => (
          <div key={field} className="flex flex-col gap-1">
            <label htmlFor={field} className={label}>
              {t(`form.windows.${field}`)} {tAdmin("bangkokTime")}
            </label>
            <input id={field} name={field} type="datetime-local" className={input} />
          </div>
        ))}
      </details>

      <NextIntlClientProvider messages={alertReviewMessages(await getMessages())}>
        <AlertReview bangkokLabel={tAdmin("bangkokTime")} />
      </NextIntlClientProvider>
    </form>
  );
}
