import { NextResponse } from "next/server";

import { ALLOWED_DOMAIN } from "@/lib/auth";
import { currentProfile } from "@/lib/profile";
import { supabaseConfigured, userClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Who am I, and may I book yet? */
export async function GET() {
  const profile = await currentProfile();
  return NextResponse.json({
    configured: supabaseConfigured(),
    domain: ALLOWED_DOMAIN,
    student: profile ? { email: profile.email, name: profile.fullName } : null,
    // Signing in is not enough: the database refuses bookings until the
    // registration form has been filled in.
    registered: profile?.registered ?? false,
  });
}

/** Sign out. */
export async function DELETE() {
  if (supabaseConfigured()) {
    const sb = await userClient();
    await sb.auth.signOut();
  }
  return NextResponse.json({ ok: true });
}
