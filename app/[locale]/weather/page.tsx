import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { WeatherScreen } from "@/components/weather/WeatherScreen";
import { weatherMessages } from "@/lib/messages";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/weather">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "weather" });
  return { title: t("title"), description: t("notAnAlert") };
}

/**
 * The weather page behind the header's weather chip (owner's request, 9 Oct 2026): current
 * conditions, the next 48 hours of rain, 24 hours hour by hour and seven days, for the place the
 * person is looking at. Plain weather from a global model, never a Jaga flood alert: the page
 * says so, shows the time its data is from and credits Open-Meteo (safety rule 8).
 */
export default async function WeatherPage({ params }: PageProps<"/[locale]/weather">) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <NextIntlClientProvider messages={weatherMessages(await getMessages())}>
      <WeatherScreen />
    </NextIntlClientProvider>
  );
}
