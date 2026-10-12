import {
  readCoverage,
  readCoverageUnits,
  readLeaderboard,
  readTeamHouseholds,
  readTeamReports,
} from "@/lib/authority-board";
import { getSessionProfile } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/env";
import { NO_STORE } from "@/lib/supabase/public";

/**
 * What the console's other views read, each only when its tab is opened: the responsibility map
 * (spec 5.6), the teams covering one tambon, the points board (5.5), the flood reports and the
 * households that asked to be known about (5.7). Read with the
 * responder's own session; the database functions refuse anyone who is neither a verified team
 * nor an admin, and that refusal is answered like a page that is not there.
 */
const answer = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });

export async function GET(request: Request) {
  if (!supabaseConfigured()) return answer({ error: "unavailable" }, 503);
  const session = await getSessionProfile();
  if (!session) return answer({ error: "forbidden" }, 404);
  const url = new URL(request.url);
  const what = url.searchParams.get("what");
  try {
    if (what === "coverage") return answer({ coverage: await readCoverage() });
    if (what === "points") return answer({ points: await readLeaderboard() });
    if (what === "reports") return answer({ reports: await readTeamReports() });
    // Refused by the database for a team without rescue or coordination capability, and every
    // read that does come back is written to the access log there (spec 4.7).
    if (what === "households") return answer({ households: await readTeamHouseholds() });
    if (what === "units") {
      const tambon = url.searchParams.get("tambon") ?? "";
      // A tambon is six digits (DOPA code); anything else is not a question to ask the database.
      if (!/^\d{6}$/.test(tambon)) return answer({ error: "bad_request" }, 400);
      return answer({ tambon, units: await readCoverageUnits(tambon) });
    }
  } catch {
    return answer({ error: "forbidden" }, 404);
  }
  return answer({ error: "bad_request" }, 400);
}
