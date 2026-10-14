import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SignalsView } from "@/components/admin/Signals";
import { isAdminHere } from "@/lib/admin-guard";
import { toSignals, withGaugeLevels } from "@/lib/signals";
import { createClient } from "@/lib/supabase/server";
import { hint } from "@/lib/ui";
import {
  dismissAutoAlarm,
  setAutoAlarm,
  setAutoMode,
  setGaugeLevels,
  setThreshold,
} from "./actions";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/signals">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "signals" });
  return { title: t("title") };
}

export const dynamic = "force-dynamic";

/** Gauges are fetched every 15 minutes; reading the page every 5 shows a new one within 5. */
const REFRESH_MINUTES = 5;

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
  const [{ data, error }, levels] = await Promise.all([
    supabase.rpc("admin_signals"),
    supabase.rpc("admin_gauge_levels"),
  ]);
  if (error) return <p className={hint}>{t("noZones")}</p>;
  const saved = typeof query.saved === "string" ? query.saved : null;
  const autoNotice =
    query.autosaved === "1"
      ? t("auto.saved")
      : query.error === "auto"
        ? t("auto.error")
        : query.levels === "1"
          ? t("map.levels.saved")
          : query.error === "levels"
            ? t("map.levels.error")
            : null;
  const notice =
    autoNotice ??
    (saved ? t("thresholds.saved") : query.error === "threshold" ? t("thresholds.error") : null);
  return (
    <SignalsView
      data={withGaugeLevels(toSignals(data), levels.data)}
      locale={locale}
      t={(key, values) => t(key as never, values as never)}
      action={setThreshold.bind(null, locale)}
      notice={notice}
      savedZone={saved}
      view={query.view === "map" ? "map" : "cards"}
      autoAction={setAutoAlarm.bind(null, locale)}
      allAction={setAutoAlarm.bind(null, locale)}
      modeAction={setAutoMode.bind(null, locale)}
      dismissAction={dismissAutoAlarm.bind(null, locale)}
      levelsAction={setGaugeLevels.bind(null, locale)}
      refreshMinutes={REFRESH_MINUTES}
    />
  );
}
