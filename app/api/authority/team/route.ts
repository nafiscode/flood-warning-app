import { getSessionProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";

/**
 * The owner's taps on the team page, and a person's code on the join page (24 Oct 2026): invite,
 * cancel an invitation, say yes or no to someone waiting, change a role, remove someone, and
 * join with a code. Each is a database function that checks who is asking again; this route only
 * carries it there. Nothing the person typed is trusted except the code, which is hashed and
 * compared in the database.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });

type Input = {
  action?: string;
  unit?: string;
  id?: string;
  role?: string;
  code?: string;
  approve?: boolean;
};

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
  const supabase = await createClient();
  const role = input.role === "field" ? "field" : "dispatcher";
  const uuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

  let result: { data: unknown; error: { code?: string; message: string } | null };
  switch (input.action) {
    case "invite":
      if (!uuid(input.unit)) return answer({ error: "bad_request" }, 400);
      result = await supabase.rpc("create_unit_invite", { p_unit: input.unit, p_role: role });
      break;
    case "revoke":
      if (!uuid(input.id)) return answer({ error: "bad_request" }, 400);
      result = await supabase.rpc("revoke_unit_invite", { p_invite: input.id });
      break;
    case "decide":
      if (!uuid(input.id) || typeof input.approve !== "boolean") {
        return answer({ error: "bad_request" }, 400);
      }
      result = await supabase.rpc("decide_unit_member", {
        p_member: input.id,
        p_approve: input.approve,
      });
      break;
    case "remove":
      if (!uuid(input.id)) return answer({ error: "bad_request" }, 400);
      result = await supabase.rpc("remove_unit_member", { p_member: input.id });
      break;
    case "role":
      if (!uuid(input.id)) return answer({ error: "bad_request" }, 400);
      result = await supabase.rpc("set_unit_member_role", { p_member: input.id, p_role: role });
      break;
    case "join":
      if (typeof input.code !== "string" || input.code.length > 40) {
        return answer({ error: "bad_request" }, 400);
      }
      result = await supabase.rpc("redeem_unit_invite", { p_code: input.code });
      break;
    default:
      return answer({ error: "bad_request" }, 400);
  }

  if (result.error) {
    // 42501: not the owner. 54000: too many open invitations, a full team, or too many tries.
    if (result.error.code === "42501") return answer({ error: "forbidden" }, 403);
    if (result.error.code === "54000") return answer({ error: "limit" }, 429);
    return answer({ error: "failed" }, 400);
  }

  if (input.action === "invite") {
    const row = (Array.isArray(result.data) ? result.data[0] : null) as {
      code?: string;
      expires_at?: string;
    } | null;
    return answer({ code: row?.code ?? null, expiresAt: row?.expires_at ?? null });
  }
  if (input.action === "join") {
    // No row means the code did not work: wrong, used, cancelled, expired, or the team is not
    // verified. The page says one thing for all of them, so it tells nobody which.
    const row = (Array.isArray(result.data) ? result.data[0] : null) as {
      unit_name?: string;
      member_status?: string;
    } | null;
    if (!row) return answer({ error: "code" }, 404);
    return answer({ unitName: row.unit_name ?? "", status: row.member_status ?? "pending" });
  }
  return answer({ ok: true });
}
