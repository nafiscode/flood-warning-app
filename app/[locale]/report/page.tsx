import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { ReportForm } from "@/components/report/ReportForm";
import { NotYet } from "@/components/sos/NotYet";
import { getPathname, Link } from "@/i18n/navigation";
import { getSessionProfile } from "@/lib/auth";
import { sosSendingEnabled } from "@/lib/features";
import { reportMessages } from "@/lib/messages";
import { buttonPrimary, buttonSecondary, notice } from "@/lib/ui";

/**
 * Rendered per request, not at build time. The launch switch and the "not in service yet" page it
 * controls are read here, and a prerendered page would freeze whichever answer the build saw: on
 * launch day the switch would do nothing until someone rebuilt the site. The page is small and
 * fetches nothing, and the service worker keeps the last visited copy for offline.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/report">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "report" });
  return { title: t("title") };
}

/**
 * The flood report (spec 4.5). Reports are a signed-in feature (spec section 3), so someone
 * without an account is offered sign-in - and told that asking for help never needs one.
 * Before the launch switch, this is the "not working yet" page with the hotlines.
 */
export default async function ReportPage({ params }: PageProps<"/[locale]/report">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("report");

  if (!sosSendingEnabled()) {
    return (
      <NotYet
        title={t("soonTitle")}
        body={t("soonBody")}
        back={t("home")}
        backHref={getPathname({ href: "/", locale })}
      />
    );
  }

  const profile = await getSessionProfile();
  if (!profile) {
    return (
      <section className="flex flex-col gap-4" data-report-state="signIn">
        <h1 className="text-h3 font-bold text-jaga-slate">{t("signInTitle")}</h1>
        <p>{t("signInBody")}</p>
        <Link href="/sign-in" className={buttonPrimary}>
          {t("signIn")}
        </Link>
        <p className={notice}>{t("notEmergency")}</p>
        <Link href="/sos" className={buttonSecondary}>
          SOS
        </Link>
      </section>
    );
  }

  return (
    <NextIntlClientProvider messages={reportMessages(await getMessages())}>
      <ReportForm />
    </NextIntlClientProvider>
  );
}
