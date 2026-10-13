import { after } from "next/server";
import {
  cleanPhone,
  toFieldResult,
  toMyFieldRescue,
  vulnerableFlags,
  type MyFieldRescue,
} from "@/lib/field-rescue";
import { pushFieldHeld } from "@/lib/push-server";
import { VULNERABLE, type Vulnerable } from "@/lib/sos";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * Rescues a team found by itself (the owner, 13-14 Oct). GET: the caller's own records and where
 * each stands. POST: record one. The database function decides everything - that the caller has
 * a verified team, that the position was taken just now, that the phone number and the photo
 * are there, whether it counts at once or waits for an admin, and what it is worth.
 *
 * Never cached. The rescued person's number goes in and is never sent back out.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });

export async function GET() {
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return answer({ error: "sign_in" }, 401);
  const { data, error } = await supabase.rpc("my_field_rescues");
  if (error || !Array.isArray(data)) return answer({ error: "unavailable" }, 503);
  return answer({
    rescues: (data as Record<string, unknown>[])
      .map(toMyFieldRescue)
      .filter((r): r is MyFieldRescue => r !== null),
  });
}

export async function POST(request: Request) {
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return answer({ error: "sign_in" }, 401);

  let input: Record<string, unknown>;
  try {
    input = (await request.json()) as Record<string, unknown>;
  } catch {
    return answer({ error: "bad_request" }, 400);
  }
  const id = typeof input.id === "string" && UUID.test(input.id) ? input.id : null;
  const lat = Number(input.lat);
  const lon = Number(input.lon);
  const phone = cleanPhone(input.phone);
  const people = Math.trunc(Number(input.people));
  const photos = Array.isArray(input.photos)
    ? input.photos.filter((p): p is string => typeof p === "string").slice(0, 3)
    : [];
  const locatedAt = typeof input.locatedAt === "string" ? Date.parse(input.locatedAt) : NaN;
  if (!id || !Number.isFinite(locatedAt)) return answer({ error: "bad_request" }, 400);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || input.lat === null) {
    return answer({ error: "position" }, 400);
  }
  if (!phone) return answer({ error: "phone" }, 400);
  if (!(people >= 1 && people <= 200)) return answer({ error: "people" }, 400);
  if (photos.length === 0) return answer({ error: "photo" }, 400);
  const accuracy = Number(input.accuracy);
  const vulnerable = Array.isArray(input.vulnerable)
    ? VULNERABLE.filter((v) => (input.vulnerable as unknown[]).includes(v))
    : ([] as Vulnerable[]);

  const { data, error } = await supabase.rpc("authority_record_field_rescue", {
    p_id: id,
    p_lat: lat,
    p_lon: lon,
    p_accuracy_m: Number.isFinite(accuracy) && input.accuracy !== null ? accuracy : null,
    p_located_at: new Date(locatedAt).toISOString(),
    p_people: people,
    p_vulnerable: vulnerableFlags(vulnerable),
    p_phone: phone,
    p_photos: photos,
    p_note: typeof input.note === "string" ? input.note.trim().slice(0, 500) || null : null,
  });
  if (error) {
    const why =
      error.code === "42501"
        ? "not_team"
        : error.message.includes("outside the area")
          ? "outside"
          : error.message.includes("taken now")
            ? "stale"
            : error.message.includes("photo")
              ? "photo"
              : error.code === "23505"
                ? "duplicate"
                : "failed";
    return answer({ error: why }, why === "not_team" ? 403 : 400);
  }
  const result = toFieldResult(Array.isArray(data) ? (data[0] as Record<string, unknown>) : null);
  if (!result) return answer({ error: "failed" }, 502);
  // A record that waits for an admin reaches the admins' phones, once, after the answer has
  // gone back to the team: the team never waits on a notification.
  if (result.status === "pending") after(() => void pushFieldHeld(id));
  return answer({ result });
}
