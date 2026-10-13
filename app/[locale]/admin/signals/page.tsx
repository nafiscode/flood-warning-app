import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignalsView } from "@/components/admin/Signals";
import { isAdminHere } from "@/lib/admin-guard";
import { toSignals } from "@/lib/signals";
import { createClient } from "@/lib/supabase/server";
import { hint } from "@/lib/ui";
import { setThreshold } from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/signals">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "signals" });
  return { title: t("title") };
}

export const dynamic = "force-dynamic";

/**
 * The signal dashboard (spec 6.3): per warning zone, the gauges against their thresholds, the
 * rain behind and ahead, the modelled flow, the tide, and a suggested level with its reasons.
 * Advisory only. The one thing this page can change is a threshold; publishing an alert is done
 * on the alert console, by a person (safety rule 2).
 */
export default async function SignalsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/signals">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const query = await searchParams;
  if (!(await isAdminHere())) return null;
  const t = await getTranslations("signals");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_signals");
  if (error) return <p className={hint}>{t("noZones")}</p>;
  const saved = typeof query.saved === "string" ? query.saved : null;
  const notice = saved
    ? t("thresholds.saved")
    : query.error === "threshold"
      ? t("thresholds.error")
      : null;
  return (
    <SignalsView
      data={toSignals(data)}
      locale={locale}
      t={(key, values) => t(key as never, values as never)}
      action={setThreshold.bind(null, locale)}
      notice={notice}
      savedZone={saved}
    />
  );
}
