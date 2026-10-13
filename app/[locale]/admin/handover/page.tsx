import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DualTime } from "@/components/admin/DualTime";
import { isAdminHere } from "@/lib/admin-guard";
import { readHandover } from "@/lib/admin-tools";
import { buttonPrimary, card, errorNotice, hint, input, label, notice } from "@/lib/ui";
import { addHandoverNote } from "../tools-actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/handover">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "adminTools" });
  return { title: t("handover.title") };
}

export const dynamic = "force-dynamic";

/**
 * Handover notes (spec 6.5): a short shift log for volunteers in different time zones - what is
 * happening, what was decided, what the next person should watch. A note is written under the
 * admin's own name and cannot be edited or deleted afterwards; a correction is a new note.
 */
export default async function Handover({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/handover">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  if (!(await isAdminHere())) return null;
  const t = await getTranslations("adminTools");
  const notes = await readHandover();

  return (
    <div className="flex flex-col gap-5" data-handover={notes.length}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("handover.title")}</h1>
      <p className={hint}>{t("handover.intro")}</p>
      {query.done === "saved" && (
        <p role="status" className={notice}>
          {t("handover.done")}
        </p>
      )}
      {query.error && (
        <p role="alert" className={errorNotice}>
          {t(query.error === "empty" ? "handover.empty" : "error.save")}
        </p>
      )}
      <form action={addHandoverNote.bind(null, locale)} className={card}>
        <label htmlFor="note" className={label}>
          {t("handover.label")}
        </label>
        <textarea id="note" name="note" required maxLength={4000} rows={4} className={input} />
        <p className={hint}>{t("handover.hint")}</p>
        <button type="submit" className={buttonPrimary} data-add-note="true">
          {t("handover.send")}
        </button>
      </form>
      {notes.length === 0 && <p className="font-medium">{t("handover.none")}</p>}
      <ol className="flex flex-col gap-3">
        {notes.map((n) => (
          <li key={n.id} className={`${card} gap-1`} data-note={n.id}>
            <p className={hint}>
              <span className="font-bold text-jaga-ink">{n.by ?? "–"}</span> ·{" "}
              <DualTime iso={n.at} />
            </p>
            <p className="whitespace-pre-wrap">{n.note}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
