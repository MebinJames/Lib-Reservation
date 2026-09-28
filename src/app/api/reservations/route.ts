import { NextResponse } from "next/server";

import { BookingError, create, listByDate, listByStudent } from "@/lib/store";
import { ConfigError, rejectedCredentials, userClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function fail(err: unknown, fallback: string) {
  if (err instanceof BookingError || err instanceof ConfigError)
    return NextResponse.json({ error: err.message }, { status: err.status });
  const rejected = rejectedCredentials(err);
  if (rejected)
    return NextResponse.json({ error: rejected.message }, { status: rejected.status });
  console.error(`${fallback}:`, err);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/**
 * GET /api/reservations?date=YYYY-MM-DD  -> which seats are taken that day
 * GET /api/reservations?mine=1           -> the signed-in student's bookings
 *
 * The day view says which seats are taken, never by whom, and there is no way
 * to look up another student's bookings.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  try {
    const sb = await userClient();

    if (searchParams.get("mine")) {
      const {
        data: { user },
      } = await sb.auth.getUser();
      if (!user) return NextResponse.json({ reservations: [] });
      return NextResponse.json({
        reservations: await listByStudent(sb, user.id),
      });
    }

    const date = searchParams.get("date");
    if (date)
      return NextResponse.json({ reservations: await listByDate(sb, date) });

    return NextResponse.json(
      { error: "Pass either ?date= or ?mine=1." },
      { status: 400 },
    );
  } catch (err) {
    return fail(err, "Could not load reservations.");
  }
}

/** POST /api/reservations — book a seat as the signed-in student. */
export async function POST(req: Request) {
  try {
    const sb = await userClient();
    // getUser() checks the session with Supabase Auth rather than trusting the
    // cookie's contents.
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user)
      return NextResponse.json(
        { error: "Sign in with your college account to book." },
        { status: 401 },
      );

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Malformed request." }, { status: 400 });
    }

    // Only the seat and time come from the browser; the student comes from
    // the verified session, so a crafted body cannot book as anyone else.
    const { seatId, date, start, end } = (body ?? {}) as Record<string, unknown>;
    const reservation = await create(sb, { seatId, date, start, end }, user.id);
    return NextResponse.json({ reservation }, { status: 201 });
  } catch (err) {
    return fail(err, "Could not save the booking.");
  }
}
