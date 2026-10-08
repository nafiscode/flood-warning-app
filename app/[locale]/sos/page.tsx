import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CallNow } from "@/components/CallNow";
import { Link } from "@/i18n/navigation";
import { buttonSecondary } from "@/lib/ui";

export async function generateMetadata({ params }: PageProps<"/[locale]/sos">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "sos" });
  return { title: t("label") };
}

/**
 * Where the SOS button leads until the SOS flow is built (A4). It must not look as if a request
 * was sent: it says plainly that nobody receives requests from the app yet, and puts the
 * official numbers one tap away (safety rules 1 and 4).
 */
export default async function SosSoon({ params }: PageProps<"/[locale]/sos">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("soon");
  return (
    <section className="flex flex-col gap-4" data-sos-soon="true">
      <h1 className="text-h3 font-bold text-jaga-slate">{t("sosTitle")}</h1>
      <p>{t("sosBody")}</p>
      <CallNow />
      <Link href="/" className={buttonSecondary}>
        {t("back")}
      </Link>
    </section>
  );
}
