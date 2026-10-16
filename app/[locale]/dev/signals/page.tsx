import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignalsView } from "@/components/admin/Signals";
import { devPagesEnabled } from "@/lib/dev-pages";
import {
  EXAMPLE_COASTAL_GATE,
  EXAMPLE_GAUGE_LEVELS,
  EXAMPLE_SIGNALS,
} from "@/lib/signals-examples";
import { toReferences } from "@/lib/coastal-gate";
import { withGaugeLevels } from "@/lib/signals";
import { hint } from "@/lib/ui";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The signal dashboard with made-up figures, to be looked at without signing in as an admin
 * (development and preview only, lib/dev-pages.ts). The real one is /admin/signals. The threshold
 * forms are shown without their save button here: there is nothing to save to.
 */
export default async function SignalsExamplePage({
  params,
  searchParams,
}: PageProps<"/[locale]/dev/signals">) {
  if (!devPagesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("signals");
  const query = await searchParams;
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-h3 font-bold">{t("devTitle")}</h1>
        <p className={hint}>{t("devNote")}</p>
      </header>
      <SignalsView
        data={withGaugeLevels(EXAMPLE_SIGNALS, EXAMPLE_GAUGE_LEVELS)}
        gates={toReferences(EXAMPLE_COASTAL_GATE)}
        view={query.view === "map" ? "map" : "cards"}
        locale={locale}
        t={(key, values) => t(key as never, values as never)}
      />
    </div>
  );
}
