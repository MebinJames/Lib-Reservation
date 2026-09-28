/**
 * Booking policy — opening hours and the limits placed on students.
 *
 * Held in the settings table and editable from /admin. Anything missing falls
 * back to DEFAULT_POLICY, so the app runs correctly against an empty database.
 */

export interface Policy {
  /** minutes past midnight the library opens */
  openMin: number;
  /** minutes past midnight it closes */
  closeMin: number;
  /** slot granularity in minutes */
  slotMin: number;
  /** longest single booking, in hours */
  maxHours: number;
  /** how far ahead the calendar runs, in days */
  daysAhead: number;
  /** seats one student may hold at once */
  maxPerStudent: number;
}

export const DEFAULT_POLICY: Policy = {
  openMin: 8 * 60,
  closeMin: 17 * 60 + 30,
  slotMin: 30,
  maxHours: 4,
  daysAhead: 14,
  maxPerStudent: 3,
};

/** Number of bookable slots in a day. */
export const slotCount = (p: Policy) =>
  Math.max(1, Math.floor((p.closeMin - p.openMin) / p.slotMin));

/** Longest booking, counted in slots. */
export const maxSlots = (p: Policy) =>
  Math.max(1, Math.round((p.maxHours * 60) / p.slotMin));

export const FIELDS: {
  key: keyof Policy;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  /** shown as a time-of-day rather than a raw number */
  time?: boolean;
}[] = [
  { key: "openMin", label: "Opens", hint: "time the doors open", min: 0, max: 1439, step: 15, time: true },
  { key: "closeMin", label: "Closes", hint: "nothing can be booked past this", min: 1, max: 1440, step: 15, time: true },
  { key: "slotMin", label: "Slot length", hint: "minutes per bookable slot", min: 5, max: 120, step: 5 },
  { key: "maxHours", label: "Max booking", hint: "hours per reservation", min: 1, max: 12, step: 1 },
  { key: "daysAhead", label: "Calendar", hint: "days shown, including today", min: 1, max: 60, step: 1 },
  { key: "maxPerStudent", label: "Seats per student", hint: "held at any one time", min: 1, max: 20, step: 1 },
];

/**
 * Clamps each field into range, falling back to the default for anything
 * missing or unparseable. Deliberately does *not* fix contradictions between
 * fields — callers validate those so the admin gets told, rather than having
 * their input silently rewritten.
 */
export function coerce(raw: Partial<Record<keyof Policy, unknown>>): Policy {
  const out = { ...DEFAULT_POLICY };
  for (const f of FIELDS) {
    const n = Number(raw[f.key]);
    if (Number.isFinite(n)) out[f.key] = Math.min(f.max, Math.max(f.min, Math.round(n)));
  }
  return out;
}

/**
 * Coerce, then force the result to be usable. Used when *reading*, where a bad
 * stored row must never take the booking page down — never when writing.
 */
export function normalise(raw: Partial<Record<keyof Policy, unknown>>): Policy {
  const out = coerce(raw);
  // A day has to contain at least one whole slot.
  if (out.closeMin - out.openMin < out.slotMin) out.closeMin = out.openMin + out.slotMin;
  return out;
}

/** Human-readable problems with a policy, for the admin form. */
export function policyProblems(p: Policy): string[] {
  const out: string[] = [];
  if (p.closeMin <= p.openMin) out.push("Closing time must be after opening time.");
  if (p.closeMin - p.openMin < p.slotMin)
    out.push("The opening hours are shorter than one slot.");
  if ((p.maxHours * 60) % p.slotMin !== 0)
    out.push("Max booking length should be a whole number of slots.");
  return out;
}
