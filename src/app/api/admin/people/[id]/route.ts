import { NextResponse } from "next/server";

import { AdminError, requireAdmin } from "@/lib/admin";
import { PeopleError, isRole, setRole } from "@/lib/people";
import { isUuid } from "@/lib/room";
import {
  ConfigError,
  rejectedCredentials,
  serviceClient,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * PUT /api/admin/people/:id — change what someone is allowed to do.
 *
 * The database decides whether the change is permitted: set_user_role records
 * every change in role_audit and refuses to demote the last admin, so neither
 * rule can be lost by a mistake in this route.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();

    const { id } = await params;
    if (!isUuid(id))
      return NextResponse.json({ error: "Unknown account." }, { status: 404 });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Malformed request." }, { status: 400 });
    }

    const role = (body as { role?: unknown })?.role;
    if (!isRole(role))
      return NextResponse.json(
        { error: "Role must be student, staff or admin." },
        { status: 400 },
      );

    await setRole(serviceClient(), id, role);
    return NextResponse.json({ ok: true, role });
  } catch (err) {
    if (
      err instanceof AdminError ||
      err instanceof PeopleError ||
      err instanceof ConfigError
    )
      return NextResponse.json({ error: err.message }, { status: err.status });
    const rejected = rejectedCredentials(err);
    if (rejected)
      return NextResponse.json(
        { error: rejected.message },
        { status: rejected.status },
      );
    console.error("role change failed:", err);
    return NextResponse.json(
      { error: "Could not change the role." },
      { status: 500 },
    );
  }
}
