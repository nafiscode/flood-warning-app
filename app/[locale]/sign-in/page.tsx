import { BackLink } from "@/components/BackLink";
import { LineLink } from "@/components/account/LineLink";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { localePath, safeNextPath } from "@/lib/auth";
import { lineSignInConfigured, phoneSignInEnabled } from "@/lib/features";
import { signInHref } from "@/lib/sign-in-link";
import {
  buttonPrimary,
  buttonSecondary,
  card,
  errorNotice,
  formColumn,
  hint,
  input,
  label,
  notice,
} from "@/lib/ui";
import { sendEmailLink, sendPhoneCode, verifyEmailCode, verifyPhoneCode } from "./actions";
import { PRIVATE_PAGE } from "@/lib/seo";

const ERRORS = ["link", "line", "email", "phone", "sms", "code", "rate", "unavailable"] as const;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/sign-in">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "signIn" });
  return { title: t("title"), ...PRIVATE_PAGE };
}

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * Sign-in is never required for SOS, alerts or hotlines (safety rule 1); the page says so first.
 * The forms are plain HTML posts to server actions, so they work before any script has loaded.
 */
export default async function SignIn({ params, searchParams }: PageProps<"/[locale]/sign-in">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  const t = await getTranslations("signIn");
  const tNav = await getTranslations("nav");
  const tUnit = await getTranslations("unitWay");
  const next = safeNextPath(one(query.next)) ?? "";
  const error = ERRORS.find((e) => e === one(query.error));
  const codeStep = one(query.step) === "code" && one(query.phone) !== "";
  const emailAddress = one(query.email);
  const emailCodeStep = one(query.step) === "emailCode" && emailAddress !== "";
  const lineHref = `/api/auth/line?${new URLSearchParams({ locale, ...(next ? { next } : {}) })}`;
  // The registration form is behind this page, so a unit is signed in straight into it: a plain
  // link to the form would only send them back here (18 Oct).
  const unitNext = localePath(locale, "/authority/register");
  const unitHref = `/api/auth/line?${new URLSearchParams({ locale, next: unitNext })}`;
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next} />
    </>
  );

  return (
    <div className={`flex flex-col gap-5 ${formColumn}`}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
      <p className={notice}>{t("visitorNote")}</p>
      {/*
       * A rescue unit, an อปพร. volunteer or an agency that came here to register (the owner,
       * 18 Oct: the sign-in page never said the registration form was behind it). Somebody sent
       * here by the form itself reads this but is not offered a second button: the page's own
       * LINE button below already carries them back to it.
       */}
      <section className={card} data-unit-way="signIn">
        <h2 className="text-body font-bold">{tUnit("title")}</h2>
        <p className={hint}>{tUnit("who")}</p>
        <p className={hint}>{tUnit("signInFirst")}</p>
        {lineSignInConfigured() && next !== unitNext && (
          <LineLink href={unitHref} className={buttonSecondary}>
            {tUnit("register")}
          </LineLink>
        )}
      </section>
      {error && (
        <p role="alert" className={errorNotice}>
          {t(`error.${error}`)}
        </p>
      )}
      {one(query.sent) === "email" && (
        <p role="status" className={errorNotice}>
          {t("sent.email")}
        </p>
      )}

      <section className={card}>
        <h2 className="text-body font-bold">{t("line.title")}</h2>
        {lineSignInConfigured() ? (
          <div className="flex flex-col gap-3">
            {/* A plain link, not a form: a phone only opens the LINE app for a tapped link. */}
            <LineLink href={lineHref} className={buttonPrimary}>
              {t("line.button")}
            </LineLink>
            <p className={hint}>{t("line.note")}</p>
            {/* In-app browsers (Messenger, Chrome on iPhone) get LINE's web page, not the app. */}
            <p className={hint}>{t("line.appHint")}</p>
          </div>
        ) : (
          <p className={hint}>{t("line.unavailable")}</p>
        )}
      </section>

      {phoneSignInEnabled() && (
        <section className={card}>
          <h2 className="text-body font-bold">{t("phone.title")}</h2>
          {codeStep ? (
            <form action={verifyPhoneCode} className="flex flex-col gap-3">
              {hidden}
              <input type="hidden" name="phone" value={one(query.phone)} />
              <p>{t("phone.codeSentTo", { phone: one(query.phone) })}</p>
              <label htmlFor="code" className={label}>
                {t("phone.codeLabel")}
              </label>
              <input
                id="code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                required
                className={input}
              />
              <button type="submit" className={buttonPrimary}>
                {t("phone.verify")}
              </button>
            </form>
          ) : (
            <form action={sendPhoneCode} className="flex flex-col gap-3">
              {hidden}
              <label htmlFor="phone" className={label}>
                {t("phone.label")}
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="08x-xxx-xxxx"
                required
                className={input}
              />
              <button type="submit" className={buttonSecondary}>
                {t("phone.send")}
              </button>
            </form>
          )}
        </section>
      )}

      <details className={card} open={error === "email" || emailCodeStep}>
        <summary className="min-h-tap cursor-pointer py-2 font-bold">{t("admin.summary")}</summary>
        {/* The code, not the link: a link opens the browser, and on an iPhone the browser shares
            no cookies with Jaga on the home screen (owner, 18 Oct). The link is still in the
            email, for a computer. */}
        {emailCodeStep ? (
          <form action={verifyEmailCode} className="flex flex-col gap-3" data-email-code>
            {hidden}
            <input type="hidden" name="email" value={emailAddress} />
            <label htmlFor="emailCode" className={label}>
              {t("admin.codeLabel")}
            </label>
            <input
              id="emailCode"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              required
              className={input}
            />
            <button type="submit" className={buttonPrimary}>
              {t("admin.verify")}
            </button>
            <p className={hint}>{t("admin.codeNote")}</p>
            <a
              href={signInHref(locale, next || null)}
              className={`${hint} inline-flex min-h-tap items-center underline`}
            >
              {t("admin.another")}
            </a>
          </form>
        ) : (
          <form action={sendEmailLink} className="flex flex-col gap-3">
            {hidden}
            <label htmlFor="email" className={label}>
              {t("admin.label")}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              className={input}
            />
            <button type="submit" className={buttonSecondary}>
              {t("admin.send")}
            </button>
            <p className={hint}>{t("admin.note")}</p>
          </form>
        )}
      </details>
      <BackLink label={tNav("backHome")} />
    </div>
  );
}
