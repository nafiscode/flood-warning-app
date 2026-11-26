import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BackLink } from "@/components/BackLink";
import { CoverageFields } from "@/components/authority/CoverageFields";
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
  formColumn,
  hint,
  input,
  label,
} from "@/lib/ui";
import { saveUnitContact, saveUnitDetails, saveUnitScope } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORG_TYPES = ["government", "private", "nonprofit", "volunteer"] as const;
const CAPABILITIES = ["coordination", "rescue", "supplies", "planning", "support", "dam"] as const;
const ERRORS = [
  "required",
  "officialPhone",
  "pocPhone",
  "capability",
  "coverage",
  "call",
  "save",
] as const;
const DONE = ["details", "contact", "scope"] as const;

type Unit = {
  id: string;
  unit_name: string;
  capabilities: string[];
  status: "pending" | "verified" | "rejected" | "suspended";
  created_at: string;
  organizations: {
    id: string;
    name: string;
    type: (typeof ORG_TYPES)[number];
    official_phone: string | null;
    public_contact_opt_in: boolean;
  } | null;
  authority_coverage: { selected_level: string; selected_code: string }[];
};

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * An admin corrects a registered team (owner, 26 Nov 2026): its name and organization, its
 * point of contact, and what it may do and where. Three forms that save on their own, each one a
 * database function that checks the caller is an admin and writes the audit log.
 *
 * The contact's name and phone are shown only after the admin asks for them, through the same
 * logged reveal as the verification queue (safety rule 5): opening this page for a typo in the
 * unit's name must not log a phone reveal.
 */
export default async function AdminEditUnit({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/authorities/[unit]/edit">) {
  const { locale, unit: unitId } = await params;
  setRequestLocale(locale);
  if (!UUID.test(unitId)) notFound();
  const query = await searchParams;
  const t = await getTranslations("admin");
  const tr = await getTranslations("authorityRegister");
  const error = ERRORS.find((e) => e === query.error);
  const done = DONE.find((d) => d === query.done);

  const supabase = await createClient();
  const { data } = await supabase
    .from("authority_units")
    .select(
      "id, unit_name, capabilities, status, created_at, organizations(id, name, type, official_phone, public_contact_opt_in), authority_coverage(selected_level, selected_code)",
    )
    .eq("id", unitId)
    .maybeSingle();
  const unit = data as unknown as Unit | null;
  if (!unit) notFound();

  const [{ count: orgUnits }, { count: damLinks }] = await Promise.all([
    supabase
      .from("authority_units")
      .select("id", { count: "exact", head: true })
      .eq("org_id", unit.organizations?.id ?? ""),
    supabase
      .from("dam_operator_units")
      .select("unit_id", { count: "exact", head: true })
      .eq("unit_id", unit.id),
  ]);

  let contact: { poc_name: string; poc_phone: string } | null = null;
  if (query.reveal === "1") {
    const { data: rows } = await supabase.rpc("reveal_poc_phone", { p_unit_id: unit.id });
    contact = (rows as { poc_name: string; poc_phone: string }[] | null)?.[0] ?? null;
  }

  const selected = new Set(
    unit.authority_coverage.map((c) => `${c.selected_level}:${c.selected_code}`),
  );
  const org = unit.organizations;
  const base = `/admin/authorities/${unit.id}/edit`;

  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="unit" value={unit.id} />
    </>
  );

  return (
    <div className={`flex flex-col gap-5 ${formColumn}`} data-edit-unit={unit.id}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("authorities.edit.title")}</h1>
      <p className="font-medium">
        {org?.name} · {unit.unit_name} · {t(`authorities.status.${unit.status}`)}
      </p>
      <p className={hint}>
        {t("authorities.registered")} <DualTime iso={unit.created_at} />
      </p>
      {error && (
        <p role="alert" className={errorNotice}>
          {error === "call"
            ? t("authorities.edit.error.call")
            : error === "save"
              ? t("authorities.error.save")
              : tr(`error.${error}`)}
        </p>
      )}
      {done && (
        <p role="status" className={errorNotice}>
          {t(`authorities.edit.done.${done}`)}
        </p>
      )}

      <form action={saveUnitDetails} className={card} data-edit-section="details">
        {hidden}
        <h2 className="text-body font-bold">{t("authorities.edit.detailsTitle")}</h2>
        <fieldset className="flex flex-col">
          <legend className={`${label} float-start`}>{tr("orgType.label")}</legend>
          <div className="clear-both flex flex-col">
            {ORG_TYPES.map((type) => (
              <label key={type} className={checkRow}>
                <input
                  type="radio"
                  name="orgType"
                  value={type}
                  defaultChecked={org?.type === type}
                  required
                  className={checkBox}
                />
                {tr(`orgType.${type}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <label htmlFor="orgName" className={label}>
          {tr("orgName.label")}
        </label>
        <input
          id="orgName"
          name="orgName"
          defaultValue={org?.name}
          minLength={2}
          maxLength={200}
          required
          className={input}
        />
        <p className={hint}>{t("authorities.edit.orgShared", { count: orgUnits ?? 1 })}</p>
        <label htmlFor="unitName" className={label}>
          {tr("unitName.label")}
        </label>
        <input
          id="unitName"
          name="unitName"
          defaultValue={unit.unit_name}
          minLength={2}
          maxLength={200}
          required
          className={input}
        />
        <label htmlFor="officialPhone" className={label}>
          {tr("officialPhone.label")}
        </label>
        <input
          id="officialPhone"
          name="officialPhone"
          type="tel"
          inputMode="tel"
          defaultValue={org?.official_phone ?? ""}
          className={input}
        />
        <label className={checkRow}>
          <input
            type="checkbox"
            name="publicContact"
            value="yes"
            defaultChecked={org?.public_contact_opt_in ?? false}
            className={checkBox}
          />
          <span>
            {tr("publicContact.label")}
            <span className={`block ${hint}`}>{tr("publicContact.hint")}</span>
          </span>
        </label>
        <button type="submit" className={buttonPrimary} data-save="details">
          {t("authorities.edit.saveDetails")}
        </button>
      </form>

      <section className={card} data-edit-section="contact">
        <h2 className="text-body font-bold">{tr("poc.title")}</h2>
        <p className={hint}>{t("authorities.edit.contactHint")}</p>
        {contact ? (
          <form action={saveUnitContact} className="flex flex-col gap-3">
            {hidden}
            <label htmlFor="pocName" className={label}>
              {tr("poc.name")}
            </label>
            <input
              id="pocName"
              name="pocName"
              defaultValue={contact.poc_name}
              minLength={2}
              maxLength={120}
              autoComplete="off"
              required
              className={input}
            />
            <label htmlFor="pocPhone" className={label}>
              {tr("poc.phone")}
            </label>
            <input
              id="pocPhone"
              name="pocPhone"
              type="tel"
              inputMode="tel"
              defaultValue={contact.poc_phone}
              autoComplete="off"
              required
              className={input}
            />
            <label className={checkRow}>
              <input type="checkbox" name="called" value="yes" className={checkBox} />
              <span>
                {t("authorities.edit.called")}
                <span className={`block ${hint}`}>
                  {unit.status === "verified"
                    ? t("authorities.edit.calledVerified")
                    : t("authorities.edit.calledOther")}
                </span>
              </span>
            </label>
            <button type="submit" className={buttonPrimary} data-save="contact">
              {t("authorities.edit.saveContact")}
            </button>
          </form>
        ) : (
          <Link href={`${base}?reveal=1`} className={buttonSecondary} data-reveal-contact>
            {t("authorities.reveal")}
          </Link>
        )}
      </section>

      <form action={saveUnitScope} className="flex flex-col gap-5" data-edit-section="scope">
        {hidden}
        <section className={card}>
          <h2 className="text-body font-bold">{t("authorities.edit.scopeTitle")}</h2>
          <p className={errorNotice}>{t("authorities.edit.scopeWarning")}</p>
          <fieldset className="flex flex-col">
            <legend className={`${label} float-start`}>{tr("capability.label")}</legend>
            <div className="clear-both flex flex-col">
              {CAPABILITIES.map((capability) => (
                <label key={capability} className={checkRow}>
                  <input
                    type="checkbox"
                    name="capability"
                    value={capability}
                    defaultChecked={unit.capabilities.includes(capability)}
                    className={checkBox}
                  />
                  <span>
                    {tr(`capability.${capability}.name`)}
                    <span className={`block ${hint}`}>{tr(`capability.${capability}.hint`)}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {(damLinks ?? 0) > 0 && <p className={hint}>{t("authorities.edit.damWarning")}</p>}
        </section>
        <CoverageFields locale={locale} selected={selected} />
        <button type="submit" className={buttonPrimary} data-save="scope">
          {t("authorities.edit.saveScope")}
        </button>
      </form>

      <BackLink href="/admin/authorities" label={t("authorities.edit.back")} />
    </div>
  );
}
