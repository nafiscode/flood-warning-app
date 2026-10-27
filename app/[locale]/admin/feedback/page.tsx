import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { DualTime } from "@/components/admin/DualTime";
import { FeedbackContact } from "@/components/admin/FeedbackContact";
import { Bars, type Bar } from "@/components/feedback/Bars";
import { Link } from "@/i18n/navigation";
import { isAdminHere } from "@/lib/admin-guard";
import {
  readFeedback,
  readFeedbackOutcomes,
  readFeedbackTrends,
  type FeedbackRow,
} from "@/lib/admin-feedback";
import {
  FEEDBACK_STATUSES,
  IMPROVE,
  outcomeText,
  PUBLIC_STATUSES,
  type PublicStatus,
} from "@/lib/feedback";
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
import { publishFeedback, saveFeedbackOutcome, triageFeedback } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/feedback">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "adminFeedback" });
  return { title: t("title") };
}

export const dynamic = "force-dynamic";

/**
 * /admin/feedback (A15, spec 17 item 7): every item people sent, what was done about it, and the
 * queue of comments waiting for a yes or a no.
 *
 * **The approval queue is the part that matters.** A comment is invisible to the public until an
 * admin says yes, and the rules for saying no are printed on the screen rather than kept in a
 * document: anything asserting a fact about flooding, water levels or whether an area is safe -
 * even if it is true - and anything carrying a phone number, an address, a plate, a named person
 * or one SOS case stays admins-only. A page of Jaga's own must not carry an unchecked claim about
 * the water (safety rules 3, 6 and 8).
 *
 * Nothing on this page edits a word anybody wrote. An admin triages, approves, refuses, takes an
 * approved one back off the page, and writes what Jaga did about a weak point.
 *
 * Trends carry no floor under them, unlike the public page: an admin needs the figure they can
 * act on, and the count is printed beside it so a small one reads as small.
 */
export default async function AdminFeedback({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/feedback">) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await isAdminHere())) return null;
  const query = await searchParams;
  const t = await getTranslations("adminFeedback");
  const tFeedback = await getTranslations("feedback");

  const status = FEEDBACK_STATUSES.find((s) => s === query.status) ?? null;
  const publicStatus = PUBLIC_STATUSES.find((s) => s === query.public) ?? null;
  const days = Number(query.days) > 0 ? Math.min(Number(query.days), 1825) : 365;
  const back = new URLSearchParams();
  if (status) back.set("status", status);
  if (publicStatus) back.set("public", publicStatus);
  if (days !== 365) back.set("days", String(days));
  const backQuery = back.toString();

  const [rows, trends, outcomes] = await Promise.all([
    readFeedback({ status, publicStatus, days }),
    readFeedbackTrends(12),
    readFeedbackOutcomes(),
  ]);

  const chipWord = (list: "liked" | "improve", code: string) => {
    const key = `chips.${list}.${code}` as const;
    return tFeedback.has(key) ? tFeedback(key) : code;
  };
  const filterHref = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(backQuery);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    const q = next.toString();
    return `/admin/feedback${q ? `?${q}` : ""}`;
  };

  return (
    <div className="flex flex-col gap-6" data-admin-feedback={rows.length}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
      <p className={hint}>{t("intro")}</p>

      {query.error && (
        <p role="alert" className={errorNotice}>
          {t("error.save")}
        </p>
      )}
      {query.saved && (
        <p role="status" className={notice}>
          {t("triage.saved")}
        </p>
      )}

      {/* ── What is waiting, and the filters ───────────────────────────── */}
      {trends && trends.waitingPublic > 0 && (
        <p className={notice} data-feedback-waiting={trends.waitingPublic}>
          <Link href={filterHref({ public: "pending" })} className="font-medium underline">
            {t("trends.waitingPublic", { count: trends.waitingPublic })}
          </Link>
        </p>
      )}

      <nav className="flex flex-col gap-2" aria-label={t("filters.title")}>
        <p className={`${label} ${hint}`}>{t("filters.status")}</p>
        <div className="flex flex-wrap gap-x-4">
          <Filter href={filterHref({ status: null })} on={status === null} word={t("filters.all")} />
          {FEEDBACK_STATUSES.map((s) => (
            <Filter
              key={s}
              href={filterHref({ status: s })}
              on={status === s}
              word={t(`status.${s}`)}
            />
          ))}
        </div>
        <p className={`${label} ${hint}`}>{t("filters.public")}</p>
        <div className="flex flex-wrap gap-x-4">
          <Filter href={filterHref({ public: null })} on={publicStatus === null} word={t("filters.all")} />
          {PUBLIC_STATUSES.map((s) => (
            <Filter
              key={s}
              href={filterHref({ public: s })}
              on={publicStatus === s}
              word={t(`publicStatus.${s}`)}
            />
          ))}
        </div>
      </nav>

      <p>
        <a
          href={`/api/admin/feedback-export?days=${days}`}
          className={buttonSecondary}
          data-feedback-export="true"
        >
          {t("export.csv")}
        </a>
        <span className={`block ${hint}`}>{t("export.hint")}</span>
      </p>

      {/* ── The rules for saying no, on the screen ─────────────────────── */}
      <section className={card} data-feedback-rules="true">
        <h2 className="font-bold text-jaga-ink">{t("publish.title")}</h2>
        <p>{t("publish.rules")}</p>
      </section>

      {/* ── The items ──────────────────────────────────────────────────── */}
      <p className={hint}>{t("count", { count: rows.length })}</p>
      {rows.length === 0 && <p className="font-medium">{t("none")}</p>}
      <NextIntlClientProvider messages={{ adminFeedback: (await getMessages()).adminFeedback! }}>
        <div className="grid gap-5 lg:grid-cols-2">
          {rows.map((row) => (
            <Item
              key={row.id}
              row={row}
              locale={locale}
              backQuery={backQuery}
              t={t}
              chipWord={chipWord}
            />
          ))}
        </div>
      </NextIntlClientProvider>

      {/* ── Trends ─────────────────────────────────────────────────────── */}
      {trends && (
        <section className="flex flex-col gap-4" data-feedback-trends="true">
          <h2 className="text-h3 font-bold text-jaga-ink">{t("trends.title")}</h2>
          <div className={`${card} sm:flex-row sm:gap-8`}>
            <p className="flex flex-col">
              <span className={hint}>{t("trends.average")}</span>
              <span className="text-h2 font-bold tabular-nums text-jaga-ink">
                {trends.average?.toFixed(2) ?? t("trends.noFigure")}
              </span>
            </p>
            <p className="flex flex-col">
              <span className={hint}>{t("trends.answers")}</span>
              <span className="text-h2 font-bold tabular-nums text-jaga-ink">
                {trends.answers}
              </span>
            </p>
          </div>

          <div className={card}>
            <h3 className="font-bold text-jaga-ink">{t("trends.byMonth")}</h3>
            <Bars bars={ratingBars(trends.byMonth.map((m) => ({ name: m.month, ...m })), t)} />
          </div>
          <div className={card}>
            {/* Worst first: the lowest-rated screen is the one to go and look at. */}
            <h3 className="font-bold text-jaga-ink">{t("trends.byScreen")}</h3>
            <Bars bars={ratingBars(trends.byScreen.map((s) => ({ name: s.screen, ...s })), t)} />
          </div>
          <div className={card}>
            <h3 className="font-bold text-jaga-ink">{t("trends.byLocale")}</h3>
            <Bars bars={ratingBars(trends.byLocale.map((l) => ({ name: l.locale, ...l })), t)} />
          </div>
          <div className={card}>
            <h3 className="font-bold text-jaga-ink">{t("trends.byRole")}</h3>
            <Bars
              bars={ratingBars(
                trends.byRole.map((r) => ({ name: r.role, answers: r.answers, average: r.average })),
                t,
              )}
            />
          </div>
          <div className={card}>
            <h3 className="font-bold text-jaga-ink">{t("trends.liked")}</h3>
            <Bars bars={countBars(trends.liked, (c) => chipWord("liked", c))} />
          </div>
          <div className={card}>
            <h3 className="font-bold text-jaga-ink">{t("trends.improve")}</h3>
            <Bars
              bars={countBars(trends.improve, (c) => chipWord("improve", c)).map((bar, i) => ({
                ...bar,
                note: outcomeText(trends.improve[i]?.done, locale) ?? undefined,
              }))}
            />
          </div>
        </section>
      )}

      {/* ── What was done about each weak point ────────────────────────── */}
      <section className="flex flex-col gap-4" data-feedback-outcomes="true">
        <h2 className="text-h3 font-bold text-jaga-ink">{t("outcomes.title")}</h2>
        <p className={hint}>{t("outcomes.intro")}</p>
        <div className="grid gap-5 lg:grid-cols-2">
          {IMPROVE.filter((code) => code !== "other").map((code) => {
            const saved = outcomes.find((o) => o.code === code);
            return (
              <form
                key={code}
                action={saveFeedbackOutcome.bind(null, locale)}
                className={card}
                data-outcome={code}
              >
                <input type="hidden" name="code" value={code} />
                <input type="hidden" name="back" value={backQuery} />
                <h3 className="font-bold text-jaga-ink">{chipWord("improve", code)}</h3>
                {!saved && <p className={hint}>{t("outcomes.none")}</p>}
                {(["th", "ms", "en"] as const).map((lang) => (
                  <label key={lang} className="flex flex-col gap-1">
                    <span className={label}>{t(`outcomes.${lang}`)}</span>
                    <input
                      name={lang}
                      defaultValue={saved?.note[lang] ?? ""}
                      maxLength={500}
                      className={input}
                    />
                  </label>
                ))}
                <label className="flex flex-col gap-1">
                  <span className={label}>{t("outcomes.changeRef")}</span>
                  <input
                    name="changeRef"
                    defaultValue={saved?.changeRef ?? ""}
                    maxLength={200}
                    className={input}
                  />
                </label>
                <button type="submit" className={buttonSecondary}>
                  {t("outcomes.save")}
                </button>
              </form>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function Filter({ href, on, word }: { href: string; on: boolean; word: string }) {
  return (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`inline-flex min-h-tap items-center underline ${on ? "font-bold" : ""}`}
    >
      {word}
    </Link>
  );
}

type Translate = Awaited<ReturnType<typeof getTranslations<"adminFeedback">>>;

/** One item: what was sent, what the app knew, the triage form and the public-page decision. */
function Item({
  row,
  locale,
  backQuery,
  t,
  chipWord,
}: {
  row: FeedbackRow;
  locale: string;
  backQuery: string;
  t: Translate;
  chipWord: (list: "liked" | "improve", code: string) => string;
}) {
  const district =
    (locale === "th" ? row.districtTh : row.districtEn) ?? row.districtCode ?? null;
  const facts = [
    row.screen && `${t("row.screen")}: ${row.screen}`,
    row.locale && `${t("row.locale")}: ${row.locale}`,
    row.deviceKind && `${t("row.device")}: ${row.deviceKind}`,
    row.appVersion && `${t("row.version")}: ${row.appVersion}`,
    district && `${t("row.district")}: ${district}`,
    row.roleAtTime && `${t("row.role")}: ${row.roleAtTime}`,
    row.moment && t.has(`moments.${row.moment}`)
      ? `${t("row.moment")}: ${t(`moments.${row.moment}`)}`
      : null,
    row.sosId && `${t("row.case")}: ${row.sosId.slice(0, 8)}`,
    row.signedIn ? t("row.signedIn") : t("row.anonymous"),
  ].filter(Boolean) as string[];

  // Approve is offered only where the sender asked for it; refuse and hide are the other two.
  const decisions: PublicStatus[] =
    row.publicStatus === "approved" ? ["refused"] : row.publicOk ? ["approved", "refused"] : [];

  return (
    <article className={card} data-feedback={row.id} data-feedback-status={row.status}>
      <p className="font-bold text-jaga-ink">
        {row.rating === null ? t("row.noRating") : t("row.rating", { rating: row.rating })}
        <span className={`block font-normal ${hint}`}>
          <DualTime iso={row.createdAt} /> · {t(`status.${row.status}`)} ·{" "}
          {t(`publicStatus.${row.publicStatus}`)}
        </span>
      </p>

      {(row.liked.length > 0 || row.likedNote) && (
        <div>
          <h3 className="text-small font-bold uppercase tracking-wide text-jaga-text-2">
            {t("row.liked")}
          </h3>
          {row.liked.length > 0 && (
            <p className={hint}>{row.liked.map((c) => chipWord("liked", c)).join(" · ")}</p>
          )}
          {row.likedNote && <p className="whitespace-pre-wrap">{row.likedNote}</p>}
        </div>
      )}
      {(row.improve.length > 0 || row.improveNote) && (
        <div>
          <h3 className="text-small font-bold uppercase tracking-wide text-jaga-text-2">
            {t("row.improve")}
          </h3>
          {row.improve.length > 0 && (
            <p className={hint}>{row.improve.map((c) => chipWord("improve", c)).join(" · ")}</p>
          )}
          {row.improveNote && <p className="whitespace-pre-wrap">{row.improveNote}</p>}
        </div>
      )}
      {row.message && (
        <div>
          <h3 className="text-small font-bold uppercase tracking-wide text-jaga-text-2">
            {t("row.message")}
          </h3>
          <p className="whitespace-pre-wrap">{row.message}</p>
        </div>
      )}

      <p className={hint}>{facts.join(" · ")}</p>
      {row.anonymisedAt && (
        <p className={hint}>
          {t("row.anonymised", { date: row.anonymisedAt.slice(0, 10) })}
        </p>
      )}

      {/* The contact, behind a tap that is logged (safety rule 5). */}
      {row.hasContact ? (
        <>
          <p className={hint}>{t("contact.has")}</p>
          <FeedbackContact id={row.id} />
        </>
      ) : (
        <p className={hint}>{t("contact.none")}</p>
      )}

      {/* Triage */}
      <form action={triageFeedback.bind(null, locale)} className="flex flex-col gap-2">
        <input type="hidden" name="feedback" value={row.id} />
        <input type="hidden" name="back" value={backQuery} />
        <h3 className="font-bold text-jaga-ink">{t("triage.title")}</h3>
        <label className="flex flex-col gap-1">
          <span className={label}>{t("filters.status")}</span>
          <select name="status" defaultValue={row.status} className={input}>
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>{t("triage.note")}</span>
          <input name="note" defaultValue={row.adminNote ?? ""} maxLength={1000} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>{t("triage.changeRef")}</span>
          <input
            name="changeRef"
            defaultValue={row.changeRef ?? ""}
            maxLength={200}
            className={input}
          />
          <span className={hint}>{t("triage.changeRefHint")}</span>
        </label>
        <p className={hint}>{t("triage.closes")}</p>
        <button type="submit" className={buttonSecondary} data-triage={row.id}>
          {t("triage.save")}
        </button>
      </form>

      {/* The public page */}
      <div className="flex flex-col gap-2">
        <h3 className="font-bold text-jaga-ink">{t("publish.title")}</h3>
        {row.publicOk ? (
          <p className={hint}>
            {t("row.displayName")}: {row.displayName ?? t("row.noName")}
          </p>
        ) : (
          <p className={hint}>{t("publish.notOffered")}</p>
        )}
        {decisions.map((to) => (
          <form key={to} action={publishFeedback.bind(null, locale)}>
            <input type="hidden" name="feedback" value={row.id} />
            <input type="hidden" name="back" value={backQuery} />
            <input type="hidden" name="to" value={to} />
            <button
              type="submit"
              className={to === "approved" ? buttonPrimary : buttonSecondary}
              data-publish={to}
            >
              {to === "approved"
                ? t("publish.approve")
                : row.publicStatus === "approved"
                  ? t("publish.hide")
                  : t("publish.refuse")}
            </button>
          </form>
        ))}
      </div>
    </article>
  );
}

/** A row per period: the average on the 1-to-5 scale, with the count of answers beside it. */
function ratingBars(
  rows: { name: string; answers: number; average: number | null }[],
  t: Translate,
): Bar[] {
  return rows.map((row) => ({
    key: row.name,
    label: row.name,
    share: row.average === null ? null : (row.average - 1) / 4,
    value: `${row.average?.toFixed(2) ?? ""} / 5`,
    note: `${t("trends.answers")}: ${row.answers}`,
    emptyNote: `${t("trends.noFigure")} · ${t("trends.answers")}: ${row.answers}`,
  }));
}

/** A row per chip: how many people ticked it, against the most-ticked one. */
function countBars(
  rows: { code: string; count: number }[],
  word: (code: string) => string,
): Bar[] {
  const top = Math.max(1, ...rows.map((r) => r.count));
  return rows.map((row) => ({
    key: row.code,
    label: word(row.code),
    share: row.count / top,
    value: String(row.count),
  }));
}
