import { type NextRequest, NextResponse } from "next/server";
import { supabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/** POST only, so a link or an image can't sign someone out. */
export async function POST(request: NextRequest) {
  if (supabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  return NextResponse.redirect(new URL("/", request.nextUrl.origin), { status: 303 });
}
