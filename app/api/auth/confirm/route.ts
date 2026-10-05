import type { EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { finishSignIn, safeNextPath } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

const EMAIL_TYPES = new Set(["magiclink", "email", "invite", "signup", "recovery"]);

/**
 * Email links that carry a token hash (the email template can point here). Unlike the code in
 * /api/auth/callback, this works when the link is opened on another device or browser.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = safeNextPath(searchParams.get("next"));
  if (tokenHash && type && EMAIL_TYPES.has(type) && supabaseConfigured()) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type: type as EmailOtpType,
    });
    if (!error) return NextResponse.redirect(new URL(await finishSignIn(supabase, next), origin));
  }
  return NextResponse.redirect(new URL("/sign-in?error=link", origin));
}
