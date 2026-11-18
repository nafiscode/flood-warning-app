import { getFormatter, getTranslations } from "next-intl/server";
import {
  documentId,
  headlineLevel,
  LEVELS,
  LIMITS,
  tambonRows,
  type Level,
  type Period,
  type Sitrep,
} from "@/lib/sitrep";
import { BANGKOK_DATE_TIME } from "@/lib/time";

/**
 * The report itself: the part that prints.
 *
 * Deliberately plain HTML and a table, not the console's cards. This is the one screen in Jaga
 * whose real output is a sheet of A4 on somebody's desk, and the print rules in app/globals.css
 * (`@media print`) turn it into that. No map, no chart, no colour carrying meaning: a figure that
 * survives a monochrome office printer and a photocopy of a photocopy.
 *
 * An alert level is shown as a word, always - never as a colour alone (accessibility), and never
 * recoloured by this report: it prints the level a person published, with the stale marker beside
 * it if its next update is overdue (safety rule 3).
 */
export async function SitrepReport({
  sitrep,
  period,
  locale,
}: {
  sitrep: Sitrep;
  period: Period;
  locale: string;
}) {
  const t = await getTranslations("sitrep");
  const tAlert = await getTranslations("alert.level");
  const tDepth = await getTranslations("map.depth");
  const format = await getFormatter();
  const th = locale === "th";
  const when = (value: string | null | undefined) =>
    value ? format.dateTime(new Date(value), BANGKOK_DATE_TIME) : t("unknownTime");
  const rows = tambonRows(sitrep);
  const headline = headlineLevel(sitrep);
  const levelWord = (level: Level) => tAlert(level);
  const docId = documentId(sitrep.unit.id, period);

  const figures: [string, number][] = [
    ["newCases", sitrep.sos.new_cases],
    ["newPeople", sitrep.sos.new_people],
    ["openNow", sitrep.sos.open_now],
    ["waitingNow", sitrep.sos.waiting_now],
    ["closedRescued", sitrep.sos.closed_rescued],
    ["fieldPeople", sitrep.field_rescues.people],
    ["reports", sitrep.reports.reports],
    ["roadsCut", sitrep.reports.roads_cut],
  ];

  return (
    <article className="sitrep flex flex-col gap-6" data-sitrep="true" lang={locale}>
      {/* The heading block repeats on every printed page through the print rules. */}
      <header className="flex flex-col gap-1 border-b border-jaga-line pb-4">
        <p className="text-small font-medium tracking-wide text-jaga-text-2">{t("kicker")}</p>
        <h1 className="text-h2 font-bold text-jaga-ink">{t("title")}</h1>
        <p className="font-medium">
          {sitrep.unit.name}
          {sitrep.unit.org ? ` · ${sitrep.unit.org}` : ""}
        </p>
        <p>
          {t("period", { from: when(sitrep.from), to: when(sitrep.to) })}
          {period.cutOff ? "" : ` · ${t("customPeriod")}`}
        </p>
        <p className="text-small text-jaga-text-2">
          {t("areaLine", {
            tambons: sitrep.area.tambons,
            districts: sitrep.area.districts,
            provinces: sitrep.area.provinces.map((p) => (th ? p.th : p.en)).join(", "),
          })}
        </p>
        <p className="text-small text-jaga-text-2" data-sitrep-docid="true">
          {t("docLine", { id: docId, generated: when(sitrep.generated_at) })}
        </p>
      </header>

      {/* 1. The alerts in force. A report that opened with case counts would bury the one thing a
            reader has to act on. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("alerts.title")}</h2>
        {sitrep.alerts_now.length === 0 ? (
          <p data-sitrep-no-alerts="true">{t("alerts.none")}</p>
        ) : (
          <>
            <p className="font-medium" data-sitrep-headline={headline ?? undefined}>
              {t("alerts.headline", { level: headline ? levelWord(headline) : "" })}
            </p>
            <ul className="flex flex-col gap-3">
              {sitrep.alerts_now.map((a, i) => (
                <li key={`${a.issued_at}-${i}`} className="flex flex-col gap-1">
                  <p className="font-medium">
                    {levelWord(a.level)}
                    {" · "}
                    {(a.tambons ?? []).map((x) => (th ? x.th : x.en)).join(", ")}
                  </p>
                  {a.reason && <p>{a.reason}</p>}
                  <p className="text-small text-jaga-text-2">
                    {t("alerts.times", {
                      issued: when(a.issued_at),
                      next: a.next_update_at ? when(a.next_update_at) : t("alerts.noNext"),
                    })}
                    {a.automatic ? ` · ${t("alerts.automatic")}` : ""}
                  </p>
                  {/* Stale keeps the level and gains the marker: safety rule 3, in print too. */}
                  {a.stale && (
                    <p className="text-small font-medium" data-sitrep-stale="true">
                      {t("alerts.stale", { time: when(a.next_update_at) })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {LEVELS.some((l) => (sitrep.alerts_issued[l] ?? 0) > 0) && (
          <p className="text-small text-jaga-text-2">
            {t("alerts.issuedInPeriod", {
              list: LEVELS.filter((l) => (sitrep.alerts_issued[l] ?? 0) > 0)
                .map((l) => `${levelWord(l)} ${sitrep.alerts_issued[l]}`)
                .join(", "),
            })}
          </p>
        )}
      </section>

      {/* 2. The figures. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("figures.title")}</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {figures.map(([key, value]) => (
            <div key={key} className="flex flex-col">
              <dd className="text-h3 font-bold text-jaga-ink" data-sitrep-figure={key}>
                {format.number(Number(value) || 0)}
              </dd>
              <dt className="text-small text-jaga-text-2">{t(`figures.${key}`)}</dt>
            </div>
          ))}
        </dl>
        <p className="text-small text-jaga-text-2">
          {t("figures.breakdown", {
            rescue: Number(sitrep.sos.new_rescue) || 0,
            supplies: Number(sitrep.sos.new_supplies) || 0,
            vulnerable: Number(sitrep.sos.new_vulnerable) || 0,
            merged: Number(sitrep.sos.merged) || 0,
          })}
        </p>
        {Number(sitrep.sos.new_spam) > 0 && (
          <p className="text-small text-jaga-text-2">
            {t("figures.flagged", { count: Number(sitrep.sos.new_spam) })}
          </p>
        )}
      </section>

      {/* 3. Where, by tambon. Only tambons where something happened; the database leaves the rest
            out, so this table is short enough to read. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("byTambon.title")}</h2>
        {rows.length === 0 ? (
          <p data-sitrep-quiet="true">{t("byTambon.none")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-small" data-sitrep-table="true">
              <thead>
                <tr className="border-b border-jaga-line text-start">
                  {[
                    "tambon",
                    "level",
                    "newCases",
                    "people",
                    "open",
                    "waiting",
                    "rescued",
                    "reports",
                    "roadsCut",
                    "worstDepth",
                  ].map((c) => (
                    <th key={c} scope="col" className="py-2 pe-3 text-start font-medium">
                      {t(`byTambon.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.code} className="border-b border-jaga-line">
                    <th scope="row" className="py-2 pe-3 text-start font-normal">
                      {th ? r.th : r.en}
                      <span className="block text-jaga-text-2">
                        {th ? r.district_th : r.district_en}
                      </span>
                    </th>
                    <td className="py-2 pe-3">{r.level ? levelWord(r.level) : "—"}</td>
                    <td className="py-2 pe-3">{r.new_cases}</td>
                    <td className="py-2 pe-3">{r.new_people}</td>
                    <td className="py-2 pe-3">{r.open_now}</td>
                    <td className="py-2 pe-3">{r.waiting_now}</td>
                    <td className="py-2 pe-3">{r.closed_rescued + r.field_people}</td>
                    <td className="py-2 pe-3">{r.reports}</td>
                    <td className="py-2 pe-3">{r.roads_cut}</td>
                    <td className="py-2 pe-3">
                      {r.worst_depth ? tDepth(r.worst_depth) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 4. Safe places: the question a district officer asks second, after "how many people". */}
      <section className="flex flex-col gap-3">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("places.title")}</h2>
        <p>
          {t("places.counts", {
            open: sitrep.places.open,
            full: sitrep.places.full,
            closed: sitrep.places.closed,
            unknown: sitrep.places.unknown,
          })}
        </p>
        {sitrep.places.list.length > 0 && (
          <ul className="flex flex-col gap-1">
            {sitrep.places.list.map((p, i) => (
              <li key={`${p.tambon_th}-${i}`}>
                {(p.name?.[locale] ?? p.name?.th ?? p.name?.en ?? "") || t("places.unnamed")}
                {" · "}
                {th ? p.tambon_th : p.tambon_en}
                {" · "}
                {t(`places.status.${p.status}`)}
                {p.capacity ? ` · ${t("places.capacity", { count: p.capacity })}` : ""}
                <span className="text-jaga-text-2">
                  {" · "}
                  {p.checked_at ? t("places.checked", { time: when(p.checked_at) }) : t("places.notChecked")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 5. The rivers, with each reading's own observation time (safety rule 8). */}
      {sitrep.gauges.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-h3 font-bold text-jaga-ink">{t("gauges.title")}</h2>
          <ul className="flex flex-col gap-1">
            {sitrep.gauges.map((g) => (
              <li key={g.code}>
                {(g.name?.[locale] ?? g.name?.th ?? g.code) || g.code}
                {" · "}
                {g.value === null
                  ? t("gauges.noReading")
                  : t("gauges.reading", {
                      value: format.number(g.value, { maximumFractionDigits: 2 }),
                      bank:
                        g.bank_m === null
                          ? t("gauges.noBank")
                          : format.number(g.bank_m, { maximumFractionDigits: 2 }),
                    })}
                <span className="text-jaga-text-2">
                  {" · "}
                  {t("gauges.observed", { time: when(g.observed_at) })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 6. The limits, as prominent as the figures, because the document travels further than the
            screen it came from (safety rules 8 and 2). */}
      <section className="flex flex-col gap-2 border-t border-jaga-line pt-4">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("limits.title")}</h2>
        <ul className="flex flex-col gap-1" data-sitrep-limits="true">
          {LIMITS.map((l) => (
            <li key={l}>{t(`limits.${l}`)}</li>
          ))}
        </ul>
        <p className="text-small text-jaga-text-2">{t("limits.hotlines")}</p>
        <p className="text-small text-jaga-text-2">{t("limits.credit")}</p>
      </section>
    </article>
  );
}
