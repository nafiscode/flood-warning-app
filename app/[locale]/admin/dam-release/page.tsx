import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getFormatter, getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { DamReleaseForm } from "@/components/admin/DamReleaseForm";
import { readDamReleases } from "@/lib/admin-board";
import { getSessionProfile, isAdminRole } from "@/lib/auth";
import { damReleaseMessages } from "@/lib/messages";
import { bangkokValue } from "@/lib/dam-release";
import { readDamsForRelease } from "@/lib/dam-release-data";
import { createClient } from "@/lib/supabase/server";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { buttonSecondary, card, errorNotice, hint, notice } from "@/lib/ui";
import { cancelDamRelease, sendDamRelease } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/dam-release">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: t("damRelease.title") };
}

export const dynamic = "force-dynamic";

const ERRORS = ["form", "send", "cancel"] as const;

/** Six hours is the shortest promise worth making for a release that lasts days. */
const NEXT_UPDATE_H = 6;

/**
 * Sending the dam release notice (docs/spec.md section 15, phase A12).
 *
 * This is the screen the whole dam work has been building towards: the hourly feed grades the
 * figures, the war room raises a row, and here a person decides. Everything that can be settled in
 * advance has been - the words, the three languages, the zone from S7 and the arrival ranges from
 * the river gauges - so that what is left at the moment it matters is a judgement and a button.
 *
 * The layout above has already turned away everyone who is not an admin; the database function
 * checks it again and writes every send and every withdrawal to the access log.
 */
export default async function AdminDamRelease({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/dam-release">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const t = await getTranslations("admin");
  const ta = await getTranslations("alert");
  const format = await getFormatter();
  const error = ERRORS.find((e) => e === query.error);

  /*
   * The layout above turns away everyone who is not an admin, but a layout and its page render
   * side by side, so a visitor's request reaches this code too and the admin-only reads below
   * answer it with "permission denied" (seen in the server log, 13 Oct). Asking first keeps the
   * log honest; the database still checks every call for itself.
   */
  const session = await getSessionProfile();
  if (!session || !isAdminRole(session.role)) notFound();

  const supabase = await createClient();
  const [dams, inForce] = await Promise.all([readDamsForRelease(supabase), readDamReleases()]);

  const now = new Date();
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-h2 font-bold text-jaga-ink">{t("damRelease.title")}</h1>
        <p>{t("damRelease.lead")}</p>
      </div>

      {error && (
        <p className={errorNotice}>
          {t(error === "cancel" ? "damRelease.cancelFailed" : "damRelease.failed")}
        </p>
      )}
      {query.done === "sent" && (
        <p className={notice} role="status">
          {t("damRelease.sent", { time: format.dateTime(now, BANGKOK_DATE_TIME) })}
        </p>
      )}
      {query.done === "cancelled" && (
        <p className={notice} role="status">
          {t("damRelease.cancelled", { time: format.dateTime(now, BANGKOK_DATE_TIME) })}
        </p>
      )}

      <section className={card}>
        {/*
         * The form is drawn in the browser (it previews the notice as the figures are typed), so
         * it carries its own words: the admin layout above sends none to the browser.
         */}
        <NextIntlClientProvider messages={damReleaseMessages(await getMessages())}>
          <DamReleaseForm
            dams={dams}
            send={sendDamRelease.bind(null, locale)}
            nowValue={bangkokValue(now)}
            nextUpdateValue={bangkokValue(new Date(now.getTime() + NEXT_UPDATE_H * 3_600_000))}
          />
        </NextIntlClientProvider>
      </section>

      <section className={card} data-dam-release-live>
        <h2 className="text-h3 font-bold text-jaga-ink">{t("damRelease.inForce")}</h2>
        {inForce.length === 0 ? (
          <p className={hint}>{t("damRelease.inForceNone")}</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {inForce.map((row) => (
              <li key={row.alertId} className="flex flex-col gap-1 border-t border-jaga-line pt-3">
                <p className="font-medium">
                  {t("damRelease.inForceRow", {
                    level: ta(`level.${row.level}`),
                    cms: Math.round(row.releaseCms ?? 0),
                    time: row.gatesOpenAt
                      ? format.dateTime(new Date(row.gatesOpenAt), BANGKOK_DATE_TIME)
                      : "—",
                    tambons: row.tambons,
                  })}
                </p>
                <p className={hint}>
                  {t("damRelease.issuedBy", {
                    name: row.issuedBy ?? "—",
                    time: format.dateTime(new Date(row.issuedAt), BANGKOK_DATE_TIME),
                  })}
                </p>
                {row.cancelledAt ? (
                  <p className={hint}>
                    {t("damRelease.cancelled", {
                      time: format.dateTime(new Date(row.cancelledAt), BANGKOK_DATE_TIME),
                    })}
                  </p>
                ) : (
                  <form
                    action={cancelDamRelease.bind(null, locale)}
                    className="flex flex-col gap-1"
                  >
                    <input type="hidden" name="alert" value={row.alertId} />
                    <button type="submit" className={`${buttonSecondary} self-start`}>
                      {t("damRelease.cancel")}
                    </button>
                    <span className={hint}>{t("damRelease.cancelHint")}</span>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
