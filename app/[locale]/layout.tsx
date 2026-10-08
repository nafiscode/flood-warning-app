import { SerwistProvider } from "@serwist/turbopack/react";
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { Logo } from "@/components/brand/Logo";
import { HotlineBar } from "@/components/HotlineBar";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import "../globals.css";

// Self-hosted at build time by next/font: no request to Google from users' phones.
const plex = IBM_Plex_Sans_Thai({
  weight: ["400", "500", "700"],
  subsets: ["thai", "latin"],
  variable: "--font-plex-thai",
  display: "swap",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app" });
  return {
    title: { default: t("pwaName"), template: "%s · Jaga" },
    description: t("description"),
    applicationName: "Jaga",
    icons: {
      icon: [
        { url: "/brand/favicon.svg", type: "image/svg+xml" },
        { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      ],
      apple: "/icons/apple-touch-icon.png",
    },
    appleWebApp: { capable: true, title: "Jaga", statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  themeColor: "#1D3B53",
  width: "device-width",
  initialScale: 1,
};

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("app");
  const tNav = await getTranslations("nav");
  // Only client components need messages in the browser; send just their namespaces (slow 3G).
  const messages = await getMessages();
  const clientMessages = { language: messages.language };

  return (
    <html lang={locale} dir="ltr" className={plex.variable}>
      <body className="flex min-h-dvh flex-col">
        <SerwistProvider swUrl="/serwist/sw.js" disable={process.env.NODE_ENV === "development"}>
          <NextIntlClientProvider messages={clientMessages}>
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-jaga-surface focus:px-4 focus:py-2"
            >
              {t("skipToContent")}
            </a>
            <header className="bg-jaga-slate">
              <div className="mx-auto flex max-w-screen-sm flex-wrap items-center justify-between gap-x-2 px-2">
                <Link href="/" prefetch={false} className="inline-flex min-h-tap items-center">
                  <Logo size={40} tone="reverse" />
                </Link>
                <div className="flex items-center">
                  <Link
                    href="/map"
                    prefetch={false}
                    className="inline-flex min-h-tap items-center rounded px-2 text-small font-medium text-white underline"
                  >
                    {tNav("map")}
                  </Link>
                  <Link
                    href="/account"
                    prefetch={false}
                    className="inline-flex min-h-tap items-center rounded px-2 text-small font-medium text-white underline"
                  >
                    {tNav("account")}
                  </Link>
                </div>
                {/* Languages on their own row: three names don't fit beside the logo at 360 px. */}
                <div className="w-full">
                  <LanguageSwitcher />
                </div>
              </div>
            </header>
            <main id="main" className="mx-auto w-full max-w-screen-sm flex-1 px-4 py-6">
              {children}
            </main>
            <footer className="sticky bottom-0 z-10">
              <HotlineBar />
            </footer>
          </NextIntlClientProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}
