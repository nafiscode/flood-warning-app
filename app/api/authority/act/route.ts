import {
  acceptCase,
  advanceCase,
  completeCase,
  confirmRescue,
  declineCase,
  readAuthorityBoard,
  readCaseMedia,
  releaseCase,
  revealRequesterPhone,
  setDuty,
  setEta,
  setPhoneSharing,
} from "@/lib/authority-board";
import { getSessionProfile } from "@/lib/auth";
import {
  DECLINE_REASONS,
  ETA_BANDS,
  RELEASE_REASONS,
  type DeclineReason,
  type EtaBand,
} from "@/lib/dispatch";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";

/**
 * Everything a responder does from the console (spec 5.2, 5.3): accept, decline, give an arrival
 * estimate, report "on the way" and "arrived", report the rescue with a photo, confirm a rescue
 * nobody confirmed in time, give a case back, look at the requester's number or the case's
 * photos, and the two switches of their own unit.
 *
 * Each one is a database function that checks the caller's unit again; this route only carries
 * the tap there and brings the fresh board back, so the screen never waits for the next refresh.
 * Reasons are chosen from a fixed list, so nothing a person typed travels through here.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });

type Input = {
  action?: string;
  sos?: string;
  unit?: string;
  reason?: string;
  band?: string;
  status?: string;
  on?: boolean;
  photos?: unknown;
  note?: unknown;
};

/** Evidence paths as the phone uploaded them: under this case's proof folder, three at most. */
function proofPaths(sos: string, photos: unknown): string[] {
  if (!Array.isArray(photos)) return [];
  return photos
    .filter((p): p is string => typeof p === "string" && p.startsWith(`${sos}/proof/`))
    .slice(0, 3);
}

function noteText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 1000);
  return trimmed === "" ? null : trimmed;
}

export async function POST(request: Request) {
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  const session = await getSessionProfile();
  if (!session) return answer({ error: "forbidden" }, 404);

  let input: Input;
  try {
    input = (await request.json()) as Input;
  } catch {
    return answer({ error: "bad_request" }, 400);
  }
  const sos = typeof input.sos === "string" && UUID.test(input.sos) ? input.sos : null;
  const unit = typeof input.unit === "string" && UUID.test(input.unit) ? input.unit : null;

  // What only this tap produced: who got there first, or the number that was asked for.
  let extra: Record<string, unknown> = {};
  try {
    switch (input.action) {
      case "accept": {
        if (!sos) return answer({ error: "bad_request" }, 400);
        const result = await acceptCase(sos);
        extra = { taken: result.taken, byUnitName: result.byUnitName };
        break;
      }
      case "decline": {
        const reason = DECLINE_REASONS.find((r) => r === input.reason);
        if (!sos || !reason) return answer({ error: "bad_request" }, 400);
        await declineCase(sos, reason as DeclineReason);
        break;
      }
      case "eta": {
        const band = ETA_BANDS.find((b) => b === input.band);
        if (!sos || !band) return answer({ error: "bad_request" }, 400);
        await setEta(sos, band as EtaBand);
        break;
      }
      case "advance": {
        if (!sos || (input.status !== "en_route" && input.status !== "on_site")) {
          return answer({ error: "bad_request" }, 400);
        }
        await advanceCase(sos, input.status);
        break;
      }
      case "release": {
        const reason = RELEASE_REASONS.find((r) => r === input.reason);
        if (!sos || !reason) return answer({ error: "bad_request" }, 400);
        await releaseCase(sos, reason);
        break;
      }
      case "phone": {
        if (!sos) return answer({ error: "bad_request" }, 400);
        // Logged by the database function itself, one line per look (safety rule 5).
        extra = { phone: await revealRequesterPhone(sos) };
        break;
      }
      case "complete": {
        if (!sos) return answer({ error: "bad_request" }, 400);
        const photos = proofPaths(sos, input.photos);
        // Said here as well as in the database, so the screen can name what is missing.
        if (photos.length === 0) return answer({ error: "photo_required" }, 400);
        await completeCase(sos, photos, noteText(input.note));
        break;
      }
      case "confirm": {
        if (!sos) return answer({ error: "bad_request" }, 400);
        const photos = proofPaths(sos, input.photos);
        const note = noteText(input.note);
        if (photos.length === 0) return answer({ error: "photo_required" }, 400);
        if (!note) return answer({ error: "note_required" }, 400);
        await confirmRescue(sos, photos, note);
        break;
      }
      case "media": {
        if (!sos) return answer({ error: "bad_request" }, 400);
        extra = { media: await readCaseMedia(sos) };
        break;
      }
      case "duty": {
        if (!unit || typeof input.on !== "boolean") return answer({ error: "bad_request" }, 400);
        await setDuty(unit, input.on);
        break;
      }
      case "sharing": {
        if (!unit || typeof input.on !== "boolean") return answer({ error: "bad_request" }, 400);
        await setPhoneSharing(unit, input.on);
        break;
      }
      default:
        return answer({ error: "bad_request" }, 400);
    }
  } catch {
    // The database said no: not this person's unit, not their case, or the case has closed.
    return answer({ error: "refused" }, 409);
  }

  try {
    return answer({ ...extra, board: await readAuthorityBoard(session.userId) });
  } catch {
    return answer({ ...extra, board: null });
  }
}
