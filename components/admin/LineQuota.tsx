import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { errorNotice, hint, notice } from "@/lib/ui";

/** The share of the month's LINE messages at which the admins are warned (CLAUDE.md, budget). */
export const LINE_WARN_AT = [0.7, 0.9] as const;

export function lineQuotaLevel(used: number, limit: number): "ok" | "70" | "90" | "full" {
  if (limit <= 0) return "ok";
  const share = used / limit;
  return share >= 1 ? "full" : share >= 0.9 ? "90" : share >= 0.7 ? "70" : "ok";
}

/**
 * The month's LINE messages, as LINE itself last counted them, for the admins who are about to
 * send an alert (A7). Quiet while there is room; a warning from 70% on, and a plain statement
 * when the month is spent, that LINE will refuse the rest and the alert still goes by phone
 * notification, the app and the bell. Nothing is drawn before LINE has been asked once.
 */
export async function LineQuota() {
  const t = await getTranslations("lineQuota");
  const supabase = await createClient();
  const { data } = await supabase.rpc("line_quota_now");
  const row = (Array.isArray(data) ? data[0] : data) as
    { used: number; monthly_limit: number } | undefined;
  if (!row || row.monthly_limit <= 0) return null;
  const level = lineQuotaLevel(row.used, row.monthly_limit);
  const values = { used: row.used, limit: row.monthly_limit };
  return (
    <p
      data-line-quota={level}
      role={level === "ok" ? undefined : "status"}
      className={level === "ok" ? hint : level === "70" ? notice : errorNotice}
    >
      {t(level === "ok" ? "ok" : level === "full" ? "full" : "warn", values)}
    </p>
  );
}
