import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DualTime } from "@/components/admin/DualTime";
import { Link } from "@/i18n/navigation";
import { isAdminHere } from "@/lib/admin-guard";
import { readLog, readLogActions } from "@/lib/admin-tools";
import { buttonPrimary, buttonSecondary, card, hint, input, label } from "@/lib/ui";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/log">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "adminTools" });
  return { title: t("log.title") };
}

export const dynamic = "force-dynamic";

/**
 * The access log, for reading (spec 6.5): who did what, to what, and when - every phone number
 * shown, every alert published, every export taken. Newest first, a hundred at a time, and it
 * can be narrowed to one kind of act. Nothing here can be changed: the log has no screen that
 * writes to it.
 */
export default async function AccessLog({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/log">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  if (!(await isAdminHere())) return null;
  const t = await getTranslations("adminTools");
  const actions = await readLogActions();
  const action = actions.find((a) => a.action === query.action)?.action ?? null;
  const before = /^\d+$/.test(String(query.before ?? "")) ? Number(query.before) : null;
  const rows = await readLog(action, before);
  const last = rows.at(-1);
  const older = `/admin/log?${action ? `action=${encodeURIComponent(action)}&` : ""}before=${last?.id ?? 0}`;

  return (
    <div className="flex flex-col gap-5" data-access-log={rows.length}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("log.title")}</h1>
      <p className={hint}>{t("log.intro")}</p>
      <form method="get" className={card}>
        <label htmlFor="action" className={label}>
          {t("log.kind")}
        </label>
        <select id="action" name="action" defaultValue={action ?? ""} className={input}>
          <option value="">{t("log.all")}</option>
          {actions.map((a) => (
            <option key={a.action} value={a.action}>
              {a.action} ({a.times})
            </option>
          ))}
        </select>
        <button type="submit" className={buttonPrimary}>
          {t("log.show")}
        </button>
      </form>
      {rows.length === 0 && <p className="font-medium">{t("log.none")}</p>}
      <ol className="flex flex-col gap-3">
        {rows.map((r) => {
          const details = Object.entries(r.details).filter(([, v]) => v !== null && v !== "");
          return (
            <li key={r.id} className={`${card} gap-1`} data-log={r.id} data-action={r.action}>
              <p className="font-bold text-jaga-ink">
                <span className="font-mono">{r.action}</span> · {r.by ?? t("log.system")}
              </p>
              <p className={hint}>
                <DualTime iso={r.at} /> · {r.entity}
                {r.entityId ? ` #${r.entityId.slice(0, 8)}` : ""}
              </p>
              {details.length > 0 && (
                <p className={`break-words font-mono ${hint}`}>
                  {details
                    .map(
                      ([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`,
                    )
                    .join(" · ")}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {rows.length === 100 && (
        <Link href={older} className={buttonSecondary} data-older="true">
          {t("log.older")}
        </Link>
      )}
    </div>
  );
}
