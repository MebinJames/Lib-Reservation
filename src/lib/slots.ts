/**
 * The booking calendar and the clock.
 *
 * Everything here is a pure function of a Policy, so opening hours and limits
 * can be edited at runtime from /admin without a rebuild.
 */

import { type Policy, slotCount } from "./policy";

export const pad = (n: number) => String(n).padStart(2, "0");

/** Minutes past midnight -> "5:30 pm" */
export function clock(mins: number) {
  const m = ((mins % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${pad(m % 60)} ${h24 < 12 ? "am" : "pm"}`;
}

/** Slot index -> "8:00 am". Accepts slotCount itself, i.e. closing time. */
export const slotLabel = (p: Policy, slot: number) =>
  clock(p.openMin + slot * p.slotMin);

/** A booking [start, end) rendered as "8:00 am – 11:00 am" */
export const rangeLabel = (p: Policy, start: number, end: number) =>
  `${slotLabel(p, start)} – ${slotLabel(p, end)}`;

export const openLabel = (p: Policy) => slotLabel(p, 0);
export const closeLabel = (p: Policy) => slotLabel(p, slotCount(p));

/** "30 min", "1 hour", "1 h 30 min", "2 hours" … */
export function durationLabel(p: Policy, slots: number) {
  const mins = slots * p.slotMin;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hour${h > 1 ? "s" : ""}`;
  return `${h} h ${m} min`;
}

/** Local (not UTC) YYYY-MM-DD, so "today" matches the user's clock. */
export function toDateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Where the library actually is, whatever timezone the server runs in. */
export const LIBRARY_TZ = "Asia/Kolkata";

/**
 * Today in the library's own timezone.
 *
 * toDateKey reads the machine's clock, which is right in a browser and wrong
 * on a server somewhere else: hosted in UTC, everything between midnight and
 * 05:30 in India would still be answering "yesterday". The quota trigger in
 * the database counts from the Asia/Kolkata day, so server-side code has to
 * agree with it or the two will disagree about which bookings are current.
 */
export function libraryDateKey(d = new Date(), dayOffset = 0) {
  const shifted = new Date(d.getTime() + dayOffset * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: LIBRARY_TZ }).format(
    shifted,
  );
}

export function fromDateKey(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isValidDateKey(key: unknown): key is string {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const d = fromDateKey(key);
  return !Number.isNaN(d.getTime()) && toDateKey(d) === key;
}

/** The bookable window: today through daysAhead - 1. */
export function calendarDays(p: Policy, from = new Date()) {
  const base = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return Array.from({ length: p.daysAhead }, (_, i) => {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    return {
      key: toDateKey(d),
      weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
      day: d.getDate(),
      month: d.toLocaleDateString(undefined, { month: "short" }),
      isToday: i === 0,
    };
  });
}

export function isBookableDate(p: Policy, key: string, now = new Date()) {
  return calendarDays(p, now).some((d) => d.key === key);
}

/**
 * Slots already gone for the day. The slot you are standing in is still
 * bookable; anything earlier is not. Returns slotCount once the library has
 * closed, which leaves nothing to pick.
 */
export function firstOpenSlot(p: Policy, dateKey: string, now = new Date()) {
  if (dateKey !== toDateKey(now)) return 0;
  const mins = now.getHours() * 60 + now.getMinutes();
  return Math.max(
    0,
    Math.min(slotCount(p), Math.floor((mins - p.openMin) / p.slotMin)),
  );
}

/** True once nothing more can be booked today. */
export const isClosedFor = (p: Policy, dateKey: string, now = new Date()) =>
  firstOpenSlot(p, dateKey, now) >= slotCount(p);
