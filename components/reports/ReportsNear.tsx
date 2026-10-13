import { useFormatter, useLocale, useTranslations } from "next-intl";
import { WaveIcon } from "@/components/icons";
import { Link } from "@/i18n/navigation";
import { pickName } from "@/lib/area";
import type { NearMe, TambonReports } from "@/lib/flood-reports";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { hint } from "@/lib/ui";

/** The map, opened on one tambon's reports. */
export const reportsMapHref = (r: Pick<TambonReports, "tambon" | "lat" | "lon">) => ({
  pathname: "/map" as const,
  query: { reports: r.tambon, at: `${r.lat.toFixed(4)},${r.lon.toFixed(4)}` },
});

function Row({ r, link }: { r: TambonReports; link: boolean }) {
  const t = useTranslations("reportsNear");
  const tReport = useTranslations("report");
  const locale = useLocale();
  const format = useFormatter();
  return (
    <li
      className="flex flex-col gap-1 border-t border-jaga-line pt-3 first:border-t-0 first:pt-0"
      data-reports-tambon={r.tambon}
      data-reports-confirmed={r.confirmed}
    >
      <p className="font-bold">
        {t("place", {
          tambon: pickName(locale, r.nameTh, r.nameEn),
          district: pickName(locale, r.districtTh, r.districtEn),
        })}
      </p>
      <p>{t("count", { reports: r.reports, people: r.people })}</p>
      {/* In words, never by colour: how far to trust it is the first thing to know. */}
      <p className="font-medium" data-reports-trust={r.confirmed ? "confirmed" : "single"}>
        {t(r.confirmed ? "confirmed" : "unconfirmed")}
      </p>
      <ul className={`flex flex-col ${hint}`}>
        {r.deepest && <li>{t("deepest", { depth: tReport(`depths.${r.deepest}`) })}</li>}
        {r.trend && <li>{t("trend", { trend: tReport(`trends.${r.trend}`) })}</li>}
        {r.worstRoad && <li>{t("road", { road: tReport(`roads.${r.worstRoad}`) })}</li>}
        <li>{t("latest", { time: format.dateTime(new Date(r.latestAt), BANGKOK_DATE_TIME) })}</li>
      </ul>
      {link && (
        <Link
          href={reportsMapHref(r)}
          prefetch={false}
          className="inline-flex min-h-tap items-center self-start font-medium underline"
        >
          {t("seeMap")}
        </Link>
      )}
    </li>
  );
}

/**
 * "Flood has been reported near your area" (the owner, 13 Oct): what residents in the person's
 * own tambons and districts have reported, counts only. It is drawn from what it is given.
 *
 * It is not an alert and must not look like one: brand ink, no alert colour, no level badge, and
 * the second line says who is speaking and that Jaga has not checked it (safety rule 2). The hero
 * beside it is still what says what level their tambon is at. Nothing is drawn when there is
 * nothing to say, and that silence is never worded as "no flooding" (safety rule 10).
 */
export function ReportsNear({
  near,
  title,
  link = true,
}: {
  near: NearMe;
  /** The heading: the home screen's sentence, or a plainer one on the map. */
  title?: string;
  link?: boolean;
}) {
  const t = useTranslations("reportsNear");
  if (near.here.length + near.district.length === 0) return null;
  const group = (name: string, rows: TambonReports[]) =>
    rows.length > 0 && (
      <div className="flex flex-col gap-2">
        <h3 className={`${hint} font-bold`}>{name}</h3>
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <Row key={r.tambon} r={r} link={link} />
          ))}
        </ul>
      </div>
    );
  return (
    <section
      data-reports-near={near.here.length > 0 ? "here" : "district"}
      className="flex flex-col gap-3 rounded-2xl border-2 border-jaga-edge bg-jaga-surface p-5"
    >
      <h2 className="flex items-start gap-3 text-h3 font-bold text-jaga-ink">
        <WaveIcon size={30} aria-hidden="true" className="mt-0.5 shrink-0" />
        {title ?? t("title")}
      </h2>
      <p>{t("source")}</p>
      {group(t("here"), near.here)}
      {group(t("district"), near.district)}
      <p className={hint}>{t("advice")}</p>
    </section>
  );
}
