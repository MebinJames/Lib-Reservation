/**
 * Supabase clients for server code.
 *
 * Two, deliberately different:
 *
 *   userClient()    acts as whoever is signed in. Row-level security decides
 *                   what they can reach, so a bug in a route cannot hand one
 *                   student another's data.
 *   serviceClient() bypasses row-level security entirely. Only for code that
 *                   has already decided the caller is allowed — today, the
 *                   password-gated admin routes.
 *
 * `server-only` makes importing this from a client component a build error,
 * which is what keeps the secret key out of the browser bundle.
 */

import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY ?? "";

export type DB = SupabaseClient;

export const supabaseConfigured = () =>
  URL.length > 0 && PUBLISHABLE_KEY.length > 0;

export const serviceConfigured = () =>
  supabaseConfigured() && SECRET_KEY.length > 0;

export class ConfigError extends Error {
  readonly status = 503;
}

/**
 * A key Supabase rejects fails at query time, not when the client is built,
 * and it arrives as a plain object rather than an Error — so without this it
 * reads as an ordinary query failure and a rotated key looks like a dead
 * database. Returns null for anything that is a genuine query error.
 */
export function rejectedCredentials(err: unknown): ConfigError | null {
  const message = (err as { message?: unknown } | null)?.message;
  if (typeof message !== "string") return null;
  // "Invalid API key" when malformed, "Unregistered API key" once rotated.
  if (!/api key|jwt (expired|invalid)|invalid authentication/i.test(message))
    return null;
  return new ConfigError(
    "Supabase rejected the key. If you rotated it, put the new one in .env.local and restart.",
  );
}

/** Acts as the signed-in user, or as an anonymous visitor if nobody is. */
export async function userClient(): Promise<DB> {
  if (!supabaseConfigured())
    throw new ConfigError(
      "The database is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  const jar = await cookies();
  return createServerClient(URL, PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list)
            jar.set(name, value, options);
        } catch {
          // Server Components cannot set cookies. Refreshing the session there
          // is the job of the auth proxy, not of a page render.
        }
      },
    },
  });
}

/** Bypasses row-level security. The caller must already have authorised the request. */
export function serviceClient(): DB {
  if (!serviceConfigured())
    throw new ConfigError(
      "The admin area needs SUPABASE_SECRET_KEY. Copy it from the Supabase dashboard into .env.local.",
    );
  return createClient(URL, SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
