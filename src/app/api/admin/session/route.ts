import { NextResponse } from "next/server";

import {
  COOKIE,
  adminEnabled,
  cookieOptions,
  isSignedIn,
  mintToken,
  passwordMatches,
} from "@/lib/admin";

export const dynamic = "force-dynamic";

/** Is the admin area available, and am I signed in? */
export async function GET() {
  return NextResponse.json({
    enabled: adminEnabled(),
    signedIn: adminEnabled() ? await isSignedIn() : false,
  });
}

/** Sign in with the shared admin password. */
export async function POST(req: Request) {
  if (!adminEnabled())
    return NextResponse.json(
      { error: "Admin area is disabled. Set ADMIN_PASSWORD in .env.local." },
      { status: 503 },
    );

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const { password } = (body ?? {}) as { password?: unknown };
  if (!passwordMatches(password))
    return NextResponse.json({ error: "Wrong password." }, { status: 401 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, mintToken(), cookieOptions);
  return res;
}

/** Sign out. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return res;
}
