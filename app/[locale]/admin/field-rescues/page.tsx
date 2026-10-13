import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DualTime } from "@/components/admin/DualTime";
import { Link } from "@/i18n/navigation";
import { isAdminHere } from "@/lib/admin-guard";
import { FIELD_EVIDENCE, FIELD_HOLDS, FIELD_STATUSES, type FieldStatus } from "@/lib/field-rescue";
import { isUuid } from "@/lib/alert-console";
import { createClient } from "@/lib/supabase/server";
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
import { reviewFieldRescue } from "../tools-actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/field-rescues">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "adminTools" });
  return { title: t("field.title") };
}

export const dynamic = "force-dynamic";

const DONE = ["approved", "rejected"] as const;
const ERRORS = ["reason", "gone", "save"] as const;
type Row = Record<string, unknown>;

/**
 * Rescues a team found by itself, for an admin to judge (the owner, 13-14 Oct). A record lands
 * in "Waiting" when nothing said there was a flood at that place, or when it looks repeated;
 * the page says which. Approving awards the half points; refusing needs a reason, and a record
 * that was counted automatically can be refused too, which takes its points back.
 *
 * The rescued person's number is not on the page. "Show the number" asks for one, and that look
 * is written to the access log (safety rule 5). Photos open through ten-minute links.
 */
export default async function FieldRescues({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/field-rescues">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  if (!(await isAdminHere())) return null;
  const t = await getTranslations("adminTools");
  const tField = await getTranslations("fieldRescue");
  const tSos = await getTranslations("sos");
  const status: FieldStatus = FIELD_STATUSES.find((s) => s === query.status) ?? "pending";

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_field_rescues", { p_status: status });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];

  // One look at one number, asked for by a tap; never a list of numbers.
  const reveal = isUuid(query.reveal) ? query.reveal : null;
  let phone: string | null = null;
  if (reveal && rows.some((r) => r.rescue_id === reveal)) {
    const shown = await supabase.rpc("reveal_field_rescue_phone", { p_rescue: reveal });
    phone = typeof shown.data === "string" ? shown.data : null;
  }

  const paths = rows.flatMap((r) => (Array.isArray(r.photos) ? (r.photos as string[]) : []));
  const signed =
    paths.length > 0
      ? await supabase.storage.from("field-media").createSignedUrls(paths.slice(0, 120), 600)
      : { data: [] };
  const link = new Map((signed.data ?? []).map((d) => [d.path ?? "", d.signedUrl]));
  const done = DONE.find((d) => d === query.done);
  const failed = ERRORS.find((e) => e === query.error);

  return (
    <div className="flex flex-col gap-5" data-field-rescues={rows.length}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("field.title")}</h1>
      <p className={hint}>{t("field.intro")}</p>
      <nav className="flex flex-wrap gap-x-4" aria-label={t("field.title")}>
        {FIELD_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/field-rescues?status=${s}`}
            aria-current={s === status ? "page" : undefined}
            className={`inline-flex min-h-tap items-center underline ${s === status ? "font-bold" : ""}`}
          >
            {t(`field.status.${s}`)}
          </Link>
        ))}
      </nav>
      {done && (
        <p role="status" className={notice}>
          {t(`field.done.${done}`)}
        </p>
      )}
      {failed && (
        <p role="alert" className={errorNotice}>
          {t(`field.error.${failed}`)}
        </p>
      )}
      {rows.length === 0 && <p className="font-medium">{t("field.none")}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        {rows.map((r) => {
          const id = String(r.rescue_id);
          const checks = (r.checks ?? {}) as { holds?: unknown; evidence?: unknown };
          const holds = FIELD_HOLDS.filter(
            (h) => Array.isArray(checks.holds) && checks.holds.includes(h),
          );
          const evidence = FIELD_EVIDENCE.filter(
            (e) => Array.isArray(checks.evidence) && checks.evidence.includes(e),
          );
          const flags = Object.entries((r.vulnerable ?? {}) as Record<string, unknown>)
            .filter(([, v]) => v === true)
            .map(([k]) => k);
          const lat = Number(r.lat);
          const lon = Number(r.lon);
          const photos = (Array.isArray(r.photos) ? (r.photos as string[]) : [])
            .map((p) => link.get(p))
            .filter((u): u is string => !!u);
          return (
            <article
              key={id}
              className={card}
              data-field-rescue={id}
              data-status={String(r.status)}
            >
              <p className="font-bold text-jaga-ink">
                {String(r.unit_name)}
                <span className={`block font-normal ${hint}`}>
                  {String(r.org_name)} · {String(r.recorded_by_name ?? "–")}
                </span>
              </p>
              <p>
                {(locale === "th" || !r.tambon_en ? String(r.tambon_th) : String(r.tambon_en)) +
                  " · " +
                  t("field.people", { count: Number(r.people_count) })}
                <span className={`block ${hint}`}>
                  <DualTime iso={String(r.created_at)} /> ·{" "}
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${lat},${lon}`}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {lat.toFixed(5)}, {lon.toFixed(5)}
                  </a>
                  {r.accuracy_m !== null &&
                    ` · ${t("field.accuracy", { m: Math.round(Number(r.accuracy_m)) })}`}
                </span>
              </p>
              {flags.length > 0 && (
                <p className={hint}>
                  {flags
                    .map((f) => (tSos.has(`vulnerable.${f}`) ? tSos(`vulnerable.${f}`) : f))
                    .join(" · ")}
                </p>
              )}
              {typeof r.note === "string" && r.note && <p>{r.note}</p>}

              {holds.length > 0 && (
                <div className="flex flex-col gap-1 rounded-xl border-2 border-jaga-edge p-3">
                  <p className="font-bold">{t("field.heldFor")}</p>
                  <ul className="flex list-disc flex-col gap-1 ps-6" data-holds={holds.join(",")}>
                    {holds.map((h) => (
                      <li key={h}>{tField(`holds.${h}`)}</li>
                    ))}
                  </ul>
                </div>
              )}
              <p className={hint}>
                {evidence.length > 0
                  ? t("field.evidence", {
                      list: evidence.map((e) => t(`field.evidenceKind.${e}`)).join(", "),
                    })
                  : t("field.noEvidence")}
              </p>
              <p className={hint}>
                {t("field.unitWeek", { count: Number(r.unit_last_7_days) })}
                {Number(r.points) > 0 && ` · ${t("field.points", { points: Number(r.points) })}`}
              </p>

              {photos.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {photos.map((url, n) => (
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
              ) : (
                <p className={hint}>{t("moderation.mediaFailed")}</p>
              )}

              {reveal === id ? (
                <p className={notice} data-field-phone="shown">
                  {phone ? (
                    <a href={`tel:${phone}`} className="font-bold underline">
                      {phone}
                    </a>
                  ) : (
                    t("field.noPhone")
                  )}
                  <span className={`block ${hint}`}>{t("field.phoneLogged")}</span>
                </p>
              ) : (
                <Link
                  href={`/admin/field-rescues?status=${status}&reveal=${id}`}
                  className={buttonSecondary}
                  data-field-reveal="true"
                >
                  {t("field.showPhone")}
                </Link>
              )}

              {typeof r.review_note === "string" && r.review_note && (
                <p className={hint}>{t("field.reviewNote", { note: r.review_note })}</p>
              )}

              {r.status === "pending" && (
                <form action={reviewFieldRescue.bind(null, locale)} className="flex flex-col gap-2">
                  <input type="hidden" name="rescue" value={id} />
                  <input type="hidden" name="decision" value="approve" />
                  <input type="hidden" name="from" value={status} />
                  <label htmlFor={`ok-${id}`} className={label}>
                    {t("field.approveNote")}
                  </label>
                  <input id={`ok-${id}`} name="note" maxLength={500} className={input} />
                  <button type="submit" className={buttonPrimary} data-field-approve="true">
                    {t("field.approve")}
                  </button>
                </form>
              )}
              {r.status !== "rejected" && (
                <details>
                  <summary className="flex min-h-tap cursor-pointer items-center font-medium underline">
                    {t(r.status === "pending" ? "field.reject" : "field.takeBack")}
                  </summary>
                  <form
                    action={reviewFieldRescue.bind(null, locale)}
                    className="flex flex-col gap-2 pt-2"
                  >
                    <input type="hidden" name="rescue" value={id} />
                    <input type="hidden" name="decision" value="reject" />
                    <input type="hidden" name="from" value={status} />
                    <label htmlFor={`no-${id}`} className={label}>
                      {t("field.rejectReason")}
                    </label>
                    <input id={`no-${id}`} name="note" required maxLength={500} className={input} />
                    <p className={hint}>{t("field.rejectHint")}</p>
                    <button type="submit" className={buttonSecondary} data-field-reject="true">
                      {t("field.rejectSend")}
                    </button>
                  </form>
                </details>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
