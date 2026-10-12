import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DualTime } from "@/components/admin/DualTime";
import { readPointsLedger } from "@/lib/admin-board";
import { livePoints } from "@/lib/coverage";
import { buttonSecondary, card, errorNotice, hint, input, label, notice } from "@/lib/ui";
import { revokePoints } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/points">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: t("points.title") };
}

export const dynamic = "force-dynamic";

const ERRORS = ["reason", "gone", "save"] as const;

/**
 * The points ledger (spec 5.5): every award the database made when a rescue was confirmed, and
 * the one thing an admin may do to it - take an award back, with a reason. Nothing is edited and
 * nothing is deleted; a revoked row stays on the page, struck out, with why.
 *
 * The layout above has turned away everyone who is not an admin; the database functions check it
 * again.
 */
export default async function AdminPoints({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/points">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const t = await getTranslations("admin");
  const rows = await readPointsLedger();
  const error = ERRORS.find((e) => e === query.error);

  return (
    <div className="flex flex-col gap-5" data-points-ledger={rows.length}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("points.title")}</h1>
      <p className={hint}>{t("points.intro")}</p>
      {query.done === "revoked" && (
        <p role="status" className={notice}>
          {t("points.done")}
        </p>
      )}
      {error && (
        <p role="alert" className={errorNotice}>
          {t(`points.error.${error}`)}
        </p>
      )}
      <p className="font-bold text-jaga-ink">
        {t("points.total", { points: livePoints(rows), count: rows.length })}
      </p>
      {rows.length === 0 && <p className="font-medium">{t("points.none")}</p>}

      {rows.map((r) => {
        const place =
          locale === "th" || !r.tambonNameEn
            ? r.tambonNameTh
            : `${r.tambonNameTh} (${r.tambonNameEn})`;
        return (
          <article key={r.id} className={card} data-award={r.id} data-revoked={!!r.revokedAt}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-bold text-jaga-ink">
                {r.unitName}
                {r.orgName && <span className={`block font-normal ${hint}`}>{r.orgName}</span>}
              </p>
              <p
                className={`text-h3 font-bold tabular-nums ${r.revokedAt ? "text-jaga-text-2 line-through" : "text-jaga-ink"}`}
              >
                {t("points.amount", { points: r.points })}
              </p>
            </div>
            <p className={hint}>
              <DualTime iso={r.createdAt} bangkokLabel={t("bangkokTime")} />
              {place ? ` · ${place}` : ""}
              {r.sosId ? ` · #${r.sosId.slice(0, 8)}` : ""}
            </p>
            {r.revokedAt ? (
              <p className="font-medium">{t("points.revoked", { reason: r.revokeReason ?? "" })}</p>
            ) : (
              <details>
                <summary className="flex min-h-tap cursor-pointer items-center font-medium underline">
                  {t("points.revoke")}
                </summary>
                <form action={revokePoints.bind(null, locale)} className="flex flex-col gap-3 pt-2">
                  <input type="hidden" name="award" value={r.id} />
                  <label htmlFor={`reason-${r.id}`} className={label}>
                    {t("points.reason")}
                  </label>
                  <input
                    id={`reason-${r.id}`}
                    name="reason"
                    required
                    maxLength={500}
                    className={input}
                  />
                  <p className={hint}>{t("points.reasonHint")}</p>
                  <button type="submit" className={buttonSecondary} data-revoke="true">
                    {t("points.revokeSend")}
                  </button>
                </form>
              </details>
            )}
          </article>
        );
      })}
    </div>
  );
}
