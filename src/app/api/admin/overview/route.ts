import { NextResponse } from "next/server";

import { AdminError, requireAdmin } from "@/lib/admin";
import { buildOverview } from "@/lib/overview";
import {
  ConfigError,
  rejectedCredentials,
  serviceClient,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET /api/admin/overview — what the room is doing, counted fresh each time. */
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ overview: await buildOverview(serviceClient()) });
  } catch (err) {
    if (err instanceof AdminError || err instanceof ConfigError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    const rejected = rejectedCredentials(err);
    if (rejected)
      return NextResponse.json(
        { error: rejected.message },
        { status: rejected.status },
      );
    console.error("admin/overview failed:", err);
    return NextResponse.json(
      { error: "Could not load the overview." },
      { status: 500 },
    );
  }
}
