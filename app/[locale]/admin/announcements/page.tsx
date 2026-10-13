import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AreaTree } from "@/components/admin/AreaTree";
import { DualTime } from "@/components/admin/DualTime";
import { readAreas } from "@/lib/admin-alerts";
import { isAdminHere } from "@/lib/admin-guard";
import { ANNOUNCE_HOURS, readAnnouncements } from "@/lib/admin-tools";
import {
  buttonPrimary,
  buttonSecondary,
  card,
  checkBox,
  checkRow,
  errorNotice,
  hint,
  input,
  label,
  notice,
} from "@/lib/ui";
import { cancelAnnouncement, postAnnouncement } from "../tools-actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/announcements">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "adminTools" });
  return { title: t("announce.title") };
}

export const dynamic = "force-dynamic";

const ERRORS = ["thai", "area", "save"] as const;
const DONE = ["posted", "cancelled"] as const;

/**
 * Announcements (the bell's "a word from the admins"): a service notice, a change of hotline,
 * "the map is slow tonight". Never a hazard and never a level - an alert is published from the
 * alert console, from a reviewed template. The text here is written by the admin in each
 * language; nothing is translated by a machine, and a language left empty is simply not sent
 * (readers of it see the Thai).
 */
export default async function Announcements({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/announcements">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  if (!(await isAdminHere())) return null;
  const t = await getTranslations("adminTools");
  const [list, areas] = await Promise.all([readAnnouncements(), readAreas()]);
  const error = ERRORS.find((e) => e === query.error);
  const done = DONE.find((d) => d === query.done);

  return (
    <div className="flex flex-col gap-5" data-announcements={list.length}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("announce.title")}</h1>
      <p className={hint}>{t("announce.intro")}</p>
      <p className={errorNotice}>{t("announce.notAnAlert")}</p>
      {done && (
        <p role="status" className={notice}>
          {t(`announce.done.${done}`)}
        </p>
      )}
      {error && (
        <p role="alert" className={errorNotice}>
          {t(`announce.error.${error}`)}
        </p>
      )}

      <form action={postAnnouncement.bind(null, locale)} className={card}>
        <h2 className="text-body font-bold">{t("announce.new")}</h2>
        {(["th", "ms", "en"] as const).map((lang) => (
          <div key={lang} className="flex flex-col gap-1">
            <label htmlFor={`text-${lang}`} className={label}>
              {t(`announce.text.${lang}`)}
            </label>
            <textarea
              id={`text-${lang}`}
              name={lang}
              lang={lang}
              required={lang === "th"}
              maxLength={600}
              rows={3}
              className={input}
            />
          </div>
        ))}
        <p className={hint}>{t("announce.textHint")}</p>
        <label htmlFor="hours" className={label}>
          {t("announce.until")}
        </label>
        <select id="hours" name="hours" defaultValue="24" className={input}>
          {ANNOUNCE_HOURS.map((hours) => (
            <option key={hours} value={hours}>
              {hours === 0 ? t("announce.untilWithdrawn") : t("announce.hours", { hours })}
            </option>
          ))}
        </select>
        <fieldset className="flex flex-col">
          <legend className={label}>{t("announce.who")}</legend>
          <label className={checkRow}>
            <input type="radio" name="scope" value="all" defaultChecked className={checkBox} />
            <span>{t("announce.everyone")}</span>
          </label>
          <label className={checkRow}>
            <input type="radio" name="scope" value="area" className={checkBox} />
            <span>{t("announce.someAreas")}</span>
          </label>
          <details>
            <summary className="min-h-tap cursor-pointer py-2 text-jaga-teal-ink underline">
              {t("announce.chooseAreas")}
            </summary>
            <AreaTree areas={areas} locale={locale} />
          </details>
        </fieldset>
        <button type="submit" className={buttonPrimary} data-post-announcement="true">
          {t("announce.send")}
        </button>
      </form>

      <h2 className="text-body font-bold text-jaga-ink">{t("announce.list")}</h2>
      {list.length === 0 && <p className={hint}>{t("announce.none")}</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        {list.map((a) => {
          const state = a.state;
          return (
            <article key={a.id} className={card} data-announcement={a.id} data-state={state}>
              <p className="font-bold text-jaga-ink">{t(`announce.state.${state}`)}</p>
              <p lang={a.messages[locale] ? locale : "th"} className="whitespace-pre-wrap">
                {a.messages[locale] ?? a.messages.th}
              </p>
              <p className={hint}>
                <DualTime iso={a.startsAt} />
                {a.endsAt && (
                  <>
                    {" – "}
                    <DualTime iso={a.endsAt} />
                  </>
                )}
                {" · "}
                {a.tambons === null
                  ? t("announce.everyone")
                  : t("announce.tambons", { count: a.tambons })}
                {" · "}
                {Object.keys(a.messages).join(", ")}
              </p>
              {state === "live" && (
                <form action={cancelAnnouncement.bind(null, locale)}>
                  <input type="hidden" name="announcement" value={a.id} />
                  <button type="submit" className={buttonSecondary} data-cancel-announcement="true">
                    {t("announce.cancel")}
                  </button>
                </form>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
