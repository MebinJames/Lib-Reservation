import { NextResponse } from "next/server";

import { AdminError, requireAdmin } from "@/lib/admin";
import { coerce, policyProblems } from "@/lib/policy";
import { loadPolicy, resetPolicy, savePolicy } from "@/lib/room";
import { ConfigError, rejectedCredentials, serviceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function fail(err: unknown, fallback: string) {
  if (err instanceof AdminError || err instanceof ConfigError)
    return NextResponse.json({ error: err.message }, { status: err.status });
  const rejected = rejectedCredentials(err);
  if (rejected)
    return NextResponse.json({ error: rejected.message }, { status: rejected.status });
  console.error("admin/policy failed:", err);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ policy: await loadPolicy(serviceClient()) });
  } catch (err) {
    return fail(err, "Could not load settings.");
  }
}

export async function PUT(req: Request) {
  try {
    await requireAdmin();
    const body = (await req.json()) as { policy?: unknown };
    // coerce (not normalise) so contradictions surface as errors instead of
    // being quietly repaired behind the admin's back
    const wanted = coerce((body.policy ?? {}) as Record<string, unknown>);
    const problems = policyProblems(wanted);
    if (problems.length)
      return NextResponse.json({ error: problems[0] }, { status: 400 });
    return NextResponse.json({
      policy: await savePolicy(serviceClient(), wanted),
    });
  } catch (err) {
    return fail(err, "Could not save settings.");
  }
}

export async function DELETE() {
  try {
    await requireAdmin();
    return NextResponse.json({ policy: await resetPolicy(serviceClient()) });
  } catch (err) {
    return fail(err, "Could not reset settings.");
  }
}
