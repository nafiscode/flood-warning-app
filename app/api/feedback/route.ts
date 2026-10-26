import { MOMENTS } from "@/lib/feedback";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * Sending a rating or a comment (A15, spec 17). Open without an account, like an SOS and unlike
 * a report, because nobody should have to sign in to say the app failed them.
 *
 * It is a POST with a plain JSON body so the offline queue can replay it (lib/queue.ts), and it
 * answers 200 for everything the sender can get wrong: an empty form, a nonsense contact, the
 * third one today. Only a database that cannot be reached is an error, and that is what puts the
 * item in the queue.
 *
 * `appVersion` is read here rather than taken from the browser: the deployment knows which build
 * is serving the page, and a figure an admin acts on should not be something the page can claim.
 */
export async function POST(request: Request) {
  const answer = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);

  let input: Record<string, unknown>;
  try {
    input = (await request.json()) as Record<string, unknown>;
  } catch {
    return answer({ error: "bad_request" }, 400);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_feedback", {
    p_rating: rating(input.rating),
    p_liked: codes(input.liked),
    p_liked_note: text(input.likedNote, 2000),
    p_improve: codes(input.improve),
    p_improve_note: text(input.improveNote, 2000),
    p_message: text(input.message, 2000),
    p_screen: text(input.screen, 120),
    p_locale: choice(input.locale, ["th", "ms", "en"]),
    p_app_version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    p_device_kind: choice(input.deviceKind, ["phone", "tablet", "desktop", "other"]),
    p_district: text(input.district, 4),
    p_moment: choice(input.moment, [...MOMENTS]),
    p_sos: uuid(input.sos),
    p_device_id: text(input.deviceId, 100),
    p_contact_ok: input.contactOk === true,
    p_contact: text(input.contact, 200),
    p_public_ok: input.publicOk === true,
    p_display_name: text(input.displayName, 40),
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return answer({ error: "unavailable" }, 503);
  return answer({
    id: (row.feedback_id as string | null) ?? null,
    key: (row.withdraw_key as string | null) ?? null,
    limited: row.limited === true,
  });
}

function rating(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

/** Chip codes, filtered to the shape the database accepts, so a stray value is simply dropped. */
function codes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((c): c is string => typeof c === "string" && /^[a-zA-Z_]{2,40}$/.test(c))
    .slice(0, 20);
}

function choice(value: unknown, allowed: string[]): string | null {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}

function uuid(value: unknown): string | null {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed === "" ? null : trimmed;
}
