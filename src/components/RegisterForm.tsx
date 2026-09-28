"use client";

import { useState } from "react";

interface Props {
  email: string;
  fullName: string;
  rollNo: string;
  department: string;
  year: number | null;
  registered: boolean;
}

const YEARS = [1, 2, 3, 4, 5, 6];

export default function RegisterForm(props: Props) {
  const [fullName, setFullName] = useState(props.fullName);
  const [rollNo, setRollNo] = useState(props.rollNo);
  const [department, setDepartment] = useState(props.department);
  const [year, setYear] = useState(props.year ? String(props.year) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const res = await fetch("/api/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName, rollNo, department, year }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not save your details.");
        return;
      }
      // First time through, the whole point of registering was to book — so go
      // and do that, rather than leaving them on a form with nothing to press.
      if (!props.registered) {
        window.location.href = "/";
        return;
      }
      setSaved(true);
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  const field =
    "w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--panel)] px-3 py-2.5 text-sm outline-none transition focus:border-[color:var(--accent)]";
  const label =
    "mb-1 block text-xs uppercase tracking-wide text-[color:var(--muted)]";

  return (
    <div className="mx-auto max-w-lg px-4 py-10">
      <h1 className="text-2xl font-semibold">
        {props.registered ? "Your details" : "Finish registering"}
      </h1>
      <p className="mt-2 text-sm text-[color:var(--muted)]">
        {props.registered
          ? "Update what the library holds about you."
          : "The library needs these before you can book a seat. You only do this once."}
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <span className={label}>College account</span>
          <p className="font-mono text-sm">{props.email}</p>
        </div>

        <div>
          <label className={label} htmlFor="fullName">
            Full name
          </label>
          <input
            id="fullName"
            className={field}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            maxLength={120}
            required
            autoComplete="name"
          />
        </div>

        <div>
          <label className={label} htmlFor="rollNo">
            Roll number
          </label>
          <input
            id="rollNo"
            className={`${field} font-mono uppercase`}
            value={rollNo}
            onChange={(e) => setRollNo(e.target.value)}
            maxLength={32}
            required
            autoCapitalize="characters"
            spellCheck={false}
          />
        </div>

        <div>
          <label className={label} htmlFor="department">
            Department
          </label>
          <input
            id="department"
            className={field}
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            maxLength={80}
            required
          />
        </div>

        <div>
          <label className={label} htmlFor="year">
            Year of study
          </label>
          <select
            id="year"
            className={field}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            required
          >
            <option value="" disabled>
              Choose…
            </option>
            {YEARS.map((y) => (
              <option key={y} value={y}>
                Year {y}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p className="rounded-xl border border-[color:var(--danger)] px-3 py-2 text-sm text-[color:var(--danger)]">
            {error}
          </p>
        )}
        {saved && <p className="text-sm text-[color:var(--muted)]">Saved.</p>}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-[color:var(--accent)] px-4 py-2.5 text-sm font-semibold text-[color:var(--accent-ink)] transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy
              ? "Saving…"
              : props.registered
                ? "Save changes"
                : "Save and book a seat"}
          </button>
          <a
            href="/"
            className="text-sm text-[color:var(--muted)] underline underline-offset-4"
          >
            Back to the booking page
          </a>
        </div>
      </form>
    </div>
  );
}
