/**
 * What is actually happening in the room, for the admin landing tab.
 *
 * Every number is derived from rows that already exist — nothing is stored or
 * cached, so these figures cannot drift away from the bookings they describe.
 *
 * Dates are resolved in Asia/Kolkata, matching the quota trigger in the
 * database. Using the server's own clock would put the cut-off an hour and a
 * half into the previous day when deployed elsewhere.
 */

import "server-only";

import { buildLayout } from "./floorplan";
import { slotCount, type Policy } from "./policy";
import { loadPolicy, loadSpecs } from "./room";
import { LIBRARY_TZ, libraryDateKey } from "./slots";
import type { DB } from "./supabase/server";

const LOOKBACK_DAYS = 30;
const AHEAD_DAYS = 7;
const TOP_SEATS = 5;

export interface Overview {
  seats: { total: number; occupiedNow: number };
  today: { date: string; bookings: number; peak: number; openNow: boolean };
  ahead: { days: number; bookings: number };
  people: { total: number; withDetails: number; staff: number; admins: number };
  topSeats: { seatId: string; label: string; bookings: number }[];
  byHour: { hour: number; bookings: number }[];
}

/** The slot the library is in right now, or null when it is shut. */
function slotNow(p: Policy, now: Date): number | null {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LIBRARY_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const at = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
  const minutes = at("hour") * 60 + at("minute");
  if (minutes < p.openMin || minutes >= p.closeMin) return null;
  return Math.floor((minutes - p.openMin) / p.slotMin);
}

interface Row {
  seat_id: string;
  date: string;
  start_slot: number;
  end_slot: number;
}

export async function buildOverview(sb: DB, now = new Date()): Promise<Overview> {
  const today = libraryDateKey(now);
  const from = libraryDateKey(now, -LOOKBACK_DAYS);
  const to = libraryDateKey(now, AHEAD_DAYS);

  const [policy, specs, bookings, profiles] = await Promise.all([
    loadPolicy(sb),
    loadSpecs(sb),
    sb
      .from("reservations")
      .select("seat_id, date, start_slot, end_slot")
      .gte("date", from)
      .lte("date", to),
    sb.from("profiles").select("role, registered_at"),
  ]);

  if (bookings.error) throw bookings.error;
  if (profiles.error) throw profiles.error;

  const rows = (bookings.data ?? []) as Row[];
  const layout = buildLayout(specs);
  const labels = new Map(layout.seats.map((s) => [s.id, s.label]));

  const todays = rows.filter((r) => r.date === today);
  const slot = slotNow(policy, now);

  // Busiest moment today: the most seats held during any one slot.
  let peak = 0;
  for (let s = 0; s < slotCount(policy); s++) {
    const held = todays.filter((r) => r.start_slot <= s && s < r.end_slot).length;
    if (held > peak) peak = held;
  }

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.seat_id, (counts.get(r.seat_id) ?? 0) + 1);

  const hours = new Map<number, number>();
  for (const r of rows)
    for (let s = r.start_slot; s < r.end_slot; s++) {
      const hour = Math.floor((policy.openMin + s * policy.slotMin) / 60);
      hours.set(hour, (hours.get(hour) ?? 0) + 1);
    }

  const people = (profiles.data ?? []) as {
    role: string;
    registered_at: string | null;
  }[];

  return {
    seats: {
      total: layout.seats.length,
      occupiedNow:
        slot === null
          ? 0
          : todays.filter((r) => r.start_slot <= slot && slot < r.end_slot).length,
    },
    today: {
      date: today,
      bookings: todays.length,
      peak,
      openNow: slot !== null,
    },
    ahead: {
      days: AHEAD_DAYS,
      bookings: rows.filter((r) => r.date >= today && r.date <= to).length,
    },
    people: {
      total: people.length,
      withDetails: people.filter((p) => p.registered_at !== null).length,
      staff: people.filter((p) => p.role === "staff").length,
      admins: people.filter((p) => p.role === "admin").length,
    },
    topSeats: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_SEATS)
      // A seat whose table was deleted keeps its bookings but loses its label.
      .map(([seatId, bookings]) => ({
        seatId,
        label: labels.get(seatId) ?? "removed seat",
        bookings,
      })),
    byHour: [...hours.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([hour, bookings]) => ({ hour, bookings })),
  };
}
