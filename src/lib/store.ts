/**
 * Reservation storage, backed by Supabase Postgres.
 *
 * The rules that need a lock live in the database, where no route can forget
 * them (see supabase/migrations):
 *
 *   a seat cannot be held twice over the same slot    EXCLUDE constraint
 *   a student cannot hold two seats at the same time  EXCLUDE constraint
 *   a student holds at most maxPerStudent seats       trigger, with a row lock
 *
 * So a booking is a single INSERT. That statement is its own transaction, and
 * every one of those checks runs inside it — which is what the libSQL version
 * needed an explicit write transaction to achieve.
 *
 * What stays here is the policy the database cannot see: opening hours, the
 * calendar window, the longest booking, not booking in the past, and that the
 * seat exists in the room as it is currently laid out.
 *
 * Every function takes the client to act with. Student routes pass one scoped
 * to the signed-in user, so row-level security decides what they can reach;
 * admin routes pass the service client after checking the admin session.
 *
 * Past bookings are no longer deleted on every write. Nothing counts them —
 * the quota starts from today and the day view asks for one date — so they are
 * simply history.
 */

import type { PostgrestError } from "@supabase/supabase-js";

import { maxSlots, slotCount, type Policy } from "./policy";
import { isUuid, loadLayout, loadPolicy } from "./room";
import {
  closeLabel,
  firstOpenSlot,
  isBookableDate,
  isValidDateKey,
  libraryDateKey,
} from "./slots";
import type { DB } from "./supabase/server";
import type { Occupancy, Reservation } from "./types";

export type { Occupancy, Reservation } from "./types";

export class BookingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/**
 * What the browser is allowed to choose. Who is booking is never in here — it
 * comes from the signed-in session, so a request cannot book as someone else.
 */
export interface CreateInput {
  seatId: unknown;
  date: unknown;
  start: unknown;
  end: unknown;
}

// The student's name and address come from their profile, not from the
// booking row — the old libSQL table copied them in at booking time.
const COLUMNS =
  "id, seat_id, date, start_slot, end_slot, created_at, student:profiles(full_name, email)";

interface Row {
  id: string;
  seat_id: string;
  date: string;
  start_slot: number;
  end_slot: number;
  created_at: string;
  student: { full_name: string | null; email: string } | null;
}

const toReservation = (r: Row): Reservation => ({
  id: r.id,
  seatId: r.seat_id,
  date: r.date,
  start: r.start_slot,
  end: r.end_slot,
  name: r.student?.full_name || r.student?.email.split("@")[0] || "",
  studentId: r.student?.email ?? "",
  createdAt: r.created_at,
});

/**
 * Turns what the database refused into something a student can act on.
 *
 * 42501 is the one that cannot be read off the error alone. The insert policy
 * may still require a completed profile, in which case the answer is to fill
 * one in rather than to sign in again — so that case asks the database what is
 * actually true instead of guessing. Guessing is what told a student who had
 * just signed in that their sign-in had expired.
 */
async function refusal(
  sb: DB,
  err: PostgrestError,
  userId: string,
): Promise<Error> {
  const said = `${err.message} ${err.details ?? ""}`;

  if (err.code === "42501") {
    const { data } = await sb
      .from("profiles")
      .select("registered_at")
      .eq("id", userId)
      .maybeSingle();
    return data && data.registered_at === null
      ? new BookingError(
          "Add your details before booking a seat — use the link under your name.",
          403,
        )
      : new BookingError(
          "Your sign-in has expired. Sign in again and retry.",
          403,
        );
  }

  switch (err.code) {
    case "23P01": // exclusion_violation
      return said.includes("reservations_no_student_overlap")
        ? new BookingError(
            "You already hold a seat during that time. Cancel it first.",
            409,
          )
        : new BookingError(
            "That seat is already booked for part of that time.",
            409,
          );
    case "LR001": // the quota trigger — its message already says what to do
      return new BookingError(err.message, 409);
    default:
      return new Error(`Booking failed: ${err.message}`, { cause: err });
  }
}

/* -------------------------------------------------------------- reading */

/** Which seats are taken on a date — never by whom. */
export async function listByDate(sb: DB, date: string): Promise<Occupancy[]> {
  if (!isValidDateKey(date)) throw new BookingError("Invalid date.");
  const { data, error } = await sb.rpc("seat_occupancy", { on_date: date });
  if (error) throw error;
  return ((data ?? []) as { seat_id: string; start_slot: number; end_slot: number }[]).map(
    (r) => ({ seatId: r.seat_id, start: r.start_slot, end: r.end_slot }),
  );
}

export async function listByStudent(sb: DB, userId: string): Promise<Reservation[]> {
  const { data, error } = await sb
    .from("reservations")
    .select(COLUMNS)
    .eq("student_id", userId)
    .order("date")
    .order("start_slot");
  if (error) throw error;
  return (data as unknown as Row[]).map(toReservation);
}

/** Every booking from today on, for the admin view. */
export async function listUpcoming(sb: DB, now = new Date()): Promise<Reservation[]> {
  const { data, error } = await sb
    .from("reservations")
    .select(COLUMNS)
    .gte("date", libraryDateKey(now))
    .order("date")
    .order("start_slot");
  if (error) throw error;
  return (data as unknown as Row[]).map(toReservation);
}

/** Bookings between two dates inclusive, so admins can look backwards too. */
export async function listRange(
  sb: DB,
  from: string,
  to: string,
): Promise<Reservation[]> {
  const { data, error } = await sb
    .from("reservations")
    .select(COLUMNS)
    .gte("date", from)
    .lte("date", to)
    .order("date")
    .order("start_slot")
    .limit(1000);
  if (error) throw error;
  return (data as unknown as Row[]).map(toReservation);
}

/* -------------------------------------------------------------- writing */

export async function create(
  sb: DB,
  input: CreateInput,
  userId: string,
  now = new Date(),
  policy?: Policy,
): Promise<Reservation> {
  // Identity is the verified session's user, not anything that was posted.
  if (!isUuid(userId))
    throw new BookingError("Sign in with your college account to book.", 401);

  const p = policy ?? (await loadPolicy(sb));
  const seatId = String(input.seatId ?? "");
  const date = input.date;
  const start = Number(input.start);
  const end = Number(input.end);

  const { seats } = await loadLayout(sb);
  if (!seats.some((s) => s.id === seatId))
    throw new BookingError("Unknown seat.");
  if (!isValidDateKey(date)) throw new BookingError("Invalid date.");
  if (!isBookableDate(p, date, now))
    throw new BookingError(`Pick a date within the next ${p.daysAhead} days.`);
  if (!Number.isInteger(start) || !Number.isInteger(end))
    throw new BookingError("Invalid time range.");
  if (start < 0 || start >= end)
    throw new BookingError("Time range is outside opening hours.");
  if (end > slotCount(p))
    throw new BookingError(`The library closes at ${closeLabel(p)}.`);
  if (end - start > maxSlots(p))
    throw new BookingError(`Bookings are capped at ${p.maxHours} hours.`);
  if (start < firstOpenSlot(p, date, now))
    throw new BookingError("That time has already passed.");

  const { data, error } = await sb
    .from("reservations")
    .insert({
      seat_id: seatId,
      date,
      start_slot: start,
      end_slot: end,
      student_id: userId,
    })
    .select(COLUMNS)
    .single();
  if (error) throw await refusal(sb, error, userId);
  return toReservation(data as unknown as Row);
}

export async function remove(sb: DB, id: string, userId: string): Promise<void> {
  if (!isUuid(id)) throw new BookingError("Reservation not found.", 404);
  const { data, error } = await sb
    .from("reservations")
    .delete()
    .eq("id", id)
    .eq("student_id", userId)
    .select("id");
  if (error) throw error;
  // Someone else's booking and one that doesn't exist look identical: row-level
  // security hides both. That is deliberate — the old 403 confirmed that another
  // student held a particular reservation.
  if (!data?.length) throw new BookingError("Reservation not found.", 404);
}

/** Admin override — cancels any booking. */
export async function forceRemove(sb: DB, id: string): Promise<void> {
  if (!isUuid(id)) throw new BookingError("Reservation not found.", 404);
  const { data, error } = await sb
    .from("reservations")
    .delete()
    .eq("id", id)
    .select("id");
  if (error) throw error;
  if (!data?.length) throw new BookingError("Reservation not found.", 404);
}
