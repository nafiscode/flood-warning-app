import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DualTime } from "@/components/admin/DualTime";
import { isAdminHere } from "@/lib/admin-guard";
import { readDuplicates, type DuplicatePair } from "@/lib/admin-tools";
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
import { mergeSos, unmergeSos } from "../tools-actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/duplicates">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "adminTools" });
  return { title: t("duplicates.title") };
}

export const dynamic = "force-dynamic";

const ERRORS = ["held", "refused", "save"] as const;
const DONE = ["merged", "unmerged"] as const;

/**
 * Duplicate SOS (spec 6.4). The database notices when two open requests come from the same
 * phone or from within 300 m and two hours of each other, and offers the pair here; a person
 * decides. Merging takes the later request off the teams' boards so one house is not sent two
 * boats. It closes nothing: the merged request stays open, its sender is shown the team that
 * took the other one, the merge can be undone here, and it undoes itself if the main request
 * ends first (safety rule 1).
 */
export default async function Duplicates({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/duplicates">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  if (!(await isAdminHere())) return null;
  const t = await getTranslations("adminTools");
  const pairs = await readDuplicates();
  const open = pairs.filter((p) => !p.merged);
  const merged = pairs.filter((p) => p.merged);
  const error = ERRORS.find((e) => e === query.error);
  const done = DONE.find((d) => d === query.done);

  const side = (title: string, id: string, at: string, people: number | null, claimed: boolean) => (
    <div className="flex flex-col rounded-xl bg-jaga-ground p-3">
      <p className="font-bold">
        {title} <span className="font-mono font-normal">#{id.slice(0, 8)}</span>
      </p>
      <p className={hint}>
        <DualTime iso={at} />
        {people !== null && ` · ${t("duplicates.people", { count: people })}`}
      </p>
      <p className={hint}>{t(claimed ? "duplicates.claimed" : "duplicates.waiting")}</p>
    </div>
  );
  const head = (p: DuplicatePair) => (
    <p className="font-bold text-jaga-ink">
      {(locale === "th" || !p.tambonEn ? p.tambonTh : p.tambonEn) ?? "–"}
      <span className={`block font-normal ${hint}`}>
        {t(`duplicates.kind.${p.kind === "rescue" ? "rescue" : "supplies"}`)}
        {p.distanceM !== null && ` · ${t("duplicates.apart", { m: p.distanceM })}`}
      </span>
    </p>
  );

  return (
    <div className="flex flex-col gap-5" data-duplicates={open.length}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("duplicates.title")}</h1>
      <p className={hint}>{t("duplicates.intro")}</p>
      {done && (
        <p role="status" className={notice}>
          {t(`duplicates.done.${done}`)}
        </p>
      )}
      {error && (
        <p role="alert" className={errorNotice}>
          {t(`duplicates.error.${error}`)}
        </p>
      )}

      <h2 className="text-body font-bold text-jaga-ink">
        {t("duplicates.possible", { count: open.length })}
      </h2>
      {open.length === 0 && <p className="font-medium">{t("duplicates.none")}</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        {open.map((p) => (
          <article key={p.id} className={card} data-pair={p.id}>
            {head(p)}
            {side(t("duplicates.later"), p.id, p.createdAt, p.people, p.claimed)}
            {side(
              t("duplicates.earlier"),
              p.otherId,
              p.otherCreatedAt,
              p.otherPeople,
              p.otherClaimed,
            )}
            {p.claimed ? (
              <p className={hint}>{t("duplicates.error.held")}</p>
            ) : (
              <form action={mergeSos.bind(null, locale)} className="flex flex-col gap-3">
                <input type="hidden" name="duplicate" value={p.id} />
                <input type="hidden" name="into" value={p.otherId} />
                <label htmlFor={`note-${p.id}`} className={label}>
                  {t("duplicates.note")}
                </label>
                <input id={`note-${p.id}`} name="note" maxLength={500} className={input} />
                <button type="submit" className={buttonPrimary} data-merge="true">
                  {t("duplicates.merge")}
                </button>
                <p className={hint}>{t("duplicates.mergeHint")}</p>
              </form>
            )}
          </article>
        ))}
      </div>

      <h2 className="text-body font-bold text-jaga-ink">
        {t("duplicates.mergedTitle", { count: merged.length })}
      </h2>
      {merged.length === 0 && <p className={hint}>{t("duplicates.noneMerged")}</p>}
      <div className="grid gap-5 lg:grid-cols-2">
        {merged.map((p) => (
          <article key={p.id} className={card} data-merged={p.id}>
            {head(p)}
            {side(t("duplicates.mergedCase"), p.id, p.createdAt, p.people, false)}
            {side(t("duplicates.into"), p.otherId, p.otherCreatedAt, p.otherPeople, p.otherClaimed)}
            <form action={unmergeSos.bind(null, locale)}>
              <input type="hidden" name="sos" value={p.id} />
              <button type="submit" className={buttonSecondary} data-unmerge="true">
                {t("duplicates.unmerge")}
              </button>
            </form>
          </article>
        ))}
      </div>
    </div>
  );
}
