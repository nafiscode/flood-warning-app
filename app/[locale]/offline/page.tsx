import { getTranslations, setRequestLocale } from "next-intl/server";
import { OfflineRetry } from "@/components/OfflineRetry";

/** Precached by the service worker; shown when a page can't load. The hotline bar stays below. */
export default async function Offline({ params }: PageProps<"/[locale]/offline">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("offline");
  return (
    <section className="flex flex-col gap-3">
      <h1 className="text-h3 font-bold text-jaga-slate">{t("title")}</h1>
      <p>{t("body")}</p>
      <OfflineRetry label={t("retry")} />
    </section>
  );
}
