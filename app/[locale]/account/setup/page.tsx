import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { HomeLocationField } from "@/components/account/HomeLocationField";
import { routing } from "@/i18n/routing";
import { getSessionProfile, localePath, safeNextPath } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buttonPrimary, card, checkBox, checkRow, errorNotice, hint, input, label } from "@/lib/ui";
import { saveProfile } from "../actions";

const ERRORS = ["name", "phone", "location", "consent", "save"] as const;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/account/setup">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account" });
  return { title: t("setup.title") };
}

/** First sign-in and later edits: name, optional phone, language, optional home location. */
export default async function AccountSetup({
  params,
  searchParams,
}: PageProps<"/[locale]/account/setup">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const session = await getSessionProfile();
  if (!session) redirect(localePath(locale, "/sign-in"));
  const t = await getTranslations("account");
  const tLanguage = await getTranslations("language");

  const supabase = await createClient();
  const [{ data: contact }, { data: profile }] = await Promise.all([
    supabase.from("profile_contacts").select("phone").maybeSingle(),
    supabase.from("profiles").select("home_tambon").eq("user_id", session.userId).maybeSingle(),
  ]);
  const error = ERRORS.find((e) => e === query.error);
  const next = safeNextPath(typeof query.next === "string" ? query.next : null) ?? "";

  return (
    <form action={saveProfile} className="flex flex-col gap-5">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next} />
      <h1 className="text-h3 font-bold text-jaga-slate">{t("setup.title")}</h1>
      <p>{t("setup.intro")}</p>
      {error && (
        <p role="alert" className={errorNotice}>
          {t(`error.${error}`)}
        </p>
      )}

      <section className={card}>
        <label htmlFor="displayName" className={label}>
          {t("name.label")}
        </label>
        <input
          id="displayName"
          name="displayName"
          defaultValue={session.displayName}
          maxLength={80}
          autoComplete="nickname"
          required
          className={input}
        />
        <p className={hint}>{t("name.hint")}</p>

        <label htmlFor="phone" className={label}>
          {t("phone.label")}
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          defaultValue={(contact?.phone as string | undefined) ?? ""}
          placeholder="08x-xxx-xxxx"
          className={input}
        />
        <p className={hint}>{t("phone.hint")}</p>
      </section>

      <fieldset className={card}>
        <legend className={`${label} float-start`}>{t("language.label")}</legend>
        <div className="clear-both flex flex-col">
          {routing.locales.map((code) => (
            <label key={code} className={checkRow} lang={code}>
              <input
                type="radio"
                name="language"
                value={code}
                defaultChecked={code === (session.displayName === "" ? locale : session.locale)}
                className={checkBox}
              />
              {tLanguage(code)}
            </label>
          ))}
        </div>
      </fieldset>

      <section className={card}>
        <h2 className="text-body font-bold">{t("home.title")}</h2>
        <p className={hint}>{t("home.why")}</p>
        {profile?.home_tambon && <p>{t("home.saved")}</p>}
        <HomeLocationField
          text={{
            useGps: t("home.useGps"),
            locating: t("home.locating"),
            found: t("home.found"),
            failed: t("home.failed"),
            clear: t("home.clear"),
          }}
        />
        <label className={checkRow}>
          <input type="checkbox" name="locationConsent" value="yes" className={checkBox} />
          <span>{t("home.consent")}</span>
        </label>
        {profile?.home_tambon && (
          <label className={checkRow}>
            <input type="checkbox" name="removeHome" value="yes" className={checkBox} />
            <span>{t("home.remove")}</span>
          </label>
        )}
      </section>

      <button type="submit" className={buttonPrimary}>
        {t("save")}
      </button>
    </form>
  );
}
