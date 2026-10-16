import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DualTime } from "@/components/admin/DualTime";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  buttonPrimary,
  buttonSecondary,
  card,
  checkBox,
  checkRow,
  errorNotice,
  hint,
  input,
  label,
} from "@/lib/ui";
import { rejectUnit, suspendUnit, verifyUnit } from "./actions";

type Unit = {
  id: string;
  unit_name: string;
  capabilities: string[];
  status: "pending" | "verified" | "rejected" | "suspended";
  created_at: string;
  organizations: { name: string; type: string; official_phone: string | null } | null;
  authority_coverage: { selected_level: string; selected_code: string }[];
};

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/authorities">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: t("authorities.title") };
}

/**
 * Verification queue. The contact's name and phone are shown only after the admin asks for
 * them, through the logged reveal function (safety rule 5): every view is in the audit log.
 */
export default async function AdminAuthorities({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/authorities">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const t = await getTranslations("admin");
  const tRegister = await getTranslations("authorityRegister");
  const reveal = typeof query.reveal === "string" ? query.reveal : "";

  const supabase = await createClient();
  const { data } = await supabase
    .from("authority_units")
    .select(
      "id, unit_name, capabilities, status, created_at, organizations(name, type, official_phone), authority_coverage(selected_level, selected_code)",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  const units = (data ?? []) as unknown as Unit[];
  const pending = units.filter((u) => u.status === "pending");
  const others = units.filter((u) => u.status !== "pending");

  // What an admin wrote when they turned a registration down. From the audit log, which only
  // admins may read: the reason belongs with the unit in this list, and an admin about to verify
  // it after all needs to see the earlier no.
  const turnedDown = units.filter((u) => u.status === "rejected").map((u) => u.id);
  const notes = new Map<string, string>();
  if (turnedDown.length > 0) {
    const { data: log } = await supabase
      .from("audit_log")
      .select("entity_id, details, ts")
      .eq("entity", "authority_units")
      .eq("action", "reject_authority")
      .in("entity_id", turnedDown)
      .order("ts", { ascending: false });
    for (const entry of (log ?? []) as { entity_id: string; details: { reason?: string } }[]) {
      const reason = entry.details?.reason;
      if (reason && !notes.has(entry.entity_id)) notes.set(entry.entity_id, reason);
    }
  }

  let contact: { poc_name: string; poc_phone: string } | null = null;
  if (units.some((u) => u.id === reveal)) {
    const { data: rows } = await supabase.rpc("reveal_poc_phone", { p_unit_id: reveal });
    contact = (rows as { poc_name: string; poc_phone: string }[] | null)?.[0] ?? null;
  }

  const summary = (unit: Unit) => {
    const selected = new Set(
      unit.authority_coverage.map((c) => `${c.selected_level}:${c.selected_code}`),
    );
    const of = (level: string) => [...selected].filter((s) => s.startsWith(`${level}:`)).length;
    return t("authorities.coverage", {
      provinces: of("province"),
      districts: of("district"),
      tambons: of("tambon"),
      total: unit.authority_coverage.length,
    });
  };

  const details = (unit: Unit) => (
    <>
      <h3 className="text-body font-bold">
        {unit.organizations?.name} · {unit.unit_name}
      </h3>
      <p className={hint}>
        {unit.organizations &&
          tRegister(
            `orgType.${unit.organizations.type as "government" | "private" | "nonprofit" | "volunteer"}`,
          )}
        {" · "}
        {unit.capabilities
          .map((c) =>
            tRegister(
              `capability.${c as "coordination" | "rescue" | "supplies" | "planning" | "support"}.name`,
            ),
          )
          .join(", ")}
      </p>
      <p>{summary(unit)}</p>
      <p className={hint}>
        {t("authorities.registered")} <DualTime iso={unit.created_at} />
      </p>
    </>
  );

  // Shown for a registration still waiting, and again for one turned down: an admin who said no
  // by mistake can still call the contact and verify it.
  const verifyBlock = (unit: Unit) =>
    reveal === unit.id && contact ? (
      <form action={verifyUnit} className="flex flex-col gap-3 border-t border-jaga-line pt-3">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="unit" value={unit.id} />
        <p>
          {t("authorities.contact")}: <b>{contact.poc_name}</b>
          <a
            href={`tel:${contact.poc_phone}`}
            className="block min-h-tap py-2 text-h3 font-bold underline"
          >
            {contact.poc_phone}
          </a>
        </p>
        <label className={checkRow}>
          <input type="checkbox" name="called" value="yes" className={checkBox} />
          <span>{t("authorities.called")}</span>
        </label>
        <button type="submit" data-verify={unit.id} className={buttonPrimary}>
          {t("authorities.verify")}
        </button>
      </form>
    ) : (
      <Link href={`/admin/authorities?reveal=${unit.id}`} className={buttonSecondary}>
        {t("authorities.reveal")}
      </Link>
    );

  // Turning a registration down. The team is told the reason, so the form says so.
  const rejectBlock = (unit: Unit) => (
    <details open={query.reject === unit.id}>
      <summary className="min-h-tap cursor-pointer py-2 underline">
        {t("authorities.reject")}
      </summary>
      <form action={rejectUnit} className="flex flex-col gap-3">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="unit" value={unit.id} />
        <label htmlFor={`reject-${unit.id}`} className={label}>
          {t("authorities.rejectReason")}
        </label>
        <input
          id={`reject-${unit.id}`}
          name="reason"
          maxLength={500}
          minLength={3}
          required
          placeholder={t("authorities.rejectExample")}
          className={input}
        />
        <p className={hint}>{t("authorities.rejectHint")}</p>
        <button type="submit" data-reject={unit.id} className={buttonSecondary}>
          {t("authorities.rejectConfirm")}
        </button>
      </form>
    </details>
  );

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-h3 font-bold text-jaga-ink">{t("authorities.title")}</h1>
      {query.error === "call" && (
        <p role="alert" className={errorNotice}>
          {t("authorities.error.call")}
        </p>
      )}
      {query.error === "save" && (
        <p role="alert" className={errorNotice}>
          {t("authorities.error.save")}
        </p>
      )}
      {query.error === "reason" && (
        <p role="alert" className={errorNotice}>
          {t("authorities.error.reason")}
        </p>
      )}
      {(query.done === "verified" || query.done === "rejected" || query.done === "suspended") && (
        <p role="status" className={errorNotice}>
          {t(`authorities.done.${query.done}`)}
        </p>
      )}

      <h2 className="text-body font-bold">{t("authorities.pending", { count: pending.length })}</h2>
      {pending.length === 0 && <p className={hint}>{t("authorities.none")}</p>}
      {pending.map((unit) => (
        <section key={unit.id} className={card}>
          {details(unit)}
          {verifyBlock(unit)}
          {rejectBlock(unit)}
        </section>
      ))}

      <h2 className="text-body font-bold">{t("authorities.others")}</h2>
      {others.map((unit) => (
        <section key={unit.id} className={card}>
          {details(unit)}
          <p className="font-medium">{t(`authorities.status.${unit.status}`)}</p>
          {unit.status === "rejected" && (
            <>
              {notes.has(unit.id) && (
                <p className={hint}>
                  {t("authorities.rejectedReason", { reason: notes.get(unit.id)! })}
                </p>
              )}
              {/* Open when the contact has just been asked for, so the form is in view. */}
              <details open={reveal === unit.id}>
                <summary className="min-h-tap cursor-pointer py-2 underline">
                  {t("authorities.verifyAnyway")}
                </summary>
                {verifyBlock(unit)}
              </details>
            </>
          )}
          {unit.status === "verified" && (
            <details>
              <summary className="min-h-tap cursor-pointer py-2 underline">
                {t("authorities.suspend")}
              </summary>
              <form action={suspendUnit} className="flex flex-col gap-3">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="unit" value={unit.id} />
                <label htmlFor={`reason-${unit.id}`} className={label}>
                  {t("authorities.reason")}
                </label>
                <input
                  id={`reason-${unit.id}`}
                  name="reason"
                  maxLength={500}
                  required
                  className={input}
                />
                <button type="submit" className={buttonSecondary}>
                  {t("authorities.suspendConfirm")}
                </button>
              </form>
            </details>
          )}
        </section>
      ))}
    </div>
  );
}
