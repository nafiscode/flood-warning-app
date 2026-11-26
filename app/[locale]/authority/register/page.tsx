import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { BackLink } from "@/components/BackLink";
import { CoverageFields } from "@/components/authority/CoverageFields";
import { getSessionProfile, localePath, needsName, setupPath } from "@/lib/auth";
import {
  buttonPrimary,
  card,
  checkBox,
  checkRow,
  errorNotice,
  formColumn,
  hint,
  input,
  label,
  notice,
} from "@/lib/ui";
import { registerAuthority } from "./actions";
import { alternates } from "@/lib/seo";

const ERRORS = [
  "required",
  "pocPhone",
  "officialPhone",
  "capability",
  "coverage",
  "limit",
  "save",
] as const;
const ORG_TYPES = ["government", "private", "nonprofit", "volunteer"] as const;
// "dam" is last on purpose (A12 part 2, 9 Nov 2026): it is the rarest of them - six reservoirs
// in the whole service area - and it is the one that grants nothing by itself. Ticking it only
// tells an admin what to confirm with the dam; the power to send a release notice arrives when
// they tie the verified unit to a named dam.
const CAPABILITIES = ["coordination", "rescue", "supplies", "planning", "support", "dam"] as const;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/authority/register">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "authorityRegister" });
  return { title: t("title"), alternates: alternates(locale, "/authority/register") };
}

/**
 * Authority registration (spec section 3). Plain HTML: it must work on a slow connection in a
 * district office. Coverage is chosen from the list here; any level can be ticked, and the
 * database expands it to tambons.
 */
export default async function AuthorityRegister({
  params,
  searchParams,
}: PageProps<"/[locale]/authority/register">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const session = await getSessionProfile();
  if (!session) {
    redirect(`${localePath(locale, "/sign-in")}?next=${localePath(locale, "/authority/register")}`);
  }
  // A unit is registered under a person's name, so the name comes first (spec section 3).
  if (needsName(session)) redirect(setupPath(locale, "/authority/register"));
  const t = await getTranslations("authorityRegister");
  const tNav = await getTranslations("nav");
  const error = ERRORS.find((e) => e === query.error);

  return (
    <form action={registerAuthority} className={`flex flex-col gap-5 ${formColumn}`}>
      <input type="hidden" name="locale" value={locale} />
      <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
      <p className={notice}>{t("intro")}</p>
      {error && (
        <p role="alert" className={errorNotice}>
          {t(`error.${error}`)}
        </p>
      )}

      <fieldset className={card}>
        <legend className={`${label} float-start`}>{t("orgType.label")}</legend>
        <div className="clear-both flex flex-col">
          {ORG_TYPES.map((type) => (
            <label key={type} className={checkRow}>
              <input type="radio" name="orgType" value={type} required className={checkBox} />
              {t(`orgType.${type}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <section className={card}>
        <label htmlFor="orgName" className={label}>
          {t("orgName.label")}
        </label>
        <input
          id="orgName"
          name="orgName"
          minLength={2}
          maxLength={200}
          required
          className={input}
        />
        <p className={hint}>{t("orgName.hint")}</p>

        <label htmlFor="unitName" className={label}>
          {t("unitName.label")}
        </label>
        <input
          id="unitName"
          name="unitName"
          minLength={2}
          maxLength={200}
          required
          className={input}
        />
        <p className={hint}>{t("unitName.hint")}</p>

        <label htmlFor="officialPhone" className={label}>
          {t("officialPhone.label")}
        </label>
        <input
          id="officialPhone"
          name="officialPhone"
          type="tel"
          inputMode="tel"
          className={input}
        />
        <label className={checkRow}>
          <input type="checkbox" name="publicContact" value="yes" className={checkBox} />
          <span>
            {t("publicContact.label")}
            <span className={`block ${hint}`}>{t("publicContact.hint")}</span>
          </span>
        </label>
      </section>

      <section className={card}>
        <h2 className="text-body font-bold">{t("poc.title")}</h2>
        <p className={hint}>{t("poc.privacy")}</p>
        <label htmlFor="pocName" className={label}>
          {t("poc.name")}
        </label>
        <input
          id="pocName"
          name="pocName"
          minLength={2}
          maxLength={120}
          autoComplete="name"
          required
          className={input}
        />
        <label htmlFor="pocPhone" className={label}>
          {t("poc.phone")}
        </label>
        <input
          id="pocPhone"
          name="pocPhone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="08x-xxx-xxxx"
          required
          className={input}
        />
        <p className={hint}>{t("poc.phoneHint")}</p>
      </section>

      <fieldset className={card}>
        <legend className={`${label} float-start`}>{t("capability.label")}</legend>
        <div className="clear-both flex flex-col">
          {CAPABILITIES.map((capability) => (
            <label key={capability} className={checkRow}>
              <input type="checkbox" name="capability" value={capability} className={checkBox} />
              <span>
                {t(`capability.${capability}.name`)}
                <span className={`block ${hint}`}>{t(`capability.${capability}.hint`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <CoverageFields locale={locale} />

      <p className={hint}>{t("afterSubmit")}</p>
      <button type="submit" className={buttonPrimary}>
        {t("submit")}
      </button>
      <BackLink href="/account" label={tNav("backAccount")} />
    </form>
  );
}
