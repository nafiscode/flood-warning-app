import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignalsView } from "@/components/admin/Signals";
import { devPagesEnabled } from "@/lib/dev-pages";
import { EXAMPLE_SIGNALS } from "@/lib/signals-examples";
import { hint } from "@/lib/ui";

export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The signal dashboard with made-up figures, to be looked at without signing in as an admin
 * (development and preview only, lib/dev-pages.ts). The real one is /admin/signals. The threshold
 * forms are shown without their save button here: there is nothing to save to.
 */
export default async function SignalsExamplePage({ params }: PageProps<"/[locale]/dev/signals">) {
  if (!devPagesEnabled()) notFound();
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("signals");
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <h1 className="text-h3 font-bold">{t("devTitle")}</h1>
        <p className={hint}>{t("devNote")}</p>
      </header>
      <SignalsView
        data={EXAMPLE_SIGNALS}
        locale={locale}
        t={(key, values) => t(key as never, values as never)}
      />
    </div>
  );
}
