import { getFormatter, getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { getSessionProfile } from "@/lib/auth";
import { toCsv } from "@/lib/export-format";
import { sitrepDocx, type DocxText } from "@/lib/sitrep-docx";
import {
  csvRow,
  CSV_COLUMNS,
  documentId,
  fileName,
  headlineLevel,
  LEVELS,
  LIMITS,
  periodFromQuery,
  readSitrep,
  tambonRows,
} from "@/lib/sitrep";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";
import { BANGKOK_DATE_TIME } from "@/lib/time";

/**
 * A unit's SITREP as a Word file or a CSV (owner, 18 Nov 2026). The printed page and the PDF are
 * the page itself; these two are the formats a browser cannot make.
 *
 * Nothing is decided here. `unit_sitrep` decides whether this caller may have a report at all and
 * what is in it; a refusal from the database is a 404, so the route cannot become a way to find
 * out which unit ids exist. The wording comes from `messages/*.json`, so the file says what the
 * page says, in the locale asked for.
 */
export async function GET(request: Request) {
  if (!supabaseConfigured()) return new Response("unavailable", { status: 503 });
  const session = await getSessionProfile();
  if (!session) return new Response("not found", { status: 404 });

  const query = new URL(request.url).searchParams;
  const unitId = query.get("unit");
  if (!unitId || !/^[0-9a-f-]{36}$/i.test(unitId)) return new Response("bad request", { status: 400 });
  const format = query.get("format") === "csv" ? "csv" : "docx";
  const period = periodFromQuery(query.get("from"), query.get("to"));
  const asked = query.get("locale");
  const locale = routing.locales.includes(asked as never) ? asked! : routing.defaultLocale;

  const supabase = await createClient();
  const sitrep = await readSitrep(supabase, unitId, period);
  if (!sitrep) return new Response("not found", { status: 404 });

  const t = await getTranslations({ locale, namespace: "sitrep" });
  const tAlert = await getTranslations({ locale, namespace: "alert.level" });
  const tDepth = await getTranslations({ locale, namespace: "map.depth" });
  const format_ = await getFormatter({ locale });
  const th = locale === "th";
  const when = (v: string | null | undefined) =>
    v ? format_.dateTime(new Date(v), BANGKOK_DATE_TIME) : t("unknownTime");

  if (format === "csv") {
    const rows = tambonRows(sitrep).map((r) =>
      Object.fromEntries(CSV_COLUMNS.map((c, i) => [c, csvRow(r, locale)[i]!])),
    );
    return new Response(toCsv(rows, CSV_COLUMNS), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName(unitId, period, "csv")}"`,
        "Cache-Control": NO_STORE,
      },
    });
  }

  const headline = headlineLevel(sitrep);
  const issued = LEVELS.filter((l) => (sitrep.alerts_issued[l] ?? 0) > 0);
  const text: DocxText = {
    kicker: t("kicker"),
    title: t("title"),
    unitLine: sitrep.unit.org ? `${sitrep.unit.name} · ${sitrep.unit.org}` : sitrep.unit.name,
    period: t("period", { from: when(sitrep.from), to: when(sitrep.to) }),
    areaLine: t("areaLine", {
      tambons: sitrep.area.tambons,
      districts: sitrep.area.districts,
      provinces: sitrep.area.provinces.map((p) => (th ? p.th : p.en)).join(", "),
    }),
    docLine: t("docLine", {
      id: documentId(unitId, period),
      generated: when(sitrep.generated_at),
    }),
    alertsTitle: t("alerts.title"),
    alertsNone: t("alerts.none"),
    alertsHeadline: t("alerts.headline", { level: headline ? tAlert(headline) : "" }),
    alertsIssued:
      issued.length > 0
        ? t("alerts.issuedInPeriod", {
            list: issued.map((l) => `${tAlert(l)} ${sitrep.alerts_issued[l]}`).join(", "),
          })
        : null,
    alertRows: sitrep.alerts_now.map((a) => ({
      level: tAlert(a.level),
      tambons: (a.tambons ?? []).map((x) => (th ? x.th : x.en)).join(", "),
      reason: a.reason ?? "",
      times:
        t("alerts.times", {
          issued: when(a.issued_at),
          next: a.next_update_at ? when(a.next_update_at) : t("alerts.noNext"),
        }) + (a.automatic ? ` · ${t("alerts.automatic")}` : ""),
      stale: a.stale ? t("alerts.stale", { time: when(a.next_update_at) }) : null,
    })),
    figuresTitle: t("figures.title"),
    figures: (
      [
        ["newCases", sitrep.sos.new_cases],
        ["newPeople", sitrep.sos.new_people],
        ["openNow", sitrep.sos.open_now],
        ["waitingNow", sitrep.sos.waiting_now],
        ["closedRescued", sitrep.sos.closed_rescued],
        ["fieldPeople", sitrep.field_rescues.people],
        ["reports", sitrep.reports.reports],
        ["roadsCut", sitrep.reports.roads_cut],
      ] as [string, number][]
    ).map(([key, value]) => ({
      label: t(`figures.${key}`),
      value: format_.number(Number(value) || 0),
    })),
    breakdown: t("figures.breakdown", {
      rescue: Number(sitrep.sos.new_rescue) || 0,
      supplies: Number(sitrep.sos.new_supplies) || 0,
      vulnerable: Number(sitrep.sos.new_vulnerable) || 0,
      merged: Number(sitrep.sos.merged) || 0,
    }),
    flagged:
      Number(sitrep.sos.new_spam) > 0
        ? t("figures.flagged", { count: Number(sitrep.sos.new_spam) })
        : null,
    byTambonTitle: t("byTambon.title"),
    byTambonNone: t("byTambon.none"),
    tableHead: [
      "tambon",
      "district",
      "level",
      "newCases",
      "people",
      "open",
      "waiting",
      "rescued",
      "reports",
      "roadsCut",
      "worstDepth",
    ].map((c) => t(`byTambon.${c}`)),
    tableRows: tambonRows(sitrep).map((r) => [
      th ? r.th : r.en,
      th ? r.district_th : r.district_en,
      r.level ? tAlert(r.level) : "-",
      String(r.new_cases),
      String(r.new_people),
      String(r.open_now),
      String(r.waiting_now),
      String(r.closed_rescued + r.field_people),
      String(r.reports),
      String(r.roads_cut),
      r.worst_depth ? tDepth(r.worst_depth) : "-",
    ]),
    placesTitle: t("places.title"),
    placesCounts: t("places.counts", {
      open: sitrep.places.open,
      full: sitrep.places.full,
      closed: sitrep.places.closed,
      unknown: sitrep.places.unknown,
    }),
    placesRows: sitrep.places.list.map((p) =>
      [
        (p.name?.[locale] ?? p.name?.th ?? p.name?.en ?? "") || t("places.unnamed"),
        th ? p.tambon_th : p.tambon_en,
        t(`places.status.${p.status}`),
        p.capacity ? t("places.capacity", { count: p.capacity }) : null,
        p.checked_at ? t("places.checked", { time: when(p.checked_at) }) : t("places.notChecked"),
      ]
        .filter(Boolean)
        .join(" · "),
    ),
    gaugesTitle: t("gauges.title"),
    gaugeRows: sitrep.gauges.map((g) =>
      [
        (g.name?.[locale] ?? g.name?.th ?? g.code) || g.code,
        g.value === null
          ? t("gauges.noReading")
          : t("gauges.reading", {
              value: format_.number(g.value, { maximumFractionDigits: 2 }),
              bank:
                g.bank_m === null
                  ? t("gauges.noBank")
                  : format_.number(g.bank_m, { maximumFractionDigits: 2 }),
            }),
        t("gauges.observed", { time: when(g.observed_at) }),
      ].join(" · "),
    ),
    limitsTitle: t("limits.title"),
    limits: LIMITS.map((l) => t(`limits.${l}`)),
    hotlines: t("limits.hotlines"),
    credit: t("limits.credit"),
    footer: t("docFooter", { id: documentId(unitId, period) }),
  };

  const file = await sitrepDocx(sitrep, period, text);
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${fileName(unitId, period, "docx")}"`,
      "Cache-Control": NO_STORE,
    },
  });
}
