import { NextResponse } from "next/server";

import { ConfigError, supabaseConfigured, userClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Keeps the Supabase project from being paused.
 *
 * Supabase pauses Free Plan projects after a week of low activity, and a
 * paused project means the booking page is down until somebody notices the
 * email and clicks Resume. Their documentation says a few database requests a
 * day are enough to prevent it, so this runs daily from Vercel Cron.
 *
 * It must actually reach the **database** — a route that returned without
 * querying would keep Vercel busy and let Supabase pause anyway. So it reads
 * one row, using the publishable key, which works whether or not the secret
 * key is configured.
 */
export async function GET(req: Request) {
  // Vercel attaches this header to cron requests when CRON_SECRET is set.
  // Unset, the endpoint stays open — it only reads one public row, but setting
  // the secret in production stops anyone else from running it at will.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });

  if (!supabaseConfigured())
    return NextResponse.json(
      { ok: false, error: "Supabase is not configured." },
      { status: 503 },
    );

  const startedAt = Date.now();
  try {
    const sb = await userClient();
    const { error } = await sb.from("settings").select("key").limit(1);
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      reached: "database",
      ms: Date.now() - startedAt,
      at: new Date().toISOString(),
    });
  } catch (err) {
    if (err instanceof ConfigError)
      return NextResponse.json(
        { ok: false, error: err.message },
        { status: err.status },
      );
    // Worth a loud log: a failing keepalive is how a project quietly pauses.
    console.error("keepalive could not reach the database:", err);
    return NextResponse.json(
      { ok: false, error: "Could not reach the database." },
      { status: 502 },
    );
  }
}
