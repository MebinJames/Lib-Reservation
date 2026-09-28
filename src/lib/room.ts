/**
 * The editable half of the room: which tables exist, and the booking policy.
 *
 * Both live in Supabase. Every function takes the client to act with, so the
 * caller decides whose permissions apply: a visitor's client can read the room
 * but not change it, which row-level security enforces rather than this file.
 *
 * Unlike the old libSQL version, reading never seeds an empty room — a
 * visitor's client is not allowed to write. `ensureSeeded` does that, from the
 * admin side.
 */

import { randomUUID } from "node:crypto";

import {
  DEFAULT_LAYOUT,
  KIND_META,
  MAX_SEATS,
  MAX_TABLE_NUMBER,
  MIN_SEATS,
  buildLayout,
  norm180,
  type Layout,
  type TableKind,
  type TableSpec,
} from "./floorplan";
import { DEFAULT_POLICY, normalise, type Policy } from "./policy";
import { rejectedCredentials, type DB } from "./supabase/server";

const KINDS: TableKind[] = ["round", "square", "computer"];
export const isKind = (v: unknown): v is TableKind =>
  typeof v === "string" && (KINDS as string[]).includes(v);

// The id column is a Postgres uuid, so anything else would be refused there.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isUuid = (v: unknown): v is string =>
  typeof v === "string" && UUID_RE.test(v);

const orNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/* --------------------------------------------------------------- layout */

export async function loadSpecs(sb: DB): Promise<TableSpec[]> {
  const { data, error } = await sb
    .from("layout_tables")
    .select("id, kind, x, y, rot, seats, num");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    id: String(r.id),
    kind: String(r.kind) as TableKind,
    x: Number(r.x),
    y: Number(r.y),
    rot: orNull(r.rot),
    seats: orNull(r.seats),
    num: orNull(r.num),
  }));
}

export async function loadLayout(sb: DB): Promise<Layout> {
  return buildLayout(await loadSpecs(sb));
}

const defaultSpecs = (): TableSpec[] =>
  DEFAULT_LAYOUT.map((t) => ({ id: randomUUID(), ...t }));

/** Seeds the drawn room if the table is empty. Needs a client that may write. */
export async function ensureSeeded(sb: DB): Promise<TableSpec[]> {
  const specs = await loadSpecs(sb);
  if (specs.length > 0) return specs;
  const seeded = defaultSpecs();
  await writeSpecs(sb, seeded);
  return seeded;
}

/**
 * Replaces the whole layout in one database call. Tables that survive keep
 * their id, which is what keeps bookings on their seats resolving.
 */
export async function writeSpecs(sb: DB, specs: TableSpec[]): Promise<void> {
  const { error } = await sb.rpc("replace_layout", {
    specs: specs.map((s) => ({
      id: s.id,
      kind: s.kind,
      x: s.x,
      y: s.y,
      rot: s.rot ?? null,
      seats: s.seats ?? null,
      num: s.num ?? null,
    })),
  });
  if (error) throw error;
}

export async function resetLayout(sb: DB): Promise<TableSpec[]> {
  const specs = defaultSpecs();
  await writeSpecs(sb, specs);
  return specs;
}

/**
 * Validates admin input. Positions are clamped rather than rejected so a
 * stray drag can't produce an unusable room.
 */
export function cleanSpecs(raw: unknown): TableSpec[] {
  if (!Array.isArray(raw)) throw new Error("Layout must be a list of tables.");
  if (raw.length > 400) throw new Error("That is more tables than the room can hold.");
  const seen = new Set<string>();
  const cleaned: TableSpec[] = raw.map((t, i) => {
    const o = t as Record<string, unknown>;
    if (!isKind(o.kind)) throw new Error(`Table ${i + 1} has an unknown type.`);
    const x = Number(o.x);
    const y = Number(o.y);
    if (!Number.isFinite(x) || !Number.isFinite(y))
      throw new Error(`Table ${i + 1} has no position.`);
    // Keep the stable id when the client sends one back, so reservations hold.
    let id = isUuid(o.id) ? o.id : randomUUID();
    if (seen.has(id)) id = randomUUID();
    seen.add(id);
    // rot is optional: absent or null means "work it out from the position"
    const rawRot = o.rot;
    const rot =
      rawRot === null || rawRot === undefined || rawRot === ""
        ? null
        : Number(rawRot);
    if (rot !== null && !Number.isFinite(rot))
      throw new Error(`Table ${i + 1} has an invalid rotation.`);

    // seats is optional: absent or null means "the type's usual number"
    const rawSeats = o.seats;
    const seats =
      rawSeats === null || rawSeats === undefined || rawSeats === ""
        ? null
        : Number(rawSeats);
    if (seats !== null && (!Number.isFinite(seats) || seats < MIN_SEATS || seats > MAX_SEATS))
      throw new Error(
        `Table ${i + 1} must seat between ${MIN_SEATS} and ${MAX_SEATS} people.`,
      );

    // num is optional: absent or null means "number me by position"
    const rawNum = o.num;
    const num =
      rawNum === null || rawNum === undefined || rawNum === ""
        ? null
        : Number(rawNum);
    if (
      num !== null &&
      (!Number.isFinite(num) || num < 1 || num > MAX_TABLE_NUMBER)
    )
      throw new Error(
        `Table ${i + 1} must be numbered between 1 and ${MAX_TABLE_NUMBER}.`,
      );

    return {
      id,
      kind: o.kind,
      num: num === null ? null : Math.round(num),
      seats: seats === null ? null : Math.round(seats),
      x: Math.round(Math.min(4000, Math.max(-4000, x)) * 10) / 10,
      y: Math.round(Math.min(4000, Math.max(-4000, y)) * 10) / 10,
      rot: rot === null ? null : Math.round(norm180(rot) * 10) / 10,
    };
  });

  // Two tables of the same kind cannot claim the same number — the auto
  // numbering flows around pinned ones, but it can't resolve a direct clash.
  const claimed = new Map<string, number>();
  for (const t of cleaned) {
    if (t.num == null) continue;
    const key = `${t.kind}:${t.num}`;
    claimed.set(key, (claimed.get(key) ?? 0) + 1);
  }
  for (const [key, n] of claimed) {
    if (n > 1) {
      const [kind, num] = key.split(":");
      throw new Error(
        `Two ${KIND_META[kind as TableKind].name.toLowerCase()}s are both numbered ${num}.`,
      );
    }
  }

  return cleaned;
}

/* --------------------------------------------------------------- policy */

export async function loadPolicy(sb: DB): Promise<Policy> {
  const { data, error } = await sb.from("settings").select("key, value");
  // A rejected key is a broken configuration, not a broken settings row, and
  // falling back would show an admin the defaults as if they were saved.
  const rejected = rejectedCredentials(error);
  if (rejected) throw rejected;
  // A bad or unreachable settings table must never take the booking page down.
  if (error) return DEFAULT_POLICY;
  const raw: Record<string, unknown> = {};
  for (const r of data ?? []) raw[String(r.key)] = r.value;
  return normalise(raw);
}

/** Every key in one upsert — a single statement, so it lands whole or not at all. */
export async function savePolicy(sb: DB, p: Policy): Promise<Policy> {
  const clean = normalise(p as unknown as Record<string, unknown>);
  const { error } = await sb
    .from("settings")
    .upsert(
      Object.entries(clean).map(([key, value]) => ({ key, value: String(value) })),
    );
  if (error) throw error;
  return clean;
}

export async function resetPolicy(sb: DB): Promise<Policy> {
  // A filter is required: Supabase refuses a DELETE with no WHERE clause.
  const { error } = await sb.from("settings").delete().not("key", "is", null);
  if (error) throw error;
  return DEFAULT_POLICY;
}
