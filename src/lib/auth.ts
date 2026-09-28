/**
 * Who is allowed to sign in.
 *
 * Supabase Auth runs the OAuth exchange now, so the hand-rolled PKCE flow, the
 * HMAC session cookie and the demo students are gone. What is left is the one
 * rule this app owns: which addresses belong to the college.
 *
 * That rule lives in three places on purpose. The database has a check
 * constraint on profiles.email, and a Supabase auth hook refuses the sign-up
 * outright. This copy is the friendly one — it exists so a rejected visitor
 * reads a sentence instead of a constraint violation.
 */

/** Only addresses in this domain may book. */
export const ALLOWED_DOMAIN = (
  process.env.ALLOWED_EMAIL_DOMAIN ?? "mgits.ac.in"
)
  .toLowerCase()
  .replace(/^@/, "");

export const APP_URL = (
  process.env.APP_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "http://localhost:3000"
).replace(/\/$/, "");

/** Where Supabase sends the student once Google is done with them. */
export const CALLBACK_PATH = "/api/auth/callback";

export interface Student {
  /** verified Google address, lowercased — the identity a booking hangs off */
  email: string;
  name: string;
}

/**
 * Google's `hd` parameter is a hint that can be edited in the URL, so the
 * domain is checked here against the address Supabase verified, never against
 * anything the browser handed us.
 */
export function emailAllowed(email: unknown): email is string {
  if (typeof email !== "string") return false;
  const e = email.trim().toLowerCase();
  // Exactly one @, and the part after it is the college domain.
  const at = e.indexOf("@");
  if (at <= 0 || at !== e.lastIndexOf("@")) return false;
  return e.slice(at + 1) === ALLOWED_DOMAIN;
}

/** The name Google gave us, falling back to the part before the @. */
export function studentName(
  email: string,
  meta: Record<string, unknown> | undefined,
): string {
  for (const key of ["full_name", "name"]) {
    const value = meta?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return email.split("@")[0];
}
