import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { safeNextPath } from "@/lib/auth";
import { lineSignInConfigured, phoneSignInEnabled } from "@/lib/features";
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
import { sendEmailLink, sendPhoneCode, verifyPhoneCode } from "./actions";

const ERRORS = ["link", "line", "email", "phone", "sms", "code", "rate", "unavailable"] as const;

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/sign-in">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "signIn" });
  return { title: t("title") };
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
  const next = safeNextPath(one(query.next)) ?? "";
  const error = ERRORS.find((e) => e === one(query.error));
  const codeStep = one(query.step) === "code" && one(query.phone) !== "";
  const lineHref = `/api/auth/line?${new URLSearchParams({ locale, ...(next ? { next } : {}) })}`;
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next} />
    </>
  );

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-h3 font-bold text-jaga-slate">{t("title")}</h1>
      <p className={notice}>{t("visitorNote")}</p>
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
            <a href={lineHref} rel="nofollow" className={buttonPrimary}>
              {t("line.button")}
            </a>
            <p className={hint}>{t("line.note")}</p>
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

      <details className={card} open={error === "email" || one(query.sent) === "email"}>
        <summary className="min-h-tap cursor-pointer py-2 font-bold">{t("admin.summary")}</summary>
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
      </details>
    </div>
  );
}
