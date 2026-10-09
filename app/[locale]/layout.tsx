import { SerwistProvider } from "@serwist/turbopack/react";
import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { AdminLink } from "@/components/AdminLink";
import { Logo } from "@/components/brand/Logo";
import { HotlineBar } from "@/components/HotlineBar";
import { DaylightTheme } from "@/components/DaylightTheme";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { QueueRunner } from "@/components/QueueRunner";
import { WeatherChip } from "@/components/weather/WeatherChip";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { DAYLIGHT_SCRIPT } from "@/lib/theme-script";
import { layoutMessages } from "@/lib/messages";
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
  // The phone's own bars follow the app: brand slate by day, the night slate after sunset.
  // The browser picks by the colour scheme the page declares (app/globals.css).
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1D3B53" },
    { media: "(prefers-color-scheme: dark)", color: "#0F1C26" },
  ],
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
  const clientMessages = layoutMessages(await getMessages());

  return (
    // scroll-pt-28: an anchor such as #main scrolls to just below the frozen header.
    <html lang={locale} dir="ltr" className={`${plex.variable} scroll-pt-28`}>
      <body className="flex min-h-dvh flex-col">
        {/* Before anything is painted: the colours of the app follow the sun, not a switch. */}
        <script dangerouslySetInnerHTML={{ __html: DAYLIGHT_SCRIPT }} />
        {/*
          reloadOnOnline is off: Serwist reloads the page by default when the connection returns,
          which on the SOS screens would throw away what someone is in the middle of (a typed
          phone number, the details of an open case) at the worst moment. The offline queue
          notices the connection itself (lib/queue.ts, components/QueueRunner.tsx).
        */}
        <SerwistProvider
          swUrl="/serwist/sw.js"
          disable={process.env.NODE_ENV === "development"}
          reloadOnOnline={false}
        >
          <NextIntlClientProvider messages={clientMessages}>
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-jaga-surface focus:px-4 focus:py-2"
            >
              {t("skipToContent")}
            </a>
            {/*
              The header stays put while the page scrolls (the owner's request, 8 Oct): the logo,
              Home, Map, Account and the languages are reachable from anywhere on a long page,
              as the hotline bar already is at the bottom. It sits above the page but below the
              skip link.
            */}
            <header className="sticky top-0 z-20 bg-jaga-slate">
              <div className="mx-auto flex w-full max-w-screen-sm flex-wrap items-center justify-between gap-x-2 px-2 lg:max-w-6xl lg:px-4">
                <div className="flex items-center gap-2">
                  <Link href="/" prefetch={false} className="inline-flex min-h-tap items-center">
                    <Logo size={40} tone="reverse" animated />
                  </Link>
                  {/*
                    The weather, in the header's free space (the owner's request, 9 Oct): beside
                    the logo where there is room, and at the end of the language row on a phone,
                    where the top row is already full of Thai labels at 360 px.
                  */}
                  <WeatherChip where="header" className="hidden lg:inline-flex" />
                </div>
                <div className="flex items-center">
                  {/* Home as a word, not only the logo: people don't tap a logo to go back. */}
                  <Link
                    href="/"
                    prefetch={false}
                    className="inline-flex min-h-tap items-center rounded px-2 text-small font-medium text-white underline"
                  >
                    {tNav("home")}
                  </Link>
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
                  {/* Only an admin ever sees this one, and only in their own browser. */}
                  <AdminLink />
                </div>
                {/* Languages on their own row: three names don't fit beside the logo at 360 px. */}
                <div className="flex w-full items-center justify-between gap-x-1">
                  <LanguageSwitcher />
                  {/* -me-1 uses the row's own end padding: at 360 px the three language names
                      and the chip together need every pixel of the line. */}
                  <WeatherChip where="row" className="-me-1 inline-flex lg:hidden" />
                </div>
              </div>
            </header>
            {/*
              Phone width up to the large breakpoint, then the window: on a laptop the app fills
              the browser instead of sitting in a narrow strip (the owner's request, 8 Oct). The
              pages themselves decide what to do with the room; text columns stay readable.
            */}
            <main
              id="main"
              className="mx-auto w-full max-w-screen-sm flex-1 px-4 py-6 lg:max-w-6xl lg:px-6"
            >
              {children}
            </main>
            <footer className="sticky bottom-0 z-10">
              <HotlineBar />
            </footer>
            <QueueRunner />
            <DaylightTheme />
          </NextIntlClientProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}
