import { after } from "next/server";
import {
  advanceCase,
  completeCase,
  revealRequesterPhone,
  unassignCase,
} from "@/lib/authority-board";
import { getSessionProfile } from "@/lib/auth";
import { readMyWork, takeCase } from "@/lib/field-crew";
import { runPushTick } from "@/lib/push-server";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";

/**
 * What a crew member does on their own phone (24 Oct 2026): see the cases handed to them, take
 * an open one, say "on the way" and "arrived", look at the requester's number, report the
 * rescue with photos, or step off a case. Each tap is a database function that checks the
 * assignment again; this route only carries it there and brings the fresh list back.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });

type Input = {
  action?: string;
  sos?: string;
  id?: string;
  status?: string;
  photos?: unknown;
  note?: unknown;
};

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

export async function GET() {
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  if (!(await getSessionProfile())) return answer({ error: "forbidden" }, 404);
  try {
    return answer(await readMyWork());
  } catch {
    return answer({ error: "failed" }, 500);
  }
}

export async function POST(request: Request) {
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  if (!(await getSessionProfile())) return answer({ error: "forbidden" }, 404);
  let input: Input;
  try {
    input = (await request.json()) as Input;
  } catch {
    return answer({ error: "bad_request" }, 400);
  }
  const sos = typeof input.sos === "string" && UUID.test(input.sos) ? input.sos : null;
  const id = typeof input.id === "string" && UUID.test(input.id) ? input.id : null;

  let extra: Record<string, unknown> = {};
  try {
    switch (input.action) {
      case "take":
        if (!sos) return answer({ error: "bad_request" }, 400);
        await takeCase(sos);
        break;
      case "advance":
        if (!sos || (input.status !== "en_route" && input.status !== "on_site")) {
          return answer({ error: "bad_request" }, 400);
        }
        await advanceCase(sos, input.status);
        break;
      case "phone":
        if (!sos) return answer({ error: "bad_request" }, 400);
        // Logged by the database function itself, under this person's own account.
        extra = { phone: await revealRequesterPhone(sos) };
        break;
      case "complete": {
        if (!sos) return answer({ error: "bad_request" }, 400);
        const photos = proofPaths(sos, input.photos);
        if (photos.length === 0) return answer({ error: "photo_required" }, 400);
        await completeCase(sos, photos, noteText(input.note));
        break;
      }
      case "release":
        if (!id) return answer({ error: "bad_request" }, 400);
        await unassignCase(id);
        break;
      default:
        return answer({ error: "bad_request" }, 400);
    }
  } catch {
    return answer({ error: "refused" }, 409);
  }

  try {
    after(() => void runPushTick());
    return answer({ ...extra, work: await readMyWork() });
  } catch {
    return answer({ ...extra, work: null });
  }
}
