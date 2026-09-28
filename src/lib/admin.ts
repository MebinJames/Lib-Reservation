/**
 * Admin access.
 *
 * A single shared password, set as ADMIN_PASSWORD. Signing in mints an
 * HMAC-signed, time-limited cookie; every admin route checks it. If the
 * password is not configured the admin area refuses to open at all, so a
 * deployment can never accidentally expose an unguarded editor.
 *
 * This is deliberately modest — one operator, one password. Swap it for the
 * institution's SSO before real staff use it.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const SECRET = process.env.ADMIN_SECRET || PASSWORD;
const MAX_AGE_S = 60 * 60 * 12;

export const COOKIE = "lib_admin";
export const adminEnabled = () => PASSWORD.length > 0;

const sha = (s: string) => createHash("sha256").update(s).digest();

/** Constant-time compare that doesn't leak the password's length. */
function sameSecret(a: string, b: string) {
  return timingSafeEqual(sha(a), sha(b));
}

const sign = (issued: number) =>
  createHmac("sha256", SECRET).update(`admin.${issued}`).digest("hex");

export function mintToken(now = Date.now()) {
  const issued = Math.floor(now / 1000);
  return `${issued}.${sign(issued)}`;
}

export function tokenValid(token: string | undefined, now = Date.now()) {
  if (!adminEnabled() || !token) return false;
  const [rawIssued, mac] = token.split(".");
  const issued = Number(rawIssued);
  if (!Number.isFinite(issued) || !mac) return false;
  const age = Math.floor(now / 1000) - issued;
  if (age < 0 || age > MAX_AGE_S) return false;
  try {
    return sameSecret(mac, sign(issued));
  } catch {
    return false;
  }
}

export function passwordMatches(candidate: unknown) {
  if (!adminEnabled() || typeof candidate !== "string" || !candidate) return false;
  try {
    return sameSecret(candidate, PASSWORD);
  } catch {
    return false;
  }
}

/** True when the current request carries a valid admin session. */
export async function isSignedIn() {
  const jar = await cookies();
  return tokenValid(jar.get(COOKIE)?.value);
}

export class AdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Throws unless the caller is a signed-in admin. */
export async function requireAdmin() {
  if (!adminEnabled())
    throw new AdminError(
      "Admin area is disabled. Set ADMIN_PASSWORD in .env.local to enable it.",
      503,
    );
  if (!(await isSignedIn())) throw new AdminError("Not signed in.", 401);
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: MAX_AGE_S,
  secure: process.env.NODE_ENV === "production",
};
