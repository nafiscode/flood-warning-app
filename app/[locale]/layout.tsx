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
import { NoticeBell } from "@/components/notices/NoticeBell";
import { ThaiClock } from "@/components/ThaiClock";
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
                    The weather, beside the logo where there is room (the owner's request,
                    9 Oct). A phone has its own copy at the far end of this row, below.
                  */}
                  <WeatherChip where="header" className="hidden lg:inline-flex" />
                  {/* Thailand's time, beside the weather where there is room (the owner, 13 Oct). */}
                  <ThaiClock label={tNav("clock")} className="hidden lg:inline" />
                </div>

                {/*
                  On a phone the top row is the logo with the weather and the bell at its far
                  end, the links take the second row and the languages the third (the owner,
                  13 Oct: the weather belongs at the top right, level with the logo; they chose
                  the extra row over shortening the language names, and it costs 48 px of page).
                  From a tablet's width up there is room for one row again: the links sit before
                  the weather and the bell, and on a laptop the weather is beside the logo.
                  The order in the page is the order on a phone, so the keyboard walks the bar
                  the way it is drawn there.
                */}
                <div className="flex items-center gap-1 sm:order-3">
                  {/* A tablet has room for the time up here; a phone has it by the languages. */}
                  <ThaiClock
                    size="small"
                    label={tNav("clock")}
                    className="hidden sm:inline lg:hidden"
                  />
                  <WeatherChip where="row" className="inline-flex lg:hidden" />
                  {/*
                    The bell: what they missed while the app was closed (the owner's request,
                    10 Oct). Last on the row, so it sits at the far end of the bar where every
                    other app puts it (the owner's note, 12 Oct) - and at the *inline* end, so it
                    follows the writing direction if Jawi is ever chosen.
                  */}
                  <NoticeBell />
                </div>

                <div className="flex w-full items-center sm:order-2 sm:ms-auto sm:w-auto">
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
                <div className="flex w-full items-center justify-between gap-x-1 sm:order-4">
                  <LanguageSwitcher />
                  {/*
                    The time, on a phone: in the room left beside the three language names.
                    Up beside the weather it fitted only while the weather was a short reading;
                    for someone who has not chosen a place yet the pill says "weather" in words,
                    and the two together pushed the top row onto a fourth line.
                  */}
                  <ThaiClock size="small" label={tNav("clock")} className="-me-1 sm:hidden" />
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
