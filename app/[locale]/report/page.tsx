import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CallNow } from "@/components/CallNow";
import { Link } from "@/i18n/navigation";
import { buttonSecondary } from "@/lib/ui";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/report">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "home" });
  return { title: t("report") };
}

/** Where "Report flooding" leads until the report form is built (A4). */
export default async function ReportSoon({ params }: PageProps<"/[locale]/report">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("soon");
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-h3 font-bold text-jaga-slate">{t("reportTitle")}</h1>
      <p>{t("reportBody")}</p>
      <CallNow />
      <Link href="/" className={buttonSecondary}>
        {t("back")}
      </Link>
    </section>
  );
}
