import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DualTime } from "@/components/admin/DualTime";
import { Link } from "@/i18n/navigation";
import { isAdminHere } from "@/lib/admin-guard";
import { MODERATION, readReportQueue, type Moderation } from "@/lib/admin-tools";
import { readReportMedia } from "@/lib/authority-board";
import { buttonPrimary, buttonSecondary, card, errorNotice, hint, notice } from "@/lib/ui";
import { moderateReport } from "../tools-actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/moderation">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "adminTools" });
  return { title: t("moderation.title") };
}

export const dynamic = "force-dynamic";

/**
 * Report moderation (spec 6.5). A report waits here until an admin has looked at it: approving
 * it lets it count in the public map's hexagons, hiding it keeps it out of them and out of the
 * teams' feed. Nothing is deleted, and either answer can be changed later.
 *
 * Who sent a report is never on this page. Photos are opened through ten-minute links made with
 * the admin's own session.
 */
export default async function Moderation({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/moderation">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  if (!(await isAdminHere())) return null;
  const t = await getTranslations("adminTools");
  const tReport = await getTranslations("report");
  const status: Moderation = MODERATION.find((s) => s === query.status) ?? "pending";
  const reports = await readReportQueue(status);
  const media = await Promise.all(
    reports.map((r) =>
      r.photos > 0 || r.hasVoice
        ? readReportMedia(r.id).catch(() => null)
        : Promise.resolve({ photos: [], voice: null, proof: [] }),
    ),
  );
  const done = MODERATION.find((s) => s === query.done);
  const label = (group: "depths" | "trends" | "roads", key: string | null) =>
    key && tReport.has(`${group}.${key}`) ? tReport(`${group}.${key}`) : null;

  return (
    <div className="flex flex-col gap-5" data-moderation={status}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("moderation.title")}</h1>
      <p className={hint}>{t("moderation.intro")}</p>
      <nav className="flex flex-wrap gap-x-4" aria-label={t("moderation.title")}>
        {MODERATION.map((s) => (
          <Link
            key={s}
            href={`/admin/moderation?status=${s}`}
            aria-current={s === status ? "page" : undefined}
            className={`inline-flex min-h-tap items-center underline ${s === status ? "font-bold" : ""}`}
          >
            {t(`moderation.status.${s}`)}
          </Link>
        ))}
      </nav>
      {done && (
        <p role="status" className={notice}>
          {t(`moderation.done.${done}`)}
        </p>
      )}
      {query.error && (
        <p role="alert" className={errorNotice}>
          {t("error.save")}
        </p>
      )}
      {reports.length === 0 && <p className="font-medium">{t("moderation.none")}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        {reports.map((r, i) => {
          const files = media[i];
          const facts = [
            label("depths", r.depth),
            label("trends", r.trend),
            label("roads", r.road),
          ].filter(Boolean);
          return (
            <article key={r.id} className={card} data-report={r.id}>
              <p className="font-bold text-jaga-ink">
                {(locale === "th" || !r.tambonEn ? r.tambonTh : r.tambonEn) ?? "–"}
                <span className={`block font-normal ${hint}`}>
                  <DualTime iso={r.createdAt} />
                </span>
              </p>
              {facts.length > 0 && <p>{facts.join(" · ")}</p>}
              {r.note && <p className="whitespace-pre-wrap">{r.note}</p>}
              {files === null && <p className={hint}>{t("moderation.mediaFailed")}</p>}
              {files && files.photos.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {files.photos.map((url, n) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer">
                      {/* A signed link to private storage: next/image cannot fetch it. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={url}
                        alt={t("moderation.photo", { n: n + 1 })}
                        loading="lazy"
                        className="aspect-square w-full rounded-lg border border-jaga-line object-cover"
                      />
                    </a>
                  ))}
                </div>
              )}
              {files?.voice && (
                <audio controls preload="none" src={files.voice} className="w-full" />
              )}
              {r.photos === 0 && !r.hasVoice && <p className={hint}>{t("moderation.noMedia")}</p>}
              <div className="flex flex-col gap-2">
                {MODERATION.filter((to) => to !== r.status && to !== "pending").map((to) => (
                  <form key={to} action={moderateReport.bind(null, locale)}>
                    <input type="hidden" name="report" value={r.id} />
                    <input type="hidden" name="from" value={status} />
                    <input type="hidden" name="to" value={to} />
                    <button
                      type="submit"
                      className={to === "approved" ? buttonPrimary : buttonSecondary}
                      data-moderate={to}
                    >
                      {t(`moderation.to.${to}`)}
                    </button>
                  </form>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
