/**
 * Keeps the signed-in session alive.
 *
 * Access tokens are short-lived, and a Server Component cannot set cookies —
 * so without this the refreshed token would be computed and then thrown away
 * on every render, and a student would be signed out the moment their token
 * expired. Middleware runs early enough to write the new cookies onto the
 * response, which is the whole reason this file exists.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export async function middleware(request: NextRequest) {
  // Without Supabase there is no session to refresh, and the booking page
  // still has to render.
  if (!SUPABASE_URL || !PUBLISHABLE_KEY) return NextResponse.next({ request });

  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list)
          response.cookies.set(name, value, options);
      },
    },
  });

  // Reading the user is what triggers the refresh. The result is deliberately
  // unused — the point is the cookies the call writes on the way through.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, which carry no session.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
