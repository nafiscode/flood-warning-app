import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { WeatherExample } from "@/components/dev/Examples";
import { Link } from "@/i18n/navigation";
import { WEATHER_SCENARIOS, type WeatherScenario } from "@/lib/dev-examples";
import { devPagesEnabled } from "@/lib/dev-pages";
import { weatherMessages } from "@/lib/messages";
import { hint } from "@/lib/ui";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The weather page with a made-up forecast, for reading the wording without waiting for real
 * weather (decision 2026-10-08: examples live only on /dev). Development and preview only.
 */
export default async function WeatherExamples({
  params,
  searchParams,
}: PageProps<"/[locale]/dev/weather">) {
  if (!devPagesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("devHome");
  const asked = (await searchParams).s;
  const scenario: WeatherScenario = WEATHER_SCENARIOS.includes(asked as WeatherScenario)
    ? (asked as WeatherScenario)
    : "forecast";

  return (
    <div className="mx-auto flex w-full max-w-[360px] flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-h3 font-bold">{t("weather.title")}</h1>
        <p className={hint}>{t("note")}</p>
        <ul className="flex flex-wrap gap-x-3">
          {WEATHER_SCENARIOS.map((s) => (
            <li key={s}>
              <Link
                href={{ pathname: "/dev/weather", query: { s } }}
                aria-current={s === scenario ? "true" : undefined}
                className={`inline-flex min-h-tap items-center underline ${s === scenario ? "font-bold" : ""}`}
              >
                {t(`weather.${s}`)}
              </Link>
            </li>
          ))}
          <li>
            <Link href="/dev/home" className="inline-flex min-h-tap items-center underline">
              {t("title")}
            </Link>
          </li>
        </ul>
      </header>
      <p className="rounded-xl border-2 border-dashed border-jaga-slate px-4 py-2 text-center font-bold">
        {t("example")}
      </p>
      <NextIntlClientProvider messages={weatherMessages(await getMessages())}>
        <WeatherExample key={scenario} scenario={scenario} />
      </NextIntlClientProvider>
    </div>
  );
}
