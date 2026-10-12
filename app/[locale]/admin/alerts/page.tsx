import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DualTime } from "@/components/admin/DualTime";
import { AlertBadge } from "@/components/alerts/AlertBadge";
import { AlertStatus } from "@/components/alerts/AlertStatus";
import { Link } from "@/i18n/navigation";
import { readAlerts, readAreas } from "@/lib/admin-alerts";
import { alertState, NEXT_UPDATE_HOURS, type AdminAlert } from "@/lib/alert-console";
import { inService } from "@/lib/features";
import { reasonFor } from "@/lib/public-status";
import {
  buttonPrimary,
  buttonSecondary,
  card,
  errorNotice,
  hint,
  input,
  label,
  notice,
} from "@/lib/ui";
import { cancelAlert, extendAlert } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/alerts">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "alertConsole" });
  return { title: t("title") };
}

export const dynamic = "force-dynamic";

const DONE = ["published", "extended", "cancelled"] as const;
const ERRORS = ["save", "gone", "reason"] as const;
const EVENTS = [
  "alert_published",
  "alert_extended",
  "alert_superseded",
  "alert_cancelled",
  "dam_release_sent",
] as const;
const NAMES_SHOWN = 4;

/**
 * The alert console's front page (spec 6.2): what is in force, what an admin can do to each
 * alert - say it still stands, replace it, withdraw it - and everything that came before, with
 * who did what and when. Drills are listed with real alerts and marked; the public sees neither
 * the mark nor the drill.
 *
 * The admin layout has turned away everyone who is not an admin, and the database functions
 * check again.
 */
export default async function AdminAlerts({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/alerts">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const t = await getTranslations("alertConsole");
  const tAdmin = await getTranslations("admin");
  const [alerts, areas] = await Promise.all([readAlerts(100), readAreas()]);
  const names = new Map(
    areas.tambons.map((tb) => [tb.code, locale === "th" || !tb.name_en ? tb.name_th : tb.name_en]),
  );
  const inForce = alerts.filter((a) => alertState(a) === "inForce");
  const ended = alerts.filter((a) => alertState(a) !== "inForce");
  const done = DONE.find((d) => d === query.done);
  const error = ERRORS.find((e) => e === query.error);
  const bangkok = tAdmin("bangkokTime");

  const areaText = (a: AdminAlert) => {
    const shown = a.tambons.slice(0, NAMES_SHOWN).map((code) => names.get(code) ?? code);
    const more = a.tambons.length - shown.length;
    return more > 0
      ? t("card.areaMore", { names: shown.join(", "), more })
      : t("card.area", { names: shown.join(", ") });
  };

  const body = (a: AdminAlert) => (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {alertState(a) === "inForce" ? (
          <AlertStatus level={a.level} nextUpdateAt={new Date(a.nextUpdateAt)} />
        ) : (
          <AlertBadge level={a.level} />
        )}
        {a.drill && (
          <span
            className="inline-flex min-h-tap items-center rounded-full border-2 border-jaga-edge px-3 font-bold"
            data-drill="true"
          >
            {t("drillTag")}
          </span>
        )}
        {alertState(a) !== "inForce" && (
          <span className="font-bold text-jaga-text-2">{t(`state.${alertState(a)}`)}</span>
        )}
      </div>
      <p className="font-bold text-jaga-ink">
        {t("card.tambons", { count: a.tambons.length })}
        <span className={`block font-normal ${hint}`}>{areaText(a)}</span>
      </p>
      <p>
        <span className={`block ${hint}`}>{t("card.reason")}</span>
        {reasonFor(a, locale)}
      </p>
      <p lang={a.messages[locale] ? locale : "th"}>{a.messages[locale] ?? a.messages.th}</p>
      <p className={hint}>
        {t("card.issued", { name: a.issuedBy ?? "–" })}{" "}
        <DualTime iso={a.issuedAt} bangkokLabel={bangkok} />
      </p>
      {alertState(a) === "inForce" ? (
        <p className="font-medium">
          {t("card.nextUpdate")} <DualTime iso={a.nextUpdateAt} bangkokLabel={bangkok} />
        </p>
      ) : (
        a.endedAt && (
          <p className={hint}>
            {t("card.ended")} <DualTime iso={a.endedAt} bangkokLabel={bangkok} />
          </p>
        )
      )}
      {a.onset && (
        <p className={hint}>
          {t("card.onset")} <DualTime iso={a.onset[0]} bangkokLabel={bangkok} /> –{" "}
          <DualTime iso={a.onset[1]} bangkokLabel={bangkok} />
        </p>
      )}
      {a.returnWindow && (
        <p className={hint}>
          {t("card.returnWindow")} <DualTime iso={a.returnWindow[0]} bangkokLabel={bangkok} /> –{" "}
          <DualTime iso={a.returnWindow[1]} bangkokLabel={bangkok} />
        </p>
      )}
      <details>
        <summary className="flex min-h-tap cursor-pointer items-center underline">
          {t("card.history", { count: a.events.length })}
        </summary>
        <ol className="flex flex-col gap-2 pt-1" data-history={a.events.length}>
          {a.events.map((e, i) => {
            const note = typeof e.details.note === "string" ? e.details.note : "";
            const known = EVENTS.find((k) => k === e.action);
            return (
              <li key={i} className={hint} data-event={e.action}>
                <span className="font-medium text-jaga-text">
                  {known ? t(`event.${known}`) : e.action}
                </span>
                {" · "}
                {e.by ?? "–"}
                {" · "}
                <DualTime iso={e.at} bangkokLabel={bangkok} />
                {note && <span className="block">{note}</span>}
              </li>
            );
          })}
        </ol>
      </details>
    </>
  );

  return (
    <div className="flex flex-col gap-5" data-alert-console={inForce.length}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
      <p className={hint}>{t("intro")}</p>
      {!inService() && (
        <p className={errorNotice} data-drill-mode="true">
          {t("drillMode")}
        </p>
      )}
      {done && (
        <p role="status" className={notice}>
          {t(`done.${done}`)}
        </p>
      )}
      {error && (
        <p role="alert" className={errorNotice}>
          {t(`error.${error}`)}
        </p>
      )}
      <Link href="/admin/alerts/new" className={buttonPrimary} data-new-alert="true">
        {t("new")}
      </Link>

      <h2 className="text-body font-bold text-jaga-ink">
        {t("inForce.title", { count: inForce.length })}
      </h2>
      {inForce.length === 0 && <p className="font-medium">{t("inForce.none")}</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        {inForce.map((a) => (
          <article key={a.id} className={card} data-alert={a.id} data-level={a.level}>
            {body(a)}
            <details>
              <summary className="flex min-h-tap cursor-pointer items-center font-medium underline">
                {t("extend.summary")}
              </summary>
              <form action={extendAlert.bind(null, locale)} className="flex flex-col gap-3 pt-2">
                <input type="hidden" name="alert" value={a.id} />
                <label htmlFor={`hours-${a.id}`} className={label}>
                  {t("extend.hours")}
                </label>
                <select id={`hours-${a.id}`} name="hours" defaultValue="3" className={input}>
                  {NEXT_UPDATE_HOURS.map((hours) => (
                    <option key={hours} value={hours}>
                      {t("hours", { hours })}
                    </option>
                  ))}
                </select>
                <label htmlFor={`extend-note-${a.id}`} className={label}>
                  {t("extend.note")}
                </label>
                <input id={`extend-note-${a.id}`} name="note" maxLength={400} className={input} />
                <p className={hint}>{t("extend.hint")}</p>
                <button type="submit" className={buttonSecondary} data-extend="true">
                  {t("extend.send")}
                </button>
              </form>
            </details>
            {a.kind === "dam_release" ? (
              <p className={hint}>{t("damNote")}</p>
            ) : (
              <Link
                href={`/admin/alerts/new?supersedes=${a.id}`}
                className={buttonSecondary}
                data-replace="true"
              >
                {t("replace")}
              </Link>
            )}
            <details>
              <summary className="flex min-h-tap cursor-pointer items-center font-medium underline">
                {t("cancel.summary")}
              </summary>
              <form action={cancelAlert.bind(null, locale)} className="flex flex-col gap-3 pt-2">
                <input type="hidden" name="alert" value={a.id} />
                <label htmlFor={`cancel-note-${a.id}`} className={label}>
                  {t("cancel.reason")}
                </label>
                <input
                  id={`cancel-note-${a.id}`}
                  name="note"
                  required
                  maxLength={400}
                  className={input}
                />
                <p className={hint}>{t("cancel.hint")}</p>
                <button type="submit" className={buttonSecondary} data-cancel="true">
                  {t("cancel.send")}
                </button>
              </form>
            </details>
          </article>
        ))}
      </div>

      <h2 className="text-body font-bold text-jaga-ink">{t("ended.title")}</h2>
      {ended.length === 0 && <p className={hint}>{t("ended.none")}</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        {ended.map((a) => (
          <article key={a.id} className={card} data-ended={a.id}>
            {body(a)}
          </article>
        ))}
      </div>
    </div>
  );
}
