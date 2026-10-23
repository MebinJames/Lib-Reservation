/**
 * Small presentational pieces shared by the booking page and the admin.
 *
 * Deliberately stateless and free of data fetching, so either side can use
 * them and nothing here needs "use client" of its own.
 */

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

/* ------------------------------------------------------------- text */

/** The small uppercase caption above a control. */
export function Label({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]">
      {children}
    </span>
  );
}

/** A captioned control. Wrapping in <label> ties the caption to the input. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      {children}
    </label>
  );
}

/** A one-line message: neutral by default, red when `error`. */
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
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

/* --------------------------------------------------------- controls */

const BUTTON_BASE = "transition disabled:cursor-not-allowed disabled:opacity-40";

const BUTTON_VARIANT = {
  primary:
    "bg-[color:var(--accent)] font-semibold text-[color:var(--accent-ink)]",
  secondary:
    "border border-[color:var(--line)] hover:border-[color:var(--accent)]",
  danger:
    "border border-[color:var(--line)] text-[color:var(--danger)] hover:border-[color:var(--danger)]",
} as const;

const BUTTON_SIZE = {
  md: "rounded-xl px-4 py-2.5 text-sm",
  sm: "rounded-lg px-2.5 py-1 text-xs",
} as const;

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: {
  variant?: keyof typeof BUTTON_VARIANT;
  size?: keyof typeof BUTTON_SIZE;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`${BUTTON_BASE} ${BUTTON_SIZE[size]} ${BUTTON_VARIANT[variant]} ${className}`}
      {...rest}
    />
  );
}

/** A filter pill: filled when active. */
export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "border-transparent bg-[color:var(--accent)] text-[color:var(--accent-ink)]"
          : "border-[color:var(--line)] hover:border-[color:var(--accent)]"
      }`}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------ cards */

/** A titled box. `action` sits at the right of the title row. */
export function Card({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">{title}</p>
          {note && <p className="text-xs text-[color:var(--muted)]">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/** A headline number with a caption above and a note below. */
export function Stat({
  label,
  value,
  note,
  children,
}: {
  label: string;
  value: string;
  note: string;
  /** extra content under the note, e.g. a <Meter> */
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-[color:var(--muted)]">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-[color:var(--muted)]">{note}</p>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------ marks */

/** A colour key entry for the floor-plan legend. */
export function Swatch({
  color,
  extra,
  children,
}: {
  /** any CSS `background` value, so a swatch can be a hatch or a dot */
  color: string;
  extra?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="inline-block h-3 w-4 rounded-[3px] border border-[color:var(--seat-edge)]"
        style={{ background: color, ...extra }}
      />
      {children}
    </span>
  );
}

/** A filled-in portion of a whole, e.g. seats in use. */
export function Meter({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  /** what the screen reader announces, e.g. "Seats in use" */
  label: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className="mt-2 h-2 overflow-hidden rounded-full bg-[color:var(--surface-2)]"
    >
      <div
        className="h-full rounded-full bg-[color:var(--accent)]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * One row of a horizontal bar chart. The bar is decoration; the printed number
 * is the information, so nothing depends on being able to see the bar.
 */
export function Bar({
  label,
  value,
  max,
  display,
  highlight = false,
}: {
  label: string;
  value: number;
  max: number;
  /** what to print beside the bar; defaults to the value */
  display?: string;
  highlight?: boolean;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={`w-16 shrink-0 font-mono ${
          highlight
            ? "font-semibold text-[color:var(--ink)]"
            : "text-[color:var(--muted)]"
        }`}
      >
        {label}
      </span>
      <span
        aria-hidden="true"
        className="h-2.5 min-w-0.5 rounded-full bg-[color:var(--accent)]"
        style={{ width: `${pct}%`, opacity: highlight ? 1 : 0.75 }}
      />
      <span className="tabular-nums text-[color:var(--muted)]">
        {display ?? value}
      </span>
    </div>
  );
}
