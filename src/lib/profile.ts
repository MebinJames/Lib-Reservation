/**
 * The signed-in student's profile, and the rules for completing it.
 *
 * Google tells us who someone is; it does not tell us their roll number or
 * which year they are in. The database refuses bookings until those are
 * filled in — `registered_at` is null until then — so this is the gate between
 * signing in and being able to book.
 *
 * Writes go through the student's own client, so the "update own profile"
 * policy and the column grants decide what may change. Notably `role` is not
 * grantable here: a student cannot promote themselves by posting a role.
 */

import "server-only";

import { emailAllowed, studentName } from "./auth";
import { supabaseConfigured, userClient } from "./supabase/server";

export type Role = "student" | "staff" | "admin";

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  rollNo: string;
  department: string;
  year: number | null;
  role: Role;
  /** False until the registration form has been completed. */
  registered: boolean;
}

export class RegistrationError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** The columns a student is allowed to fill in about themselves. */
export interface Registration {
  full_name: string;
  roll_no: string;
  department: string;
  year: number;
}

function words(value: unknown, label: string, max: number): string {
  const s = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!s) throw new RegistrationError(`${label} is required.`);
  if (s.length > max)
    throw new RegistrationError(`${label} must be ${max} characters or fewer.`);
  return s;
}

export function cleanRegistration(raw: unknown): Registration {
  const o = (raw ?? {}) as Record<string, unknown>;

  const year = Number(o.year);
  if (!Number.isInteger(year) || year < 1 || year > 6)
    throw new RegistrationError("Year must be a number between 1 and 6.");

  return {
    full_name: words(o.fullName, "Your name", 120),
    // Upper-cased and stripped of spaces so 25ad056 and 25AD056 cannot
    // register as two different students — the column is unique, and that
    // uniqueness should not depend on how someone held the shift key.
    roll_no: words(o.rollNo, "Roll number", 32).toUpperCase().replace(/\s/g, ""),
    department: words(o.department, "Department", 80),
    year,
  };
}

/** The signed-in student's profile, or null if nobody is signed in. */
export async function currentProfile(): Promise<Profile | null> {
  if (!supabaseConfigured()) return null;

  const sb = await userClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user?.email || !emailAllowed(user.email)) return null;

  const { data, error } = await sb
    .from("profiles")
    .select("id, email, full_name, roll_no, department, year, role, registered_at")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !data) return null;

  return {
    id: String(data.id),
    email: String(data.email),
    // The trigger copies the Google name in, but it is nullable in the schema.
    fullName: data.full_name ?? studentName(user.email, user.user_metadata),
    rollNo: data.roll_no ?? "",
    department: data.department ?? "",
    year: data.year ?? null,
    role: (data.role ?? "student") as Role,
    registered: data.registered_at !== null,
  };
}
