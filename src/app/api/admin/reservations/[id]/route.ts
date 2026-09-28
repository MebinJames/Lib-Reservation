import { NextResponse } from "next/server";

import { AdminError, requireAdmin } from "@/lib/admin";
import { BookingError, forceRemove } from "@/lib/store";
import { ConfigError, serviceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Cancel any booking, without the student's id. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
    const { id } = await params;
    await forceRemove(serviceClient(), id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (
      err instanceof AdminError ||
      err instanceof BookingError ||
      err instanceof ConfigError
    )
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("admin cancel failed:", err);
    return NextResponse.json({ error: "Could not cancel." }, { status: 500 });
  }
}
