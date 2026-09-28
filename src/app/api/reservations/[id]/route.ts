import { NextResponse } from "next/server";

import { BookingError, remove } from "@/lib/store";
import { ConfigError, userClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** DELETE /api/reservations/:id — only the student who made it may cancel. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const sb = await userClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user)
      return NextResponse.json(
        { error: "Sign in to manage your bookings." },
        { status: 401 },
      );

    const { id } = await params;
    await remove(sb, id, user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BookingError || err instanceof ConfigError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("cancel failed:", err);
    return NextResponse.json(
      { error: "Could not cancel the booking." },
      { status: 500 },
    );
  }
}
