import { NextResponse } from "next/server";

import { AdminError, requireAdmin } from "@/lib/admin";
import { buildLayout } from "@/lib/floorplan";
import { cleanSpecs, ensureSeeded, resetLayout, writeSpecs } from "@/lib/room";
import { ConfigError, rejectedCredentials, serviceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function fail(err: unknown, fallback: string) {
  if (err instanceof AdminError || err instanceof ConfigError)
    return NextResponse.json({ error: err.message }, { status: err.status });
  const rejected = rejectedCredentials(err);
  if (rejected)
    return NextResponse.json({ error: rejected.message }, { status: rejected.status });
  // cleanSpecs throws plain Errors whose messages are written for the admin.
  if (err instanceof Error && !("code" in err) && err.message)
    return NextResponse.json({ error: err.message }, { status: 400 });
  console.error("admin/layout failed:", err);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET() {
  try {
    await requireAdmin();
    // Visitors can't write, so an empty room is seeded here rather than on read.
    const specs = await ensureSeeded(serviceClient());
    return NextResponse.json({ specs, layout: buildLayout(specs) });
  } catch (err) {
    return fail(err, "Could not load the layout.");
  }
}

/** Replace the whole layout. */
export async function PUT(req: Request) {
  try {
    await requireAdmin();
    const body = (await req.json()) as { specs?: unknown };
    const specs = cleanSpecs(body.specs);
    await writeSpecs(serviceClient(), specs);
    return NextResponse.json({ specs, layout: buildLayout(specs) });
  } catch (err) {
    return fail(err, "Could not save the layout.");
  }
}

/** Back to the drawn room. */
export async function DELETE() {
  try {
    await requireAdmin();
    const specs = await resetLayout(serviceClient());
    return NextResponse.json({ specs, layout: buildLayout(specs) });
  } catch (err) {
    return fail(err, "Could not reset the layout.");
  }
}
