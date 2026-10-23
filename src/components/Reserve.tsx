"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import FloorPlan, { type SeatState } from "./FloorPlan";
import PlanScroller from "./PlanScroller";
import { Button, Chip, Field, Label, Swatch } from "./ui";
import { KIND_META, type Layout, type TableKind } from "@/lib/floorplan";
import { maxSlots, slotCount, type Policy } from "@/lib/policy";
import {
  calendarDays,
  closeLabel,
  dayLabel,
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
  // Which of my bookings is asking "cancel this?" — a row confirms in place.
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);
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

  /* Keep the chosen day in view in the date strip (without moving the page). */
  useEffect(() => {
    const strip = stripRef.current;
    const el = strip?.querySelector<HTMLElement>(`[data-key="${date}"]`);
    if (!strip || !el) return;
    strip.scrollTo({ left: el.offsetLeft - (strip.clientWidth - el.clientWidth) / 2 });
  }, [date, days]);

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
  const message = error || notice;
  const barVisible = Boolean(seat) || Boolean(message);

  const sorted = [...mine].sort(
    (a, b) => a.date.localeCompare(b.date) || a.start - b.start,
  );
  const upcoming = sorted.filter((r) => r.date >= today);
  const past = sorted.filter((r) => r.date < today).reverse();

  // The slot the library is in right now, or -1 when it is shut.
  const clockNow = new Date();
  const minsNow = clockNow.getHours() * 60 + clockNow.getMinutes();
  const slotNow =
    minsNow >= policy.openMin && minsNow < policy.closeMin
      ? Math.floor((minsNow - policy.openMin) / policy.slotMin)
      : -1;
  const isNow = (r: Reservation) =>
    r.date === today && r.start <= slotNow && slotNow < r.end;

  const openWhen =
    date === today
      ? "today"
      : dayLabel(date, today) === "Tomorrow"
        ? "tomorrow"
        : `on ${dayLabel(date, today)}`;
  const summary =
    date === today && closedToday
      ? `Closed for today · opens again ${openLabel(policy)} tomorrow`
      : `Open ${openWhen} ${openLabel(policy)} – ${closeLabel(policy)}`;

  const selectCls =
    "rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2 text-sm";

  function bookingRow(r: Reservation, cancellable: boolean) {
    const confirming = confirmId === r.id;
    return (
      <li
        key={r.id}
        className="rounded-xl border border-[color:var(--line)] px-3 py-2"
      >
        {confirming ? (
          <div>
            <p className="mb-2 text-sm">Cancel this booking?</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={async () => {
                  await cancel(r.id);
                  setConfirmId(null);
                }}
              >
                Yes, cancel
              </Button>
              <Button size="sm" onClick={() => setConfirmId(null)}>
                Keep
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-2 truncate text-sm font-medium">
                {seatsById.get(r.seatId)?.label ?? "Seat removed"}
                {isNow(r) && (
                  <span className="rounded-full bg-[color:var(--accent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--accent-ink)]">
                    Now
                  </span>
                )}
              </p>
              <p className="text-xs text-[color:var(--muted)]">
                {dayLabel(r.date, today)} · {rangeLabel(policy, r.start, r.end)}
              </p>
            </div>
            {cancellable && (
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => setConfirmId(r.id)}
                className="shrink-0"
              >
                Cancel
              </Button>
            )}
          </div>
        )}
      </li>
    );
  }

  return (
    <div
      className={`mx-auto max-w-[1600px] px-4 py-6 lg:px-8 ${barVisible ? "max-lg:pb-40" : ""}`}
    >
      <header className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Reading Room</h1>
          <p className="text-sm text-[color:var(--muted)]">
            {summary} · up to {policy.maxHours} h · {policy.maxPerStudent} seats
            each
          </p>
        </div>
        <Identity auth={auth} />
      </header>

      {/* ----------------------------------------------------------- when */}
      <section className="mb-5 rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0 lg:flex-1">
            <Label>Date</Label>
            <div
              ref={stripRef}
              className="relative flex gap-2 overflow-x-auto pb-1"
            >
              {days.map((d) => (
                <button
                  key={d.key}
                  data-key={d.key}
                  onClick={() => setDate(d.key)}
                  aria-pressed={d.key === date}
                  className={`flex min-w-14 shrink-0 flex-col items-center rounded-xl border px-2.5 py-1.5 text-sm transition ${
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
          </div>

          {closedToday ? (
            <p className="rounded-xl border border-[color:var(--line)] px-3 py-2 text-sm text-[color:var(--muted)] lg:max-w-xs">
              The library has closed for today (it shuts at {closeLabel(policy)}).
              Pick another date to book a seat.
            </p>
          ) : (
            <div className="flex gap-3">
              <Field label="From">
                <select
                  value={start}
                  onChange={(e) => setStart(Number(e.target.value))}
                  className={selectCls}
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
                  className={selectCls}
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
            </div>
          )}
        </div>
      </section>

      {/* ----------------------------------------------------------- body */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* min-w-0 lets the grid track shrink so the plan scrolls instead of the page. */}
        <div className="min-w-0 rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] p-3">
          <div className="mb-3 flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between">
            <p className="shrink-0 text-sm text-[color:var(--muted)]">
              {closedToday ? (
                "Closed"
              ) : (
                <>
                  <strong className="text-[color:var(--ink)]">
                    {rangeLabel(policy, start, end)}
                  </strong>
                  {loading ? " · checking…" : ` · ${totalFree} of ${seats.length} free`}
                </>
              )}
            </p>
            <div className="flex gap-2 overflow-x-auto pb-1">
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
          </div>

          <PlanScroller>
            <FloorPlan
              layout={layout}
              stateOf={stateOf}
              labelOf={labelOf}
              onSelect={pickSeat}
              filter={filter}
            />
          </PlanScroller>

          <div className="flex flex-wrap gap-4 px-2 pt-3 text-xs text-[color:var(--muted)]">
            <Swatch color="var(--seat-free)">Free</Swatch>
            <Swatch
              color="var(--seat-active)"
              extra={{
                boxShadow:
                  "0 0 0 1.5px var(--panel), 0 0 0 3px var(--seat-active)",
              }}
            >
              Selected
            </Swatch>
            <Swatch
              color="radial-gradient(circle at center, var(--panel) 0 2px, var(--seat-mine) 2.5px)"
            >
              Yours
            </Swatch>
            <Swatch color="repeating-linear-gradient(45deg, var(--seat-taken) 0 2px, var(--seat-taken-hatch) 2px 4px)">
              Taken
            </Swatch>
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          {message && (
            <p
              role="status"
              className={`hidden rounded-xl border px-3 py-2 text-sm lg:block ${
                error
                  ? "border-[color:var(--danger)] text-[color:var(--danger)]"
                  : "border-[color:var(--accent)] text-[color:var(--accent)]"
              }`}
            >
              {message}
            </p>
          )}

          <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
            <h2 className="mb-3 text-sm font-semibold">Book a seat</h2>
            {!seat ? (
              <ol className="space-y-2 text-sm">
                <Step done>Pick a day</Step>
                <Step done={!closedToday}>Pick a time</Step>
                <Step>Tap a green seat on the plan</Step>
              </ol>
            ) : (
              <>
                <p className="text-base font-medium">{seat.label}</p>
                <p className="mb-3 text-sm text-[color:var(--muted)]">
                  {KIND_META[seat.kind].name} · {KIND_META[seat.kind].blurb}
                </p>
                <dl className="mb-4 space-y-1 text-sm">
                  <Row k="Date" v={dayLabel(date, today)} />
                  <Row k="Time" v={rangeLabel(policy, start, end)} />
                </dl>
                <Button
                  variant="primary"
                  onClick={book}
                  disabled={!canBook || busy}
                  className="w-full"
                >
                  {busy ? "Working…" : "Confirm booking"}
                </Button>
                {signedIn && !canBook && (
                  <p className="mt-2 text-xs text-[color:var(--muted)]">
                    {atQuota
                      ? `You are holding all ${policy.maxPerStudent} of your seats. Cancel one to book another.`
                      : "This seat cannot be booked right now."}
                  </p>
                )}
              </>
            )}

            {auth && auth.configured && !auth.student && (
              <div className="mt-4 border-t border-[color:var(--line)] pt-4">
                <a
                  href="/api/auth/signin"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-[color:var(--line)] px-4 py-2.5 text-sm font-medium transition hover:border-[color:var(--accent)]"
                >
                  <GoogleMark />
                  Sign in with Google
                </a>
                <p className="mt-2 text-center text-xs text-[color:var(--muted)]">
                  College accounts only — @{auth.domain}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold">Your bookings</h2>
              {signedIn && (
                <span
                  className={`text-xs ${atQuota ? "text-[color:var(--danger)]" : "text-[color:var(--muted)]"}`}
                >
                  {held} of {policy.maxPerStudent} used
                </span>
              )}
            </div>
            {upcoming.length === 0 ? (
              <p className="text-sm text-[color:var(--muted)]">
                {signedIn ? "Nothing booked yet." : "Sign in to see your bookings."}
              </p>
            ) : (
              <ul className="space-y-2">
                {upcoming.map((r) => bookingRow(r, true))}
              </ul>
            )}
            {past.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-[color:var(--muted)]">
                  Past ({past.length})
                </summary>
                <ul className="mt-2 space-y-2">
                  {past.map((r) => bookingRow(r, false))}
                </ul>
              </details>
            )}
          </div>
        </aside>
      </div>

      {/* Phone only: the booking button lives where the thumb is. */}
      {barVisible && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[color:var(--line)] bg-[color:var(--surface-2)] px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
          {message && (
            <div className="mb-2 flex items-start justify-between gap-3">
              <p
                role="status"
                className={`text-sm ${error ? "text-[color:var(--danger)]" : "text-[color:var(--accent)]"}`}
              >
                {message}
              </p>
              {!seat && (
                <button
                  onClick={() => {
                    setError("");
                    setNotice("");
                  }}
                  className="shrink-0 text-xs underline underline-offset-2"
                >
                  Dismiss
                </button>
              )}
            </div>
          )}
          {seat && (
            <>
              <p className="mb-2 text-sm">
                <strong>{seat.label}</strong>
                <span className="text-[color:var(--muted)]">
                  {" "}
                  · {dayLabel(date, today)} · {rangeLabel(policy, start, end)}
                </span>
              </p>
              {auth && !auth.student && auth.configured ? (
                <a
                  href="/api/auth/signin"
                  className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--accent)] px-4 text-sm font-semibold text-[color:var(--accent-ink)]"
                >
                  Sign in to book
                </a>
              ) : (
                <Button
                  variant="primary"
                  onClick={book}
                  disabled={!canBook || busy}
                  className="min-h-11 w-full"
                >
                  {busy ? "Working…" : "Book this seat"}
                </Button>
              )}
              {signedIn && atQuota && (
                <p className="mt-2 text-xs text-[color:var(--muted)]">
                  You are holding all {policy.maxPerStudent} of your seats.
                  Cancel one to book another.
                </p>
              )}
            </>
          )}
        </div>
      )}
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
      <a
        href="/api/auth/signin"
        className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2 text-sm font-medium transition hover:border-[color:var(--accent)] sm:px-4 sm:py-2.5"
      >
        <GoogleMark />
        Sign in<span className="hidden sm:inline"> with Google</span>
      </a>
    );

  return (
    <div className="flex shrink-0 items-center gap-3">
      <div className="min-w-0 text-right">
        <p className="text-sm font-medium">{auth.student.name}</p>
        <a
          href="/register"
          className="block max-w-[9rem] truncate font-mono text-xs text-[color:var(--muted)] underline decoration-dotted underline-offset-4 sm:max-w-none"
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

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[color:var(--muted)]">{k}</dt>
      <dd className="font-medium">{v}</dd>
    </div>
  );
}

/** One line of the "how to book" guide: ticked once it is true. */
function Step({ done = false, children }: { done?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${
          done
            ? "bg-[color:var(--accent)] text-[color:var(--accent-ink)]"
            : "border border-[color:var(--accent)] text-[color:var(--accent)]"
        }`}
      >
        {done ? "✓" : "→"}
      </span>
      <span className={done ? "text-[color:var(--muted)]" : "font-medium"}>
        {children}
      </span>
      {done && <span className="sr-only"> (done)</span>}
    </li>
  );
}
