import { getTranslations, setRequestLocale } from "next-intl/server";

/**
 * A0 placeholder home. It deliberately shows no alert level: a placeholder must never look like
 * "no risk" (safety rule 10). It points to official warnings and the hotlines instead.
 * The real home (alert hero, safe places, SOS) arrives in A3.
 */
export default async function Home({ params }: PageProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-jaga-line bg-jaga-surface p-5">
      <h1 className="text-h3 font-bold text-jaga-slate">{t("title")}</h1>
      <p>{t("body")}</p>
      <p className="font-medium">{t("emergency")}</p>
    </section>
  );
}
