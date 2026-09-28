import { NextResponse } from "next/server";

import { ALLOWED_DOMAIN, APP_URL, emailAllowed } from "@/lib/auth";
import { ConfigError, userClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const back = (params: Record<string, string>) => {
  const url = new URL("/", APP_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
};

const WRONG_DOMAIN = `Use your @${ALLOWED_DOMAIN} account to sign in.`;

/** Where the student lands after Google, by way of Supabase. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  if (searchParams.get("error"))
    return NextResponse.redirect(back({ error: "Sign-in was cancelled." }));

  const code = searchParams.get("code");
  if (!code)
    return NextResponse.redirect(
      back({ error: "Sign-in timed out. Please try again." }),
    );

  try {
    const sb = await userClient();
    const { data, error } = await sb.auth.exchangeCodeForSession(code);

    if (error) {
      // An address outside the college is refused by the signup hook, or by
      // the check constraint when the profile row is written — which reaches
      // us as an opaque database error rather than anything readable.
      const refusedByDomain =
        /profiles_email_domain|database error|college Google account/i.test(
          error.message,
        );
      if (!refusedByDomain) console.error("sign-in exchange failed:", error);
      return NextResponse.redirect(
        back({
          error: refusedByDomain
            ? WRONG_DOMAIN
            : "Could not complete sign-in. Try again.",
        }),
      );
    }

    // Belt and braces. The hook and the constraint should both have refused
    // already, but neither of them is this app's code, and either can be
    // switched off in a dashboard without anyone touching the repository.
    if (!emailAllowed(data.user?.email)) {
      await sb.auth.signOut();
      return NextResponse.redirect(back({ error: WRONG_DOMAIN }));
    }

    return NextResponse.redirect(back({ welcome: "1" }));
  } catch (err) {
    if (err instanceof ConfigError)
      return NextResponse.redirect(back({ error: err.message }));
    console.error("google callback failed:", err);
    return NextResponse.redirect(
      back({ error: "Could not complete sign-in. Try again." }),
    );
  }
}
