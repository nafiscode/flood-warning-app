import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSessionProfile, localePath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  buttonPrimary,
  card,
  checkBox,
  checkRow,
  errorNotice,
  hint,
  input,
  label,
  notice,
} from "@/lib/ui";
import { registerAuthority } from "./actions";

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
const CAPABILITIES = ["coordination", "rescue", "planning", "support"] as const;

type Area = { code: string; name_th: string; name_en: string };
type District = Area & { province_code: string };
type Tambon = Area & { district_code: string };

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/authority/register">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "authorityRegister" });
  return { title: t("title") };
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
  const t = await getTranslations("authorityRegister");
  const error = ERRORS.find((e) => e === query.error);

  const supabase = await createClient();
  const [{ data: provinces }, { data: districts }, { data: tambons }] = await Promise.all([
    supabase
      .from("provinces")
      .select("code, name_th, name_en")
      .eq("status", "active")
      .order("code"),
    supabase.from("districts").select("code, province_code, name_th, name_en").order("code"),
    supabase
      .from("tambons")
      .select("code, district_code, name_th, name_en")
      .order("code")
      .limit(2000),
  ]);
  const name = (area: Area) => (locale === "th" ? area.name_th : area.name_en);
  const districtsOf = (province: string) =>
    ((districts ?? []) as District[]).filter((d) => d.province_code === province);
  const tambonsOf = (district: string) =>
    ((tambons ?? []) as Tambon[]).filter((tb) => tb.district_code === district);

  return (
    <form action={registerAuthority} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />
      <h1 className="text-h3 font-bold text-jaga-slate">{t("title")}</h1>
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

      <fieldset className={card}>
        <legend className={`${label} float-start`}>{t("coverage.label")}</legend>
        <p className={`clear-both ${hint}`}>{t("coverage.hint")}</p>
        {((provinces ?? []) as Area[]).map((province) => (
          <div key={province.code} className="flex flex-col border-t border-jaga-line pt-2">
            <label className={checkRow}>
              <input type="checkbox" name="province" value={province.code} className={checkBox} />
              <span className="font-bold">
                {t("coverage.wholeProvince", { name: name(province) })}
              </span>
            </label>
            <details>
              <summary className="min-h-tap cursor-pointer py-2 text-jaga-teal-ink underline">
                {t("coverage.chooseDistricts", { name: name(province) })}
              </summary>
              <div className="flex flex-col ps-4">
                {districtsOf(province.code).map((district) => (
                  <div key={district.code}>
                    <label className={checkRow}>
                      <input
                        type="checkbox"
                        name="district"
                        value={district.code}
                        className={checkBox}
                      />
                      <span>{t("coverage.wholeDistrict", { name: name(district) })}</span>
                    </label>
                    <details>
                      <summary className="min-h-tap cursor-pointer py-2 text-small text-jaga-teal-ink underline">
                        {t("coverage.chooseTambons", { name: name(district) })}
                      </summary>
                      <div className="flex flex-col ps-4">
                        {tambonsOf(district.code).map((tambon) => (
                          <label key={tambon.code} className={checkRow}>
                            <input
                              type="checkbox"
                              name="tambon"
                              value={tambon.code}
                              className={checkBox}
                            />
                            <span>{name(tambon)}</span>
                          </label>
                        ))}
                      </div>
                    </details>
                  </div>
                ))}
              </div>
            </details>
          </div>
        ))}
        {(provinces ?? []).length === 0 && <p role="alert">{t("coverage.unavailable")}</p>}
      </fieldset>

      <p className={hint}>{t("afterSubmit")}</p>
      <button type="submit" className={buttonPrimary}>
        {t("submit")}
      </button>
    </form>
  );
}
