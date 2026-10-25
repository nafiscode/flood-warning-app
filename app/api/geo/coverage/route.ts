import { NextResponse } from "next/server";

import { readCoverage } from "@/lib/authority-board";
import { supabaseConfigured } from "@/lib/supabase/env";

/**
 * The responsibility map (spec 2, 9) for the main map: the same per-tambon coverage the authority
 * console reads (lib/authority-board.ts, RPC coverage_summary), which is security-definer and
 * returns rows only to a verified authority or admin — everyone else gets an empty list (safety
 * rule 5). No personal data: team counts per tambon only, no names, phones or households. Never
 * cached and never public.
 */
export async function GET() {
  if (!supabaseConfigured()) return NextResponse.json({ rows: [] });
  try {
    const rows = await readCoverage();
    return NextResponse.json({ rows }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ rows: [] });
  }
}
