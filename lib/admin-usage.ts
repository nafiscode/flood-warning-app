/**
 * The usage dashboard's read, on the server, with the admin's own session: admin_usage() refuses
 * everyone who is not an admin, and returns counts and rough places only (no install code, no
 * session, no single phone).
 */
import { createClient } from "@/lib/supabase/server";
import { toUsage, type UsageData, type UsageWindow } from "@/lib/usage";

export async function readUsage(days: UsageWindow): Promise<UsageData | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_usage", { p_days: days });
  if (error || !data) return null;
  return toUsage(data);
}
