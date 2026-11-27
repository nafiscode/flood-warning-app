import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PlanWatch } from "@/components/admin/PlanWatch";
import { isAdminHere } from "@/lib/admin-guard";
import { readPlanHealth, readPlanReadings } from "@/lib/admin-plans";
import { adviseService, PLAN_SERVICES } from "@/lib/plan-limits";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/plans">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "plans" });
  return { title: t("title") };
}

export const dynamic = "force-dynamic";

const ERRORS = ["meter", "value", "date", "save"] as const;

/**
 * How close Jaga is to the end of the Vercel and Supabase free plans, and when to upgrade (the
 * owner, 27 Nov 2026). The readings an admin typed in and the database's own nightly snapshots
 * become a verdict per service (now, soon, later) and a range of dates. Advice only: it changes
 * nothing, publishes nothing and never touches an alert. Admins only: the layout turns everyone
 * else away, and every function behind the page refuses them again in the database.
 */
export default async function PlansPage({
  params,
  searchParams,
}: PageProps<"/[locale]/admin/plans">) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!(await isAdminHere())) return null;
  const query = await searchParams;
  const [readings, health] = await Promise.all([readPlanReadings(), readPlanHealth()]);
  const now = new Date();
  const list = readings ?? [];
  const advice = PLAN_SERVICES.map((s) => adviseService(s, list, now));
  const error = ERRORS.find((e) => e === query.error) ?? null;
  return (
    <PlanWatch
      locale={locale}
      advice={advice}
      readings={list}
      health={health}
      now={now}
      notices={{ saved: query.saved === "1", removed: query.removed === "1", error }}
    />
  );
}
