import { type NextRequest, NextResponse } from "next/server";
import { finishSignIn, safeNextPath } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/** Where LINE sign-in and email links come back to: trade the one-time code for a session. */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));
  if (code && supabaseConfigured()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(await finishSignIn(supabase, next), origin));
  }
  return NextResponse.redirect(new URL("/sign-in?error=link", origin));
}
