import { getTranslations } from "next-intl/server";
import { Bars, type Bar } from "@/components/feedback/Bars";
import { answersShort, outcomeText, type PublicFigures as Figures } from "@/lib/feedback";
import { card, hint, notice } from "@/lib/ui";

/**
 * Jaga's own figures, published with the unflattering ones (spec 17, the discipline of section 16):
 * the average rating and the number of answers, the trend by month, what people most often say
 * they love, and - the honest half - what they say should be better, named, counted and beside
 * what was done about each.
 *
 * **The floor is the point.** Under 20 answers in the period nothing is published at all: the
 * page says how many more it needs instead of showing a number. An average of 4.6 from seven
 * answers is a mood, and a page of Jaga's own must not dress one up as a measurement. The same
 * floor is applied per month, which is why some months show words where others show a bar.
 */
export async function PublicFigures({
  figures,
  locale,
}: {
  figures: Figures;
  locale: string;
}) {
  const t = await getTranslations("feedback");
  const short = answersShort(figures);

  const monthName = (month: string) => {
    const [year, m] = month.split("-");
    const date = new Date(Date.UTC(Number(year), Number(m) - 1, 1));
    return new Intl.DateTimeFormat(locale === "ms" ? "ms-MY" : locale, {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  };

  const months: Bar[] = figures.months.map((m) => ({
    key: m.month,
    label: monthName(m.month),
    // The average on a 1-to-5 scale, as a share of the track. A month under the floor has no bar.
    share: m.average === null ? null : (m.average - 1) / 4,
    value: `${m.average?.toFixed(1) ?? ""} / 5`,
    note: m.average === null ? null : t("figures.answers", { count: m.answers }),
    emptyNote: `${t("figures.monthShort")} · ${t("figures.answers", { count: m.answers })}`,
  }));

  const topLiked = Math.max(1, ...figures.liked.map((c) => c.count));
  const liked: Bar[] = figures.liked.map((c) => ({
    key: c.code,
    label: chipWord(t, "liked", c.code),
    share: c.count / topLiked,
    value: t("figures.people", { count: c.count }),
  }));

  const topImprove = Math.max(1, ...figures.improve.map((c) => c.count));
  const improve: Bar[] = figures.improve.map((c) => {
    const done = outcomeText(c.done, locale);
    return {
      key: c.code,
      label: chipWord(t, "improve", c.code),
      share: c.count / topImprove,
      value: t("figures.people", { count: c.count }),
      note: done
        ? c.changeRef
          ? `${done} ${t("figures.changeRef", { ref: c.changeRef })}`
          : done
        : t("figures.doneNothing"),
    };
  });

  return (
    <section className="flex flex-col gap-4" data-feedback-figures={figures.enough ? "on" : "off"}>
      <h2 className="text-h3 font-bold text-jaga-ink">{t("figures.title")}</h2>
      <p className={hint}>{t("figures.lead")}</p>

      {!figures.enough ? (
        <p className={notice} data-figures-short={short}>
          {t("figures.notEnough", { count: short, min: figures.minAnswers })}
        </p>
      ) : (
        <>
          <div className={`${card} sm:flex-row sm:items-baseline sm:gap-8`}>
            <p className="flex flex-col">
              <span className={hint}>{t("figures.average")}</span>
              <span className="text-h1 font-bold tabular-nums text-jaga-ink">
                {figures.average?.toFixed(1)}
                <span className={`ms-2 text-body font-normal ${hint}`}>{t("figures.outOf")}</span>
              </span>
            </p>
            <p className="flex flex-col">
              <span className={hint}>{t("figures.answers", { count: figures.answers })}</span>
            </p>
          </div>

          {months.length > 0 && (
            <div className={card}>
              <h3 className="font-bold text-jaga-ink">{t("figures.monthsTitle")}</h3>
              <Bars bars={months} />
            </div>
          )}

          {liked.length > 0 && (
            <div className={card}>
              <h3 className="font-bold text-jaga-ink">{t("figures.likedTitle")}</h3>
              <Bars bars={liked} />
            </div>
          )}

          {improve.length > 0 && (
            <div className={card} data-figures-improve="true">
              <h3 className="font-bold text-jaga-ink">{t("figures.improveTitle")}</h3>
              <p className={hint}>{t("figures.improveLead")}</p>
              <Bars bars={improve} />
            </div>
          )}
        </>
      )}
    </section>
  );
}

/**
 * A chip's words, or its bare code where the list no longer has it. A code that has been retired
 * still carries its count, so the page shows it rather than dropping a figure people gave.
 */
function chipWord(
  t: Awaited<ReturnType<typeof getTranslations<"feedback">>>,
  list: "liked" | "improve",
  code: string,
): string {
  const key = `chips.${list}.${code}` as const;
  return t.has(key) ? t(key) : code;
}
