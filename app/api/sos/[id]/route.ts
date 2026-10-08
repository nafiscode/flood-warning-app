import { sosSendingEnabled } from "@/lib/features";
import type { SosStatus, SosTimeline } from "@/lib/sos";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";
import { createClient } from "@/lib/supabase/server";

/**
 * One open case: its timeline for the person who sent it (GET), and everything they can add or
 * say afterwards (POST): the optional details, a location every five minutes, "I'm safe now" and
 * "Confirm I was rescued" (spec 4.6).
 *
 * The sender proves it is their case with the token the send gave them, or with their session if
 * they are signed in. The database functions check it; a wrong token gets 403 and nothing else.
 * None of this ever shows the suspected-spam flag or who is reviewing it (spec section 9).
 */
const TOKEN_HEADER = "x-jaga-sos-token";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });

/** A refusal from the database functions: no such case, or not the caller's case. */
function refused(code: string | undefined): Response {
  if (code === "P0002" || code === "no_data_found") return answer({ error: "not_found" }, 404);
  if (code === "42501") return answer({ error: "not_yours" }, 403);
  return answer({ error: "unavailable" }, 503);
}

export async function GET(request: Request, context: RouteContext<"/api/sos/[id]">) {
  const { id } = await context.params;
  if (!UUID.test(id)) return answer({ error: "not_found" }, 404);
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  const token = request.headers.get(TOKEN_HEADER);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sos_timeline", { p_sos_id: id, p_token: token });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return refused(error?.code);

  const timeline: SosTimeline = {
    status: row.status as SosStatus,
    createdAt: row.created_at as string,
    closedAt: (row.closed_at as string | null) ?? null,
    hazardType: row.hazard_type as SosTimeline["hazardType"],
    lat: (row.lat as number | null) ?? null,
    lon: (row.lon as number | null) ?? null,
    hasPhone: row.has_phone === true,
    unitName: (row.unit_name as string | null) ?? null,
    orgName: (row.org_name as string | null) ?? null,
    photos: Number(row.photos ?? 0),
    hasVoice: row.has_voice === true,
    events: Array.isArray(row.events) ? (row.events as SosTimeline["events"]) : [],
  };
  return answer(timeline);
}

type Action =
  | { action: "details"; token?: string | null; [key: string]: unknown }
  | {
      action: "location";
      token?: string | null;
      lat: number;
      lon: number;
      accuracy?: number | null;
      battery?: number | null;
    }
  | { action: "close"; token?: string | null; rescued?: boolean; note?: string | null }
  | { action: "media"; token?: string | null; photos?: string[]; voice?: string | null };

export async function POST(request: Request, context: RouteContext<"/api/sos/[id]">) {
  const { id } = await context.params;
  if (!UUID.test(id)) return answer({ error: "not_found" }, 404);
  if (!sosSendingEnabled()) return answer({ error: "not_in_service" }, 503);
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);

  let input: Action;
  try {
    input = (await request.json()) as Action;
  } catch {
    return answer({ error: "bad_request" }, 400);
  }
  const token = request.headers.get(TOKEN_HEADER) ?? input.token ?? null;
  const supabase = await createClient();

  if (input.action === "details") {
    const flags = Array.isArray(input.vulnerable)
      ? Object.fromEntries((input.vulnerable as string[]).map((v) => [v, true]))
      : null;
    const { error } = await supabase.rpc("sos_add_details", {
      p_sos_id: id,
      p_token: token,
      p_hazard_type: choice(input.hazardType, HAZARDS),
      p_people_count: count(input.peopleCount),
      p_vulnerable_flags: flags,
      p_depth_ref: choice(input.depth, DEPTHS),
      p_injuries: text(input.injuries, 500),
      p_text: text(input.text, 1000),
      p_phone: text(input.phone, 20),
      p_battery_pct: battery(input.battery),
    });
    if (error) return refused(error.code);
    return answer({ ok: true });
  }

  if (input.action === "location") {
    const lat = Number(input.lat);
    const lon = Number(input.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon))
      return answer({ error: "no_location" }, 400);
    const { error } = await supabase.rpc("sos_add_location", {
      p_sos_id: id,
      p_token: token,
      p_lat: lat,
      p_lon: lon,
      p_accuracy_m: Number.isFinite(Number(input.accuracy)) ? Number(input.accuracy) : null,
      p_battery_pct: battery(input.battery),
    });
    if (error) return refused(error.code);
    return answer({ ok: true });
  }

  if (input.action === "close") {
    const { data, error } = await supabase.rpc("sos_close", {
      p_sos_id: id,
      p_token: token,
      p_rescued: input.rescued === true,
      p_note: text(input.note, 1000),
    });
    if (error) return refused(error.code);
    return answer({ ok: true, status: data as SosStatus });
  }

  if (input.action === "media") {
    const photos = Array.isArray(input.photos)
      ? input.photos
          .filter((p): p is string => typeof p === "string" && p.startsWith(`${id}/`))
          .slice(0, 3)
      : null;
    const voice =
      typeof input.voice === "string" && input.voice.startsWith(`${id}/`) ? input.voice : null;
    const { error } = await supabase.rpc("sos_add_media", {
      p_sos_id: id,
      p_token: token,
      p_photos: photos,
      p_voice_url: voice,
    });
    if (error) return refused(error.code);
    return answer({ ok: true });
  }

  return answer({ error: "bad_request" }, 400);
}

const HAZARDS = ["flood", "flash_flood", "landslide", "fire", "earthquake", "other", "unknown"];
const DEPTHS = ["dry", "ankle", "knee", "waist", "chest", "above_head", "roof"];

function choice(value: unknown, allowed: string[]): string | null {
  return typeof value === "string" && allowed.includes(value) ? value : null;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return trimmed === "" ? null : trimmed;
}

function count(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(1, Math.min(500, Math.round(n)));
}

function battery(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}
