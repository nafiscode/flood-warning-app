import { confirmRescue } from "@/lib/authority-board";
import { getSessionProfile, isAdminRole } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";

/**
 * An admin confirms a rescue the person never confirmed (spec 5.4): a photo that was really
 * uploaded and a note saying how it was checked. The database function decides everything again -
 * that the caller is an admin, that the person has had their time, that the photo exists - and
 * writes the confirmation to the access log.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });

export async function POST(request: Request) {
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  const session = await getSessionProfile();
  if (!session || !isAdminRole(session.role)) return answer({ error: "forbidden" }, 404);

  let input: { sos?: unknown; photos?: unknown; note?: unknown };
  try {
    input = (await request.json()) as typeof input;
  } catch {
    return answer({ error: "bad_request" }, 400);
  }
  const sos = typeof input.sos === "string" && UUID.test(input.sos) ? input.sos : null;
  if (!sos) return answer({ error: "bad_request" }, 400);
  const photos = Array.isArray(input.photos)
    ? input.photos
        .filter((p): p is string => typeof p === "string" && p.startsWith(`${sos}/proof/`))
        .slice(0, 3)
    : [];
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 1000) : "";
  if (photos.length === 0) return answer({ error: "photo_required" }, 400);
  if (note === "") return answer({ error: "note_required" }, 400);

  try {
    await confirmRescue(sos, photos, note);
  } catch {
    // Too early, already confirmed, or no such photo: the database said no.
    return answer({ error: "refused" }, 409);
  }
  return answer({ ok: true });
}
