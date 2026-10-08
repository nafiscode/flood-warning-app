import { inService } from "@/lib/features";
import { toPublicAlert, type PublicAlert, type PublicStatus } from "@/lib/public-status";
import { supabaseConfigured } from "@/lib/supabase/env";
import { CACHE_60S, createPublicClient, unavailable } from "@/lib/supabase/public";

/**
 * Every alert in force, for the home screen and the map: one address for everyone, kept at the
 * edge for 60 s. It carries no issuer identity and nothing about reports or SOS (safety rule 6).
 * A failure is an error, never an empty list: "no alerts" must not be shown by mistake.
 */
export async function GET() {
  if (!supabaseConfigured()) return unavailable();
  const { data, error } = await createPublicClient().rpc("public_alert_status");
  if (error || !Array.isArray(data)) return unavailable();
  const body: PublicStatus = {
    generatedAt: new Date().toISOString(),
    inService: inService(),
    alerts: (data as Record<string, unknown>[])
      .map(toPublicAlert)
      .filter((a): a is PublicAlert => a !== null),
  };
  return Response.json(body, { headers: { "Cache-Control": CACHE_60S } });
}
