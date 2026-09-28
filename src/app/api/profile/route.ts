import { NextResponse } from "next/server";

import { RegistrationError, cleanRegistration } from "@/lib/profile";
import {
  ConfigError,
  rejectedCredentials,
  userClient,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** PUT /api/profile — the signed-in student fills in their own details. */
export async function PUT(req: Request) {
  try {
    const sb = await userClient();
    const {
      data: { user },
    } = await sb.auth.getUser();
    if (!user)
      return NextResponse.json(
        { error: "Sign in with your college account first." },
        { status: 401 },
      );

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Malformed request." }, { status: 400 });
    }

    const details = cleanRegistration(body);

    // Row-level security limits this to the student's own row, and the column
    // grants limit it to these fields — posting a `role` would be refused by
    // the database rather than quietly ignored here.
    const { error } = await sb
      .from("profiles")
      .update({ ...details, registered_at: new Date().toISOString() })
      .eq("id", user.id);

    if (error) {
      if (error.code === "23505")
        return NextResponse.json(
          {
            error:
              "That roll number is already registered to another account. Check it, or ask the library staff.",
          },
          { status: 409 },
        );
      const rejected = rejectedCredentials(error);
      if (rejected)
        return NextResponse.json(
          { error: rejected.message },
          { status: rejected.status },
        );
      console.error("registration failed:", error);
      return NextResponse.json(
        { error: "Could not save your details." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RegistrationError || err instanceof ConfigError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("registration failed:", err);
    return NextResponse.json(
      { error: "Could not save your details." },
      { status: 500 },
    );
  }
}
