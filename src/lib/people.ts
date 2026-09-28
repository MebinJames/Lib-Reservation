/**
 * The people who have signed in, and what they are allowed to do.
 *
 * Role changes go through set_user_role rather than an UPDATE, because that
 * function owns two rules this layer must not be able to skip: every change is
 * written to role_audit, and the last remaining admin cannot be demoted. The
 * service key could write the column directly — that is exactly why it
 * shouldn't.
 */

import "server-only";

import type { Role } from "./profile";
import type { DB } from "./supabase/server";

export interface Person {
  id: string;
  email: string;
  fullName: string;
  rollNo: string;
  department: string;
  year: number | null;
  role: Role;
  /** Whether they have filled in their own details. Not required to book. */
  registered: boolean;
  joinedAt: string;
}

export class PeopleError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const ROLES: Role[] = ["student", "staff", "admin"];
export const isRole = (v: unknown): v is Role =>
  typeof v === "string" && (ROLES as string[]).includes(v);

/**
 * PostgREST assembles `or=(a.ilike.*q*,b.ilike.*q*)` from a string, so a comma,
 * bracket or wildcard in the search box would rewrite the filter instead of
 * being searched for. Only characters that can appear in a name, an address or
 * a roll number survive.
 */
const searchable = (q: string) =>
  q
    .replace(/[^A-Za-z0-9 @._-]/g, "")
    .trim()
    .slice(0, 60);

const COLUMNS =
  "id, email, full_name, roll_no, department, year, role, registered_at, created_at";

const toPerson = (r: Record<string, unknown>): Person => ({
  id: String(r.id),
  email: String(r.email),
  fullName: (r.full_name as string | null) ?? "",
  rollNo: (r.roll_no as string | null) ?? "",
  department: (r.department as string | null) ?? "",
  year: (r.year as number | null) ?? null,
  role: ((r.role as string | null) ?? "student") as Role,
  registered: r.registered_at !== null,
  joinedAt: String(r.created_at),
});

export async function listPeople(sb: DB, query = ""): Promise<Person[]> {
  const q = searchable(query);

  let req = sb
    .from("profiles")
    .select(COLUMNS)
    .order("created_at", { ascending: false })
    .limit(500);

  if (q)
    req = req.or(
      `email.ilike.*${q}*,full_name.ilike.*${q}*,roll_no.ilike.*${q}*,department.ilike.*${q}*`,
    );

  const { data, error } = await req;
  if (error) throw error;
  return (data ?? []).map((r) => toPerson(r as Record<string, unknown>));
}

/** Changes someone's role. The database enforces the rules, not this function. */
export async function setRole(
  sb: DB,
  target: string,
  role: Role,
): Promise<void> {
  const { error } = await sb.rpc("set_user_role", {
    target,
    new_role: role,
  });
  if (!error) return;

  const said = `${error.message} ${error.details ?? ""}`;
  if (/last admin/i.test(said))
    throw new PeopleError(
      "That is the last admin. Promote someone else first.",
      409,
    );
  if (/no such user/i.test(said))
    throw new PeopleError("That account no longer exists.", 404);
  if (/only an admin/i.test(said))
    throw new PeopleError("Not allowed to change roles.", 403);
  throw error;
}
