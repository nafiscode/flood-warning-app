import { getTranslations } from "next-intl/server";
import { FaceIcon } from "@/components/icons";
import type { PublicComment } from "@/lib/feedback";
import { card, hint, notice } from "@/lib/ui";

/**
 * The approved comments (spec 17). Four things reach this list and nothing else: the display name
 * the sender chose (absent means anonymous), their two notes, and the chips they ticked. No
 * district, no role, no device, no language, no contact, no case - and only the month, never the
 * moment, because the finest grain Jaga publishes is the service area by month.
 *
 * Above the list, in words: these are opinions of the app, not flood information. The list wears
 * no alert colour, no level and no hazard icon, and nothing here is ever quoted on an alert, the
 * map or the home screen (safety rules 3, 6 and 8).
 *
 * The rating is drawn as its face and written as a number out of five - the same pair the form
 * uses, so it is never a colour or a count of stars alone.
 */
export async function PublicComments({
  comments,
  locale,
}: {
  comments: PublicComment[];
  locale: string;
}) {
  const t = await getTranslations("feedback");
  const monthName = (month: string) => {
    const [year, m] = month.split("-");
    const date = new Date(Date.UTC(Number(year), Number(m) - 1, 1));
    return new Intl.DateTimeFormat(locale === "ms" ? "ms-MY" : locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(date);
  };
  const chipWord = (list: "liked" | "improve", code: string) => {
    const key = `chips.${list}.${code}` as const;
    return t.has(key) ? t(key) : code;
  };

  return (
    <section className="flex flex-col gap-4" data-feedback-comments={comments.length}>
      <h2 className="text-h3 font-bold text-jaga-ink">{t("comments.title")}</h2>
      {/* The line spec 17 requires above the list. It is not a hint: it is the page's disclaimer. */}
      <p className={notice}>{t("comments.notFlood")}</p>
      <p className={hint}>{t("comments.moderated")}</p>

      {comments.length === 0 ? (
        <p className="font-medium">{t("comments.none")}</p>
      ) : (
        <ul className="flex flex-col gap-4 lg:grid lg:grid-cols-2">
          {comments.map((comment) => (
            <li key={comment.id} className={card} data-comment={comment.id}>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-bold text-jaga-ink">
                  {comment.displayName ?? t("comments.anonymous")}
                </span>
                <span className={hint}>{monthName(comment.month)}</span>
                {comment.rating !== null && (
                  <span className="inline-flex items-center gap-1 text-jaga-text-2">
                    <FaceIcon mood={comment.rating} size={20} />
                    <span className="text-small tabular-nums">{comment.rating} / 5</span>
                  </span>
                )}
              </p>

              {/* Both halves under their own small headings (the owner's drawing, 16 Oct). */}
              {(comment.likedNote || comment.liked.length > 0) && (
                <div>
                  <h3 className="text-small font-bold uppercase tracking-wide text-jaga-text-2">
                    {t("comments.likedHead")}
                  </h3>
                  {comment.liked.length > 0 && (
                    <p className={hint}>
                      {comment.liked.map((code) => chipWord("liked", code)).join(" · ")}
                    </p>
                  )}
                  {comment.likedNote && (
                    <p className="mt-1 whitespace-pre-wrap">{comment.likedNote}</p>
                  )}
                </div>
              )}

              {(comment.improveNote || comment.improve.length > 0) && (
                <div>
                  <h3 className="text-small font-bold uppercase tracking-wide text-jaga-text-2">
                    {t("comments.improveHead")}
                  </h3>
                  {comment.improve.length > 0 && (
                    <p className={hint}>
                      {comment.improve.map((code) => chipWord("improve", code)).join(" · ")}
                    </p>
                  )}
                  {comment.improveNote && (
                    <p className="mt-1 whitespace-pre-wrap">{comment.improveNote}</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
