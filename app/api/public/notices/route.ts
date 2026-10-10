import { toNoticeRow, type NoticeRow } from "@/lib/notices";
import { supabaseConfigured } from "@/lib/supabase/env";
import { CACHE_60S, createPublicClient, unavailable } from "@/lib/supabase/public";

/**
 * The last fourteen days of alerts and announcements for a set of tambons: what the bell shows
 * (the owner's request, 10 Oct). The tambons are the person's own area, home and watched places,
 * and nothing else is sent, so the answer is the same for everyone asking about the same places
 * and can sit in the shared cache. No SOS of theirs passes through here: the browser reads its
 * own case with its own token.
 *
 * A failure is an error, never an empty list: "you missed nothing" must not be shown by mistake.
 */
const CODE = /^[0-9]{6}$/;

export async function GET(request: Request) {
  if (!supabaseConfigured()) return unavailable();
  const asked = new URL(request.url).searchParams.get("t") ?? "";
  // Sorted and deduplicated, so two phones watching the same places share one cached answer.
  const tambons = [...new Set(asked.split(",").filter((code) => CODE.test(code)))]
    .sort()
    .slice(0, 60);
  if (tambons.length === 0) {
    return Response.json({ notices: [] as NoticeRow[] }, { headers: { "Cache-Control": CACHE_60S } });
  }
  const { data, error } = await createPublicClient().rpc("public_notices", {
    p_tambons: tambons,
  });
  if (error || !Array.isArray(data)) return unavailable();
  const notices = (data as Record<string, unknown>[])
    .map(toNoticeRow)
    .filter((row): row is NoticeRow => row !== null);
  return Response.json({ notices }, { headers: { "Cache-Control": CACHE_60S } });
}
