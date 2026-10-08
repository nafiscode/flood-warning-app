import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { HomeExample } from "@/components/dev/Examples";
import { Link } from "@/i18n/navigation";
import { HOME_SCENARIOS, type HomeScenario } from "@/lib/dev-examples";
import { devPagesEnabled } from "@/lib/dev-pages";
import { homeMessages } from "@/lib/messages";
import { hint } from "@/lib/ui";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The home screen in each of its states, with made-up alerts (decision 2026-10-08: examples
 * live only here, never in the database). Development and preview only.
 */
export default async function HomeExamples({
  params,
  searchParams,
}: PageProps<"/[locale]/dev/home">) {
  if (!devPagesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("devHome");
  const asked = (await searchParams).s;
  const scenario: HomeScenario = HOME_SCENARIOS.includes(asked as HomeScenario)
    ? (asked as HomeScenario)
    : "warning";

  return (
    <div className="mx-auto flex w-full max-w-[360px] flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-h3 font-bold">{t("title")}</h1>
        <p className={hint}>{t("note")}</p>
        <ul className="flex flex-wrap gap-x-3">
          {HOME_SCENARIOS.map((s) => (
            <li key={s}>
              <Link
                href={{ pathname: "/dev/home", query: { s } }}
                aria-current={s === scenario ? "true" : undefined}
                className={`inline-flex min-h-tap items-center underline ${s === scenario ? "font-bold" : ""}`}
              >
                {t(`scenario.${s}`)}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/dev/map" className="inline-flex min-h-tap items-center underline">
              {t("mapTitle")}
            </Link>
          </li>
        </ul>
      </header>
      <p className="rounded-xl border-2 border-dashed border-jaga-slate px-4 py-2 text-center font-bold">
        {t("example")}
      </p>
      <NextIntlClientProvider messages={homeMessages(await getMessages())}>
        <HomeExample key={scenario} scenario={scenario} />
      </NextIntlClientProvider>
    </div>
  );
}
