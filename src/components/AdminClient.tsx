"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import LayoutEditor from "./LayoutEditor";
import type { TableSpec } from "@/lib/floorplan";
// Type-only, so the `server-only` guard in these modules is never imported.
import type { Overview } from "@/lib/overview";
import type { Person } from "@/lib/people";
import { FIELDS, type Policy, policyProblems } from "@/lib/policy";
import { clock, rangeLabel } from "@/lib/slots";
import type { Reservation } from "@/lib/types";

type Tab = "overview" | "layout" | "settings" | "bookings" | "people";

export default function AdminClient({ enabled }: { enabled: boolean }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [dirty, setDirty] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  async function signOut() {
    if (dirty && !window.confirm("Discard unsaved layout changes and sign out?"))
      return;
    setSigningOut(true);
    setSignOutError("");
    try {
      const res = await fetch("/api/admin/session", { method: "DELETE" });
      // A route that answers but refuses would still resolve fetch() without
      // throwing, so the cookie could still be sitting there unless this is
      // checked — trusting the promise alone is exactly what made a failed
      // sign-out look identical to a working one.
      if (!res.ok) throw new Error(`server returned ${res.status}`);
      setSignedIn(false);
    } catch {
      setSignOutError("Could not sign out. Check your connection and try again.");
    } finally {
      setSigningOut(false);
    }
  }

  useEffect(() => {
    if (!enabled) {
      setSignedIn(false);
      return;
    }
    fetch("/api/admin/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setSignedIn(Boolean(j.signedIn)))
      .catch(() => setSignedIn(false));
  }, [enabled]);

  /* Warn before losing unsaved layout edits. */
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  if (!enabled) return <Disabled />;
  if (signedIn === null)
    return (
      <div className="grid min-h-screen place-items-center text-[color:var(--muted)]">
        Checking…
      </div>
    );
  if (!signedIn) return <SignIn onDone={() => setSignedIn(true)} />;

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Room admin</h1>
          <p className="text-sm text-[color:var(--muted)]">
            The room, the rules, the bookings and who may do what.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/" className="underline underline-offset-2">
            View booking page
          </Link>
          <button
            onClick={signOut}
            disabled={signingOut}
            className="rounded-lg border border-[color:var(--line)] px-3 py-1.5 transition hover:border-[color:var(--accent)] disabled:opacity-40"
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </header>

      {signOutError && (
        <p className="mb-5 rounded-xl border border-[color:var(--danger)] px-3 py-2 text-sm text-[color:var(--danger)]">
          {signOutError}
        </p>
      )}

      <nav className="mb-5 flex flex-wrap gap-2">
        {(
          [
            ["overview", "Overview"],
            ["layout", `Layout${dirty ? " •" : ""}`],
            ["settings", "Booking rules"],
            ["bookings", "Bookings"],
            ["people", "People"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
              tab === id
                ? "border-transparent bg-[color:var(--accent)] text-[color:var(--accent-ink)]"
                : "border-[color:var(--line)] hover:border-[color:var(--accent)]"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "overview" && <OverviewTab onJump={setTab} />}
      {tab === "layout" && <LayoutTab onDirtyChange={setDirty} />}
      {tab === "settings" && <SettingsTab />}
      {tab === "bookings" && <BookingsTab />}
      {tab === "people" && <PeopleTab />}
    </div>
  );
}

/* ------------------------------------------------------------ gates */

function Disabled() {
  return (
    <div className="mx-auto max-w-xl px-6 py-20">
      <h1 className="mb-3 text-2xl font-semibold">Admin area is off</h1>
      <p className="mb-4 text-sm text-[color:var(--muted)]">
        No admin password is configured, so the editor stays closed. Add one to{" "}
        <code className="rounded bg-[color:var(--panel)] px-1.5 py-0.5">
          .env.local
        </code>{" "}
        and restart the server:
      </p>
      <pre className="mb-4 overflow-x-auto rounded-xl border border-[color:var(--line)] bg-[color:var(--panel)] p-3 text-xs">
        ADMIN_PASSWORD=choose-something-long
      </pre>
      <Link href="/" className="text-sm underline underline-offset-2">
        Back to the booking page
      </Link>
    </div>
  );
}

function SignIn({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not sign in.");
        return;
      }
      onDone();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm px-6 py-24">
      <h1 className="mb-1 text-2xl font-semibold">Room admin</h1>
      <p className="mb-6 text-sm text-[color:var(--muted)]">
        Staff only. Enter the admin password.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2.5 text-sm outline-none focus:border-[color:var(--accent)]"
        />
        {error && (
          <p role="alert" className="text-sm text-[color:var(--danger)]">
            {error}
          </p>
        )}
        <button
          disabled={busy || !password}
          className="w-full rounded-xl bg-[color:var(--accent)] px-4 py-2.5 text-sm font-semibold text-[color:var(--accent-ink)] transition disabled:opacity-40"
        >
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
      <p className="mt-6 text-center text-xs text-[color:var(--muted)]">
        <Link href="/" className="underline underline-offset-2">
          Back to the booking page
        </Link>
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- tabs */

function LayoutTab({ onDirtyChange }: { onDirtyChange: (d: boolean) => void }) {
  const [specs, setSpecs] = useState<TableSpec[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/layout", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.specs ? setSpecs(j.specs) : setError(j.error ?? "Failed.")))
      .catch(() => setError("Could not reach the server."));
  }, []);

  if (error) return <Notice error>{error}</Notice>;
  if (!specs) return <Notice>Loading the layout…</Notice>;
  return <LayoutEditor initial={specs} onDirtyChange={onDirtyChange} />;
}

function SettingsTab() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    fetch("/api/admin/policy", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.policy ? setPolicy(j.policy) : setError(j.error ?? "Failed.")))
      .catch(() => setError("Could not reach the server."));
  }, []);
  useEffect(load, [load]);

  if (error) return <Notice error>{error}</Notice>;
  if (!policy) return <Notice>Loading settings…</Notice>;

  const problems = policyProblems(policy);

  async function send(method: "PUT" | "DELETE") {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/admin/policy", {
        method,
        headers: { "content-type": "application/json" },
        body: method === "PUT" ? JSON.stringify({ policy }) : undefined,
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not save.");
        return;
      }
      setPolicy(json.policy);
      setMsg(method === "PUT" ? "Saved. The booking page uses these now." : "Back to defaults.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      {msg && <Notice>{msg}</Notice>}
      <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]">
                {f.label}
              </span>
              <input
                type="number"
                min={f.min}
                max={f.max}
                step={f.step}
                value={policy[f.key]}
                onChange={(e) =>
                  setPolicy({ ...policy, [f.key]: Number(e.target.value) })
                }
                className="w-full rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2 font-mono text-sm outline-none focus:border-[color:var(--accent)]"
              />
              <span className="mt-1 block text-xs text-[color:var(--muted)]">
                {f.time ? clock(policy[f.key]) : f.hint}
              </span>
            </label>
          ))}
        </div>

        <p className="mt-4 rounded-xl border border-[color:var(--line)] px-3 py-2 text-sm text-[color:var(--muted)]">
          Students book{" "}
          <strong className="text-[color:var(--ink)]">
            {clock(policy.openMin)}–{clock(policy.closeMin)}
          </strong>{" "}
          in {policy.slotMin}-minute slots, up to {policy.maxHours} hours at a
          time, {policy.maxPerStudent} seats each, {policy.daysAhead} days ahead.
        </p>

        {problems.map((p) => (
          <p key={p} className="mt-2 text-sm text-[color:var(--danger)]">
            {p}
          </p>
        ))}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => send("PUT")}
            disabled={busy || problems.length > 0}
            className="rounded-xl bg-[color:var(--accent)] px-4 py-2.5 text-sm font-semibold text-[color:var(--accent-ink)] transition disabled:opacity-40"
          >
            {busy ? "Working…" : "Save rules"}
          </button>
          <button
            onClick={() => send("DELETE")}
            disabled={busy}
            className="rounded-xl border border-[color:var(--line)] px-4 py-2.5 text-sm transition hover:border-[color:var(--danger)] disabled:opacity-40"
          >
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  );
}

function BookingsTab() {
  const [rows, setRows] = useState<Reservation[] | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [orphans, setOrphans] = useState<Set<string>>(new Set());
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Takes the filters as arguments rather than reading state, so it can run on
  // mount and after a cancel without the effect re-firing on every keystroke.
  const load = useCallback((f: string, t: string, query: string) => {
    const params = new URLSearchParams();
    if (f) params.set("from", f);
    if (t) params.set("to", t);
    if (query.trim()) params.set("q", query.trim());
    setError("");
    Promise.all([
      fetch(`/api/admin/reservations?${params}`, { cache: "no-store" }).then(
        (r) => r.json(),
      ),
      fetch("/api/admin/policy", { cache: "no-store" }).then((r) => r.json()),
    ])
      .then(([a, b]) => {
        if (a.error) return setError(a.error);
        setRows(a.reservations);
        setLabels(a.labels ?? {});
        setOrphans(new Set<string>(a.orphanedIds ?? []));
        // First load: let the server's own defaults fill the date boxes, so
        // the form shows the range that actually produced these rows.
        if (a.range) {
          setFrom((cur) => cur || a.range.from);
          setTo((cur) => cur || a.range.to);
        }
        if (b.policy) setPolicy(b.policy);
      })
      .catch(() => setError("Could not reach the server."));
  }, []);

  useEffect(() => {
    load("", "", "");
  }, [load]);

  async function cancel(id: string) {
    setBusy(true);
    try {
      await fetch(`/api/admin/reservations/${id}`, { method: "DELETE" });
      load(from, to, q);
    } finally {
      setBusy(false);
    }
  }

  const box =
    "rounded-xl border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2 text-sm outline-none transition focus:border-[color:var(--accent)]";

  const filters = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        load(from, to, q);
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <label className="text-xs uppercase tracking-wide text-[color:var(--muted)]">
        <span className="mb-1 block">From</span>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={box}
        />
      </label>
      <label className="text-xs uppercase tracking-wide text-[color:var(--muted)]">
        <span className="mb-1 block">To</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className={box}
        />
      </label>
      <label className="min-w-48 flex-1 text-xs uppercase tracking-wide text-[color:var(--muted)]">
        <span className="mb-1 block">Search</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Name, address or seat"
          className={`${box} w-full`}
        />
      </label>
      <button
        type="submit"
        className="rounded-xl border border-[color:var(--line)] px-4 py-2 text-sm font-medium transition hover:border-[color:var(--accent)]"
      >
        Apply
      </button>
    </form>
  );

  if (error)
    return (
      <div className="max-w-4xl space-y-3">
        {filters}
        <Notice error>{error}</Notice>
      </div>
    );
  if (!rows || !policy)
    return (
      <div className="max-w-4xl space-y-3">
        {filters}
        <Notice>Loading bookings…</Notice>
      </div>
    );

  return (
    <div className="max-w-4xl space-y-3">
      {filters}
      {orphans.size > 0 && (
        <Notice error>
          {orphans.size} booking{orphans.size > 1 ? "s are" : " is"} on a seat
          that no longer exists. Cancel them, or put the table back.
        </Notice>
      )}
      {rows.length === 0 && (
        <Notice>
          No bookings in that range{q.trim() ? " matching that search" : ""}.
        </Notice>
      )}
      {rows.length > 0 && (
        <p className="text-xs text-[color:var(--muted)]">
          {rows.length} booking{rows.length === 1 ? "" : "s"}
        </p>
      )}
      {rows.length > 0 && (
      <div className="overflow-x-auto rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)]">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-[color:var(--muted)]">
            <tr className="border-b border-[color:var(--line)]">
              <th className="px-4 py-3">Date</th>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Seat</th>
              <th className="px-4 py-3">Student</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[color:var(--line)] last:border-0">
                <td className="px-4 py-3 font-mono">{r.date}</td>
                <td className="px-4 py-3">{rangeLabel(policy, r.start, r.end)}</td>
                <td className="px-4 py-3">
                  {labels[r.seatId] ?? r.seatId}
                  {orphans.has(r.id) && (
                    <span className="block text-xs text-[color:var(--danger)]">
                      seat removed
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {r.name}
                  <span className="block font-mono text-xs text-[color:var(--muted)]">
                    {r.studentId}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => cancel(r.id)}
                    disabled={busy}
                    className="rounded-lg border border-[color:var(--line)] px-2.5 py-1 text-xs text-[color:var(--danger)] transition hover:border-[color:var(--danger)] disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------- overview */

function OverviewTab({ onJump }: { onJump: (t: Tab) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/overview", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => (j.error ? setError(j.error) : setData(j.overview)))
      .catch(() => setError("Could not reach the server."));
  }, []);

  if (error) return <Notice error>{error}</Notice>;
  if (!data) return <Notice>Counting…</Notice>;

  const busiest = Math.max(1, ...data.byHour.map((h) => h.bookings));

  return (
    <div className="max-w-4xl space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={data.today.openNow ? "In use now" : "Library is shut"}
          value={`${data.seats.occupiedNow} / ${data.seats.total}`}
          note={
            data.today.openNow
              ? `${data.seats.total - data.seats.occupiedNow} seats free`
              : "seats occupied when it reopens"
          }
        />
        <Stat
          label="Booked today"
          value={String(data.today.bookings)}
          note={`busiest moment: ${data.today.peak} seat${data.today.peak === 1 ? "" : "s"} at once`}
        />
        <Stat
          label={`Next ${data.ahead.days} days`}
          value={String(data.ahead.bookings)}
          note="bookings on the books"
        />
        <Stat
          label="People"
          value={String(data.people.total)}
          note={`${data.people.admins} admin${data.people.admins === 1 ? "" : "s"}, ${data.people.staff} staff`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Busiest hours" note="last 30 days and the week ahead">
          {data.byHour.length === 0 ? (
            <p className="text-sm text-[color:var(--muted)]">
              Nothing booked yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {data.byHour.map((h) => (
                <li key={h.hour} className="flex items-center gap-2 text-xs">
                  <span className="w-12 shrink-0 font-mono text-[color:var(--muted)]">
                    {String(h.hour).padStart(2, "0")}:00
                  </span>
                  <span
                    className="h-2.5 rounded-full bg-[color:var(--accent)]"
                    style={{ width: `${(h.bookings / busiest) * 100}%` }}
                  />
                  <span className="text-[color:var(--muted)]">{h.bookings}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Most booked seats" note="last 30 days and the week ahead">
          {data.topSeats.length === 0 ? (
            <p className="text-sm text-[color:var(--muted)]">
              Nothing booked yet.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {data.topSeats.map((s) => (
                <li key={s.seatId} className="flex justify-between gap-3">
                  <span>{s.label}</span>
                  <span className="text-[color:var(--muted)]">
                    {s.bookings}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <p className="text-sm text-[color:var(--muted)]">
        {data.people.withDetails} of {data.people.total} have filled in their
        own details.{" "}
        <button
          onClick={() => onJump("people")}
          className="underline underline-offset-2"
        >
          Manage people
        </button>
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-[color:var(--muted)]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-[color:var(--muted)]">{note}</p>
    </div>
  );
}

function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3">
      <p className="text-sm font-medium">{title}</p>
      <p className="mb-3 text-xs text-[color:var(--muted)]">{note}</p>
      {children}
    </div>
  );
}

/* --------------------------------------------------------- people */

function PeopleTab() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback((query: string) => {
    setError("");
    fetch(`/api/admin/people?q=${encodeURIComponent(query.trim())}`, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((j) => (j.error ? setError(j.error) : setPeople(j.people)))
      .catch(() => setError("Could not reach the server."));
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  async function change(id: string, role: string) {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/admin/people/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const body = await res.json().catch(() => ({}));
      // The database refuses to demote the last admin, so a failure here is
      // worth showing rather than leaving the select looking as if it worked.
      if (!res.ok) setError(body.error ?? "Could not change the role.");
      load(q);
    } finally {
      setBusyId("");
    }
  }

  const box =
    "rounded-xl border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2 text-sm outline-none transition focus:border-[color:var(--accent)]";

  return (
    <div className="max-w-4xl space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          load(q);
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, address, roll number or department"
          className={`${box} min-w-64 flex-1`}
        />
        <button
          type="submit"
          className="rounded-xl border border-[color:var(--line)] px-4 py-2 text-sm font-medium transition hover:border-[color:var(--accent)]"
        >
          Search
        </button>
      </form>

      {error && <Notice error>{error}</Notice>}
      {!people ? (
        <Notice>Loading people…</Notice>
      ) : people.length === 0 ? (
        <Notice>
          {q.trim()
            ? "Nobody matches that search."
            : "Nobody has signed in yet."}
        </Notice>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)]">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-[color:var(--muted)]">
              <tr className="border-b border-[color:var(--line)]">
                <th className="px-4 py-3">Person</th>
                <th className="px-4 py-3">Details</th>
                <th className="px-4 py-3">Can do</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-[color:var(--line)] last:border-0"
                >
                  <td className="px-4 py-3">
                    {p.fullName || "—"}
                    <span className="block font-mono text-xs text-[color:var(--muted)]">
                      {p.email}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[color:var(--muted)]">
                    {p.registered ? (
                      <>
                        {p.rollNo && <span className="font-mono">{p.rollNo}</span>}
                        <span className="block">
                          {[p.department, p.year && `year ${p.year}`]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </>
                    ) : (
                      "not filled in"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={p.role}
                      disabled={busyId === p.id}
                      onChange={(e) => change(p.id, e.target.value)}
                      className={`${box} disabled:opacity-40`}
                    >
                      <option value="student">Student</option>
                      <option value="staff">Staff</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-[color:var(--muted)]">
        Every role change is recorded, and the last admin cannot be demoted.
        Changes take effect the next time that person&rsquo;s session refreshes.
      </p>
    </div>
  );
}

function Notice({
  children,
  error = false,
}: {
  children: React.ReactNode;
  error?: boolean;
}) {
  return (
    <p
      role="status"
      className={`rounded-xl border px-3 py-2 text-sm ${
        error
          ? "border-[color:var(--danger)] text-[color:var(--danger)]"
          : "border-[color:var(--line)] text-[color:var(--muted)]"
      }`}
    >
      {children}
    </p>
  );
}
