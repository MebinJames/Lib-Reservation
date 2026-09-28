import { NextResponse } from "next/server";

import { AdminError, requireAdmin } from "@/lib/admin";
import { listPeople } from "@/lib/people";
import {
  ConfigError,
  rejectedCredentials,
  serviceClient,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** GET /api/admin/people?q= — everyone who has signed in. */
export async function GET(req: Request) {
  try {
    await requireAdmin();
    const q = new URL(req.url).searchParams.get("q") ?? "";
    return NextResponse.json({ people: await listPeople(serviceClient(), q) });
  } catch (err) {
    if (err instanceof AdminError || err instanceof ConfigError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    const rejected = rejectedCredentials(err);
    if (rejected)
      return NextResponse.json(
        { error: rejected.message },
        { status: rejected.status },
      );
    console.error("admin/people failed:", err);
    return NextResponse.json(
      { error: "Could not load people." },
      { status: 500 },
    );
  }
}
