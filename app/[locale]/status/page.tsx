import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { PRIVATE_PAGE } from "@/lib/seo";
import { readServiceStatus, type ServiceLevel } from "@/lib/status-notice";
import { BANGKOK_DATE_TIME } from "@/lib/time";
import { formColumn } from "@/lib/ui";

/*
 * Baked at deploy time from public/status/notice.json, so /status is a static file on the CDN and
 * answers even while the database and the consoles are down (docs/runbook.md, "Static status
 * page"). It changes only when the owner commits the note. Kept out of search: it is an
 * operational page, not something a reader should land on from a query (like /offline).
 */
export const dynamic = "force-static";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const metadata: Metadata = PRIVATE_PAGE;

/**
 * A plain mark, never the alert palette and never an eye or umbrella (brand rules): a tick when
 * all is well, a warning triangle when the owner has posted a note. The state is carried by the
 * heading text beside it, so the icon is decorative.
 */
function StatusMark({ level }: { level: ServiceLevel }) {
  const common = {
    width: 28,
    height: 28,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "shrink-0 text-jaga-ink",
  };
  if (level === "ok") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="m8.5 12 2.5 2.5 4.5-5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

/**
 * /status: whether Jaga itself is working, from a file in the repo rather than the database, so
 * it keeps answering during an outage. Public, no account, the same for everyone.
 */
export default async function StatusPage({ params }: PageProps<"/[locale]/status">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("status");
  const format = await getFormatter();
  const status = await readServiceStatus(locale as Locale);

  const heading =
    status.level === "down"
      ? t("down.title")
      : status.level === "degraded"
        ? t("degraded.title")
        : t("ok.title");

  const since =
    status.since && !Number.isNaN(Date.parse(status.since))
      ? format.dateTime(new Date(status.since), BANGKOK_DATE_TIME)
      : null;

  return (
    <section className={`flex flex-col gap-4 ${formColumn}`}>
      <h1 className="text-h3 font-bold text-jaga-ink">{t("title")}</h1>
      <p className="text-small text-jaga-text-2">{t("intro")}</p>

      <div className="flex flex-col gap-2 rounded-lg border border-jaga-line bg-jaga-surface p-4">
        <div className="flex items-center gap-3">
          <StatusMark level={status.level} />
          <h2 className="font-bold text-jaga-ink">{heading}</h2>
        </div>
        {status.level === "ok" ? (
          <p className="text-jaga-ink">{t("ok.body")}</p>
        ) : (
          <>
            {status.message && (
              <p className="whitespace-pre-line text-jaga-ink">{status.message}</p>
            )}
            {since && (
              <p className="text-small text-jaga-text-2">{t("posted", { time: since })}</p>
            )}
          </>
        )}
      </div>

      <p className="text-jaga-ink">{t("emergency")}</p>

      <Link
        href="/"
        prefetch={false}
        className="inline-flex min-h-tap items-center self-start rounded px-1 font-medium text-jaga-teal underline"
      >
        {t("home")}
      </Link>
    </section>
  );
}
