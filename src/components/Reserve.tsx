"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import FloorPlan, { type SeatState } from "./FloorPlan";
import { KIND_META, type Layout, type TableKind } from "@/lib/floorplan";
import { maxSlots, slotCount, type Policy } from "@/lib/policy";
import {
  calendarDays,
  closeLabel,
  durationLabel,
  firstOpenSlot,
  openLabel,
  rangeLabel,
  slotLabel,
  toDateKey,
} from "@/lib/slots";
import type { Occupancy, Reservation } from "@/lib/types";

const KINDS: TableKind[] = ["round", "square", "computer"];

interface Auth {
  configured: boolean;
  domain: string;
  student: { email: string; name: string } | null;
  registered: boolean;
}
const overlaps = (r: { start: number; end: number }, start: number, end: number) =>
  r.start < end && start < r.end;

export default function Reserve({
  layout,
  policy,
}: {
  layout: Layout;
  policy: Policy;
}) {
  const seats = layout.seats;
  const seatsById = useMemo(
    () => new Map(seats.map((s) => [s.id, s])),
    [seats],
  );
  const SLOTS = slotCount(policy);
  const MAXS = maxSlots(policy);

  // Filled in on mount so the server and client don't disagree about "now".
  const [ready, setReady] = useState(false);
  const [today, setToday] = useState("");
  const [date, setDate] = useState("");
  const [start, setStart] = useState(0);
  const [slots, setSlots] = useState(Math.min(4, MAXS));

  const [auth, setAuth] = useState<Auth | null>(null);

  const [filter, setFilter] = useState<TableKind | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const [dayRows, setDayRows] = useState<Occupancy[]>([]);
  const [mine, setMine] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const days = useMemo(
    () => (ready ? calendarDays(policy) : []),
    [ready, policy],
  );
  const end = Math.min(start + slots, SLOTS);

  /* -------------------------------------------------------------- mount */
  useEffect(() => {
    const key = toDateKey(new Date());
    setToday(key);
    setDate(key);
    setStart(Math.min(firstOpenSlot(policy, key), SLOTS - 1));
    setReady(true);

    // Anything the sign-in round trip wanted to tell us comes back on the URL.
    const q = new URLSearchParams(window.location.search);
    if (q.get("error")) setError(q.get("error")!);
    if (q.get("error") || q.get("welcome"))
      window.history.replaceState({}, "", window.location.pathname);

    fetch("/api/auth/session", { cache: "no-store" })
      .then((r) => r.json())
      .then(setAuth)
      .catch(() =>
        setAuth({
          configured: false,
          domain: "",
          student: null,
          registered: false,
        }),
      );
  }, [policy, SLOTS]);

  /* ------------------------------------------------------------ loading */
  const loadDay = useCallback(async (d: string) => {
    if (!d) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/reservations?date=${d}`, { cache: "no-store" });
      const json = await res.json();
      setDayRows(res.ok ? json.reservations : []);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMine = useCallback(async () => {
    try {
      const res = await fetch("/api/reservations?mine=1", { cache: "no-store" });
      const json = await res.json();
      setMine(res.ok ? json.reservations : []);
    } catch {
      /* the day view already surfaces connection problems */
    }
  }, []);

  useEffect(() => {
    void loadDay(date);
  }, [date, loadDay]);

  useEffect(() => {
    if (auth?.student) void loadMine();
    else setMine([]);
  }, [auth, loadMine]);

  /* Keep the start time from drifting into the past on today's date. */
  useEffect(() => {
    if (!ready || !date) return;
    const first = firstOpenSlot(policy, date);
    setStart((s) => (s < first ? Math.min(first, SLOTS - 1) : s));
  }, [date, ready, policy, SLOTS]);

  /* -------------------------------------------------------------- state */
  const takenBy = useMemo(() => {
    const map = new Map<string, Occupancy>();
    for (const r of dayRows) if (overlaps(r, start, end)) map.set(r.seatId, r);
    return map;
  }, [dayRows, start, end]);

  // The day view no longer says who holds a seat, so "mine" comes from the
  // student's own bookings rather than being read off the occupancy.
  const isMine = useCallback(
    (seatId: string) =>
      mine.some(
        (r) => r.date === date && r.seatId === seatId && overlaps(r, start, end),
      ),
    [mine, date, start, end],
  );

  const stateOf = useCallback(
    (seatId: string): SeatState => {
      if (seatId === selected) return "selected";
      if (!takenBy.has(seatId)) return "available";
      return isMine(seatId) ? "mine" : "booked";
    },
    [selected, takenBy, isMine],
  );

  const labelOf = useCallback(
    (seatId: string) => {
      const seat = seatsById.get(seatId);
      const base = seat?.label ?? seatId;
      const r = takenBy.get(seatId);
      if (!r) return `${base} — available`;
      const when = rangeLabel(policy, r.start, r.end);
      return isMine(seatId)
        ? `${base} — booked by you, ${when}`
        : `${base} — booked, ${when}`;
    },
    [takenBy, isMine, seatsById, policy],
  );

  const counts = useMemo(
    () =>
      KINDS.map((k) => {
        const all = seats.filter((s) => s.kind === k);
        return {
          kind: k,
          free: all.filter((s) => !takenBy.has(s.id)).length,
          total: all.length,
        };
      }).filter((c) => c.total > 0),
    [takenBy, seats],
  );

  const totalFree = counts.reduce((n, c) => n + c.free, 0);
  /* Only bookings still ahead of the student count against the quota. */
  const held = useMemo(
    () => mine.filter((r) => r.date >= today).length,
    [mine, today],
  );
  const atQuota = held >= policy.maxPerStudent;

  /* ------------------------------------------------------------ actions */
  function pickSeat(seatId: string) {
    setError("");
    setNotice("");
    setSelected((cur) => (cur === seatId ? null : seatId));
  }

  async function book() {
    if (!selected) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/reservations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ seatId: selected, date, start, end }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not save the booking.");
        return;
      }
      setNotice(
        `${seatsById.get(selected)?.label ?? "Seat"} booked for ${rangeLabel(policy, start, end)}.`,
      );
      setSelected(null);
      await Promise.all([loadDay(date), loadMine()]);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch(`/api/reservations/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not cancel.");
        return;
      }
      setNotice("Reservation cancelled.");
      await Promise.all([loadDay(date), loadMine()]);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------- render */
  if (!ready)
    return (
      <div className="grid min-h-screen place-items-center text-[color:var(--muted)]">
        Loading the reading room…
      </div>
    );

  const seat = selected ? seatsById.get(selected) : null;
  const first = firstOpenSlot(policy, date);
  const closedToday = first >= SLOTS;
  const signedIn = Boolean(auth?.student);
  const canBook = Boolean(seat) && signedIn && !atQuota && !closedToday;

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reading Room</h1>
          <p className="text-sm text-[color:var(--muted)]">
            {seats.length} seats · open {openLabel(policy)}–{closeLabel(policy)} · up
            to {policy.maxHours} hours · {policy.maxPerStudent} seats per student
          </p>
        </div>
        <Identity auth={auth} />
      </header>

      {/* ------------------------------------------------------- controls */}
      <section className="mb-5 rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
        <Label>Date</Label>
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
          {days.map((d) => (
            <button
              key={d.key}
              onClick={() => setDate(d.key)}
              className={`flex min-w-16 shrink-0 flex-col items-center rounded-xl border px-3 py-2 text-sm transition ${
                d.key === date
                  ? "border-transparent bg-[color:var(--accent)] text-[color:var(--accent-ink)]"
                  : "border-[color:var(--line)] hover:border-[color:var(--accent)]"
              }`}
            >
              <span className="text-[11px] uppercase opacity-70">
                {d.isToday ? "Today" : d.weekday}
              </span>
              <span className="text-base font-semibold">{d.day}</span>
              <span className="text-[11px] opacity-70">{d.month}</span>
            </button>
          ))}
        </div>

        {closedToday ? (
          <p className="rounded-xl border border-[color:var(--line)] px-3 py-2 text-sm text-[color:var(--muted)]">
            The library has closed for today (it shuts at {closeLabel(policy)}).
            Pick another date to book a seat.
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-4">
            <Field label="From">
              <select
                value={start}
                onChange={(e) => setStart(Number(e.target.value))}
                className="rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2 text-sm"
              >
                {Array.from({ length: SLOTS }, (_, i) => i)
                  .filter((i) => i >= first)
                  .map((i) => (
                    <option key={i} value={i}>
                      {slotLabel(policy, i)}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="For">
              <select
                value={slots}
                onChange={(e) => setSlots(Number(e.target.value))}
                className="rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2 text-sm"
              >
                {Array.from({ length: MAXS }, (_, i) => i + 1)
                  .filter((n) => start + n <= SLOTS)
                  .map((n) => (
                    <option key={n} value={n}>
                      {durationLabel(policy, n)}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="pb-2 text-sm text-[color:var(--muted)]">
              Showing{" "}
              <strong className="text-[color:var(--ink)]">
                {rangeLabel(policy, start, end)}
              </strong>
              {loading
                ? " · checking…"
                : ` · ${totalFree} of ${seats.length} seats free`}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <Chip active={filter === null} onClick={() => setFilter(null)}>
            All seats
          </Chip>
          {counts.map((c) => (
            <Chip
              key={c.kind}
              active={filter === c.kind}
              onClick={() => setFilter(filter === c.kind ? null : c.kind)}
            >
              {KIND_META[c.kind].name}s · {c.free}/{c.total}
            </Chip>
          ))}
        </div>
      </section>

      {/* ----------------------------------------------------------- body */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* min-w-0 lets the grid track shrink so the plan scrolls instead of the page. */}
        <div className="min-w-0 rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] p-3">
          {/* On a phone the plan scrolls sideways so seats stay big enough to tap. */}
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <FloorPlan
                layout={layout}
                stateOf={stateOf}
                labelOf={labelOf}
                onSelect={pickSeat}
                filter={filter}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 px-2 pt-3 text-xs text-[color:var(--muted)]">
            <Swatch color="var(--seat-free)">Available</Swatch>
            <Swatch color="var(--seat-active)">Selected</Swatch>
            <Swatch color="var(--seat-mine)">Yours</Swatch>
            <Swatch color="var(--seat-taken)">Taken</Swatch>
          </div>
        </div>

        <aside className="space-y-4">
          {(error || notice) && (
            <p
              role="status"
              className={`rounded-xl border px-3 py-2 text-sm ${
                error
                  ? "border-[color:var(--danger)] text-[color:var(--danger)]"
                  : "border-[color:var(--accent)] text-[color:var(--accent)]"
              }`}
            >
              {error || notice}
            </p>
          )}

          <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
            <h2 className="mb-3 text-sm font-semibold">Selected seat</h2>
            {!seat ? (
              <p className="text-sm text-[color:var(--muted)]">
                Pick a green seat on the plan to reserve it.
              </p>
            ) : (
              <>
                <p className="text-base font-medium">{seat.label}</p>
                <p className="mb-3 text-sm text-[color:var(--muted)]">
                  {KIND_META[seat.kind].name} · {KIND_META[seat.kind].blurb}
                </p>
                <dl className="mb-4 space-y-1 text-sm">
                  <Row k="Date" v={date} />
                  <Row k="Time" v={rangeLabel(policy, start, end)} />
                </dl>
                <button
                  onClick={book}
                  disabled={!canBook || busy}
                  className="w-full rounded-xl bg-[color:var(--accent)] px-4 py-2.5 text-sm font-semibold text-[color:var(--accent-ink)] transition disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {busy ? "Working…" : "Confirm booking"}
                </button>
                {!canBook && (
                  <p className="mt-2 text-xs text-[color:var(--muted)]">
                    {!signedIn
                      ? `Sign in with your @${auth?.domain ?? "college"} account to book this seat.`
                      : atQuota
                        ? `You are holding all ${policy.maxPerStudent} of your seats. Cancel one to book another.`
                        : "This seat cannot be booked right now."}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Your reservations</h2>
              {signedIn && (
                <span
                  className={`text-xs ${atQuota ? "text-[color:var(--danger)]" : "text-[color:var(--muted)]"}`}
                >
                  {held} of {policy.maxPerStudent} used
                </span>
              )}
            </div>
            {mine.length === 0 ? (
              <p className="text-sm text-[color:var(--muted)]">
                {signedIn
                  ? "Nothing booked yet."
                  : "Sign in to see your bookings."}
              </p>
            ) : (
              <ul className="space-y-2">
                {mine.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[color:var(--line)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {seatsById.get(r.seatId)?.label ?? "Seat removed"}
                      </p>
                      <p className="text-xs text-[color:var(--muted)]">
                        {r.date} · {rangeLabel(policy, r.start, r.end)}
                      </p>
                    </div>
                    <button
                      onClick={() => cancel(r.id)}
                      disabled={busy}
                      className="shrink-0 rounded-lg border border-[color:var(--line)] px-2.5 py-1 text-xs text-[color:var(--danger)] transition hover:border-[color:var(--danger)] disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * Who you are, top right: a sign-in button, or the account you are booking as.
 */
function Identity({ auth }: { auth: Auth | null }) {
  if (!auth)
    return <span className="text-sm text-[color:var(--muted)]">Checking…</span>;

  if (!auth.configured)
    return (
      <p className="max-w-xs text-right text-xs text-[color:var(--danger)]">
        Sign-in is not configured yet, so seats cannot be booked. Set the
        Supabase keys in .env.local.
      </p>
    );

  if (!auth.student)
    return (
      <div className="text-right">
        <a
          href="/api/auth/signin"
          className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-2.5 text-sm font-medium transition hover:border-[color:var(--accent)]"
        >
          <GoogleMark />
          Sign in with Google
        </a>
        <p className="mt-1 text-xs text-[color:var(--muted)]">
          College accounts only — @{auth.domain}
        </p>
      </div>
    );

  return (
    <div className="flex items-center gap-3">
      <div className="text-right">
        <p className="text-sm font-medium">{auth.student.name}</p>
        <a
          href="/register"
          className="font-mono text-xs text-[color:var(--muted)] underline decoration-dotted underline-offset-4"
          title="Your details"
        >
          {auth.student.email}
        </a>
      </div>
      <button
        onClick={async () => {
          await fetch("/api/auth/session", { method: "DELETE" });
          window.location.reload();
        }}
        className="rounded-lg border border-[color:var(--line)] px-3 py-1.5 text-sm transition hover:border-[color:var(--accent)]"
      >
        Sign out
      </button>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.5 6.6-16.1z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.8 28.2c-.4-1.3-.7-2.7-.7-4.2s.2-2.9.7-4.2v-5.7H4.5C2.9 17.3 2 20.5 2 24s.9 6.7 2.5 9.9l7.3-5.7z" />
      <path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.4 2 8.1 6.9 4.5 14.1l7.3 5.7c1.7-5.2 6.5-9 12.2-9z" />
    </svg>
  );
}

/* ------------------------------------------------------------- bits */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      {children}
    </label>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]">
      {children}
    </span>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "border-transparent bg-[color:var(--accent)] text-[color:var(--accent-ink)]"
          : "border-[color:var(--line)] hover:border-[color:var(--accent)]"
      }`}
    >
      {children}
    </button>
  );
}

function Swatch({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-3 w-4 rounded-[3px] border border-[color:var(--seat-edge)]"
        style={{ background: color }}
      />
      {children}
    </span>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[color:var(--muted)]">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}
