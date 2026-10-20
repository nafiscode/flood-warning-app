import { peopleTambons, previewAlert, readAreas, zoneMap } from "@/lib/admin-alerts";
import { areaChoice, chosenTambons, drillAudience, isUuid } from "@/lib/alert-console";
import { getSessionProfile, isAdminRole } from "@/lib/auth";
import { inService } from "@/lib/features";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";

/**
 * The review step of the alert console (spec 6.2): the words exactly as they would be sent, how
 * many people they would reach, and which of the chosen tambons already have an alert. It sends
 * nothing and changes nothing. The area is worked out here the same way the publish action does
 * it, so the count an admin reviews is the count that is published.
 */
const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });

export async function POST(request: Request) {
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  const session = await getSessionProfile();
  if (!session || !isAdminRole(session.role)) return answer({ error: "forbidden" }, 404);

  let input: Record<string, unknown>;
  try {
    input = (await request.json()) as Record<string, unknown>;
  } catch {
    return answer({ error: "bad_request" }, 400);
  }
  if (!isUuid(input.template)) return answer({ error: "template" }, 400);
  const list = (name: string) => (Array.isArray(input[name]) ? (input[name] as unknown[]) : []);

  try {
    const choice = areaChoice(list);
    const areas = await readAreas();
    const tambons = chosenTambons(
      areas.tambons.map((t) => t.code),
      choice,
      zoneMap(areas),
      choice.people ? await peopleTambons() : [],
    );
    if (tambons.length === 0) return answer({ error: "area" }, 400);
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 400) : "";
    const preview = await previewAlert(
      input.template,
      tambons,
      note,
      drillAudience(list("drillAudience")),
    );
    if (!preview) return answer({ error: "unavailable" }, 502);
    return answer({ preview, launched: inService() });
  } catch {
    return answer({ error: "unavailable" }, 502);
  }
}
