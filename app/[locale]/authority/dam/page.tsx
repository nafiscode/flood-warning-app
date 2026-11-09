import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getFormatter, getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { BackLink } from "@/components/BackLink";
import { DamReleaseForm } from "@/components/admin/DamReleaseForm";
import { getSessionProfile, localePath } from "@/lib/auth";
import { bangkokValue } from "@/lib/dam-release";
import {
  canEnd,
  canWithdraw,
  readMyOperatorDams,
  readOperatorDams,
  readOperatorReleases,
} from "@/lib/dam-operator";
import { damOperatorMessages } from "@/lib/messages";
import { PRIVATE_PAGE } from "@/lib/seo";
import { createClient } from "@/lib/supabase/server";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import {
  buttonSecondary,
  card,
  errorNotice,
  hint,
  input,
  label,
  notice,
} from "@/lib/ui";
import { endRelease, sendRelease, withdrawRelease } from "./actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "damOperator" });
  return { title: t("title"), ...PRIVATE_PAGE };
}

export const dynamic = "force-dynamic";

const ERRORS = ["form", "send", "end", "withdraw"] as const;
const DONE = ["sent", "sentDrill", "ended", "withdrawn"] as const;

/** Six hours is the shortest promise worth making for a release that lasts days. */
const NEXT_UPDATE_H = 6;

/**
 * The dam operator's one screen (docs/spec.md section 15, A12 part 2, built 9 Nov 2026).
 *
 * Spec 15 gave the operator exactly one power the other units lack, and this page is it. The
 * people who open the gates send the notice themselves, because they know minutes or hours before
 * the hourly feed does, and those minutes are the warning.
 *
 * Three things are worth knowing about how it is built:
 *
 *   * it is the same form the admins use, on purpose. What the operator reads before pressing the
 *     button is the same notice, from the same template, over the same zone;
 *   * nothing on this page decides who may send. `my_operator_dams()` answers with the dams this
 *     account holds through a link an admin made, and every action is checked again in the
 *     database. Someone who reaches this URL without a dam is shown how to register and nothing
 *     else;
 *   * the drill switch sends down the whole real road to Jaga's admins alone, so this can be
 *     demonstrated in a control room without a soul outside Jaga hearing it.
 */
export default async function DamOperatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const session = await getSessionProfile();
  if (!session) {
    redirect(`${localePath(locale, "/sign-in")}?next=${localePath(locale, "/authority/dam")}`);
  }

  const t = await getTranslations("damOperator");
  const tNav = await getTranslations("nav");
  const ta = await getTranslations("alert");
  const format = await getFormatter();
  const error = ERRORS.find((e) => e === query.error);
  const done = DONE.find((d) => d === query.done);

  const supabase = await createClient();
  const mine = await readMyOperatorDams(supabase);

  // Not an operator, or an operator an admin has not tied to a dam yet. Either way there is
  // nothing here to use, and saying so plainly beats an empty form.
  if (mine.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink href="/authority" label={tNav("backBoard")} />
        <section className={card} data-dam-operator="not-linked">
          <h1 className="text-h3 font-bold text-jaga-ink">{t("notLinked.title")}</h1>
          <p>{t("notLinked.body")}</p>
          <a href={localePath(locale, "/authority/register")} className={buttonSecondary}>
            {t("notLinked.register")}
          </a>
        </section>
      </div>
    );
  }

  const [dams, releases] = await Promise.all([
    readOperatorDams(supabase, mine),
    readOperatorReleases(supabase),
  ]);

  const now = new Date();
  const nowValue = bangkokValue(now);
  const nextUpdateValue = bangkokValue(new Date(now.getTime() + NEXT_UPDATE_H * 3_600_000));
  const at = (iso: string) => format.dateTime(new Date(iso), BANGKOK_DATE_TIME);

  return (
    <div className="flex flex-col gap-6" data-dam-operator="true">
      <BackLink href="/authority" label={tNav("backBoard")} />

      <div className="flex flex-col gap-2">
        <h1 className="text-h2 font-bold text-jaga-ink">{t("title")}</h1>
        <p>{t("lead")}</p>
        <p className={hint}>{t("unit", { unit: mine[0]!.unitName })}</p>
        <p className={hint}>{t("adminsTold")}</p>
      </div>

      {error && (
        <p className={errorNotice}>
          {t(error === "end" ? "endFailed" : error === "withdraw" ? "withdrawFailed" : "failed")}
        </p>
      )}
      {done && (
        <p className={notice} role="status" data-dam-operator-done={done}>
          {t(done, { time: format.dateTime(now, BANGKOK_DATE_TIME) })}
        </p>
      )}

      <section className={card}>
        {dams.length === 0 ? (
          <p className={hint}>{t("noZone")}</p>
        ) : (
          /*
           * The form previews the notice as the figures are typed, so it is drawn in the browser
           * and carries its own words.
           */
          <NextIntlClientProvider messages={damOperatorMessages(await getMessages())}>
            <DamReleaseForm
              dams={dams}
              send={sendRelease.bind(null, locale)}
              variant="operator"
              operatorSend={t("send")}
              operatorSendDrill={t("sendDrill")}
              nowValue={nowValue}
              nextUpdateValue={nextUpdateValue}
            />
          </NextIntlClientProvider>
        )}
      </section>

      <section className={card} data-dam-operator-live>
        <h2 className="text-h3 font-bold text-jaga-ink">{t("inForce")}</h2>
        {releases.length === 0 ? (
          <p className={hint}>{t("inForceNone")}</p>
        ) : (
          <ul className="flex flex-col gap-5">
            {releases.map((row) => (
              <li
                key={row.alertId}
                className="flex flex-col gap-2 border-t border-jaga-line pt-3"
                data-dam-release-row={row.alertId}
              >
                <p className="font-medium">
                  {row.kind === "dam_release_end"
                    ? t("endedRow", {
                        time: row.gatesClosedAt ? at(row.gatesClosedAt) : "—",
                        level: ta(`level.${row.level}`),
                        tambons: row.tambons,
                      })
                    : t("inForceRow", {
                        level: ta(`level.${row.level}`),
                        cms: Math.round(row.releaseCms ?? 0),
                        time: row.gatesOpenAt ? at(row.gatesOpenAt) : "—",
                        tambons: row.tambons,
                      })}
                </p>
                <p className={hint}>{t("issuedAt", { time: at(row.issuedAt) })}</p>
                {/* Brand ink, never an alert colour: a drill mark must not read as a level. */}
                {row.isDrill && (
                  <p
                    data-dam-release-drill-mark="true"
                    className="self-start rounded-xl border-2 border-jaga-slate px-3 py-1 text-small font-bold uppercase tracking-wide text-jaga-slate"
                  >
                    {t("drillBadge")}
                  </p>
                )}
                {!row.mine && <p className={hint}>{t("byAdmin")}</p>}
                {row.cancelledAt && (
                  <p className={hint}>{t("cancelledAt", { time: at(row.cancelledAt) })}</p>
                )}

                {/*
                 * "The gates have closed." It supersedes the notice at the same level, because
                 * the water already released is still coming: the database is where that rule
                 * lives, and the hint below says so to the person pressing it.
                 */}
                {canEnd(row) && (
                  <form
                    action={endRelease.bind(null, locale)}
                    className="flex flex-col gap-2 pt-1"
                    data-dam-release-end
                  >
                    <input type="hidden" name="alert" value={row.alertId} />
                    <input type="hidden" name="dam" value={row.damCode} />
                    <input type="hidden" name="nextUpdate" value={nextUpdateValue} />
                    <label className={label} htmlFor={`closedAt-${row.alertId}`}>
                      {t("endAt")}
                    </label>
                    <input
                      id={`closedAt-${row.alertId}`}
                      name="closedAt"
                      type="datetime-local"
                      required
                      className={input}
                      defaultValue={nowValue}
                    />
                    <button type="submit" className={`${buttonSecondary} self-start`}>
                      {t("end")}
                    </button>
                    <span className={hint}>{t("endHint")}</span>
                  </form>
                )}

                {canWithdraw(row) && (
                  <form
                    action={withdrawRelease.bind(null, locale)}
                    className="flex flex-col gap-1 pt-1"
                    data-dam-release-withdraw
                  >
                    <input type="hidden" name="alert" value={row.alertId} />
                    <button type="submit" className={`${buttonSecondary} self-start`}>
                      {t("withdraw")}
                    </button>
                    <span className={hint}>{t("withdrawHint")}</span>
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
