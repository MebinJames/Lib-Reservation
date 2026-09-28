import { NextResponse } from "next/server";

import { ALLOWED_DOMAIN, APP_URL, CALLBACK_PATH } from "@/lib/auth";
import { ConfigError, userClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Kicks off Google sign-in. Supabase owns the exchange; we only redirect. */
export async function GET() {
  try {
    const sb = await userClient();
    const { data, error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${APP_URL}${CALLBACK_PATH}`,
        queryParams: {
          // Asks Google's account picker to offer college accounts first. A
          // hint only — it can be edited out of the URL, which is why the
          // address is checked again when the student comes back.
          hd: ALLOWED_DOMAIN,
          // Always show the account chooser. Without this Google silently
          // reuses whichever account the browser last signed in with, so on a
          // shared machine the next student would land in someone else's
          // account without ever being asked.
          prompt: "select_account",
        },
      },
    });

    if (error || !data?.url) {
      console.error("could not start Google sign-in:", error);
      return NextResponse.json(
        {
          error:
            "Google sign-in is not set up yet. Add the Google provider in the Supabase dashboard.",
        },
        { status: 503 },
      );
    }

    return NextResponse.redirect(data.url);
  } catch (err) {
    if (err instanceof ConfigError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("signin failed:", err);
    return NextResponse.json(
      { error: "Could not start sign-in." },
      { status: 500 },
    );
  }
}
