"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import PlanSheet from "./PlanSheet";
import {
  MAX_SEATS,
  MAX_TABLE_NUMBER,
  MIN_SEATS,
  autoRotation,
  CHAIR_H,
  CHAIR_W,
  FAN,
  KIND_META,
  buildLayout,
  fitSpecsToRoom,
  norm180,
  PLAN_FIT,
  pinnedNumber,
  seatCount,
  seatsAdjustable,
  type TableKind,
  type TableSpec,
} from "@/lib/floorplan";

const KINDS: TableKind[] = ["round", "square", "computer"];
const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `t_${Math.random().toString(36).slice(2)}_${Date.now()}`;

export default function LayoutEditor({
  initial,
  onDirtyChange,
}: {
  initial: TableSpec[];
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [specs, setSpecs] = useState<TableSpec[]>(initial);
  const [saved, setSaved] = useState<TableSpec[]>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const gRef = useRef<SVGGElement | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const layout = useMemo(() => buildLayout(specs), [specs]);
  const dirty = useMemo(
    () => JSON.stringify(specs) !== JSON.stringify(saved),
    [specs, saved],
  );
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  const counts = useMemo(
    () =>
      KINDS.map((k) => {
        const of = specs.filter((s) => s.kind === k);
        return {
          kind: k,
          tables: of.length,
          seats: of.reduce((n, s) => n + seatCount(s), 0),
        };
      }),
    [specs],
  );

  /* ------------------------------------------------------ pointer maths */
  /** Screen point -> layout coordinates, through the plan transform. */
  const toLayout = useCallback((clientX: number, clientY: number) => {
    const g = gRef.current;
    if (!g) return null;
    const ctm = g.getScreenCTM();
    if (!ctm) return null;
    const svg = g.ownerSVGElement!;
    const p = svg.createSVGPoint();
    p.x = clientX;
    p.y = clientY;
    return p.matrixTransform(ctm.inverse());
  }, []);

  function onTablePointerDown(e: React.PointerEvent, spec: TableSpec) {
    e.stopPropagation();
    // Selecting must not depend on capture succeeding — a synthetic or already
    // released pointer makes this throw, and losing the click with it.
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      /* dragging still works through the container's move handler */
    }
    const p = toLayout(e.clientX, e.clientY);
    setSelected(spec.id);
    setMsg("");
    if (p) drag.current = { id: spec.id, dx: spec.x - p.x, dy: spec.y - p.y };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const p = toLayout(e.clientX, e.clientY);
    if (!p) return;
    setSpecs((cur) =>
      cur.map((s) =>
        s.id === d.id
          ? {
              ...s,
              x: Math.round((p.x + d.dx) * 10) / 10,
              y: Math.round((p.y + d.dy) * 10) / 10,
            }
          : s,
      ),
    );
  }

  const endDrag = () => {
    drag.current = null;
  };

  /* -------------------------------------------------------- keyboard */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!selected) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeSelected();
        return;
      }
      // [ and ] spin the selected table
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        const by = (e.key === "[" ? -1 : 1) * (e.shiftKey ? 15 : 5);
        setSpecs((cur) =>
          cur.map((s) =>
            s.id === selected
              ? {
                  ...s,
                  rot: norm180(
                    (s.rot ?? autoRotation(s.kind, s.x, s.y)) + by,
                  ),
                }
              : s,
          ),
        );
        return;
      }

      const step = e.shiftKey ? 10 : 1;
      const move: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const d = move[e.key];
      if (!d) return;
      e.preventDefault();
      setSpecs((cur) =>
        cur.map((s) =>
          s.id === selected
            ? { ...s, x: Math.round((s.x + d[0]) * 10) / 10, y: Math.round((s.y + d[1]) * 10) / 10 }
            : s,
        ),
      );
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  /* --------------------------------------------------------- actions */
  /** Apply a change to whichever table is selected. */
  const patchSelected = useCallback(
    (patch: Partial<TableSpec>) =>
      setSpecs((cur) =>
        cur.map((s) => (s.id === selected ? { ...s, ...patch } : s)),
      ),
    [selected],
  );

  function addTable(kind: TableKind) {
    // Drop it just inside the room, offset a little from whatever is there.
    const n = specs.filter((s) => s.kind === kind).length;
    const spec: TableSpec = {
      id: newId(),
      kind,
      x: 700 + ((n * 37) % 260),
      y: kind === "computer" ? 620 + ((n * 23) % 120) : 300 + ((n * 29) % 200),
    };
    setSpecs((cur) => [...cur, spec]);
    setSelected(spec.id);
    setMsg(`${KIND_META[kind].name} added — drag it into place.`);
  }

  function removeSelected() {
    if (!selected) return;
    setSpecs((cur) => cur.filter((s) => s.id !== selected));
    setSelected(null);
    setMsg("Table removed. Save to apply.");
  }

  const clashes = (() => {
    const seen = new Map<string, number>();
    for (const t of specs) {
      const n = pinnedNumber(t);
      if (n === null) continue;
      const k = `${t.kind}:${n}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
    return [...seen.values()].some((n) => n > 1);
  })();

  async function save() {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/admin/layout", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ specs }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not save.");
        return;
      }
      setSpecs(json.specs);
      setSaved(json.specs);
      setMsg("Layout saved.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function resetToDefault() {
    setBusy(true);
    setError("");
    setMsg("");
    try {
      const res = await fetch("/api/admin/layout", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Could not reset.");
        return;
      }
      setSpecs(json.specs);
      setSaved(json.specs);
      setSelected(null);
      setMsg("Layout reset to the original room.");
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const sel = specs.find((s) => s.id === selected) ?? null;
  const selTable = layout.tables.find((t) => t.id === selected) ?? null;
  /** What the rotation control shows: the override, or the automatic angle. */
  const selRot = sel ? (sel.rot ?? autoRotation(sel.kind, sel.x, sel.y)) : 0;
  const selNum = selTable?.num ?? 1;
  /** Another table of the same kind already pinned to this number. */
  const numberClash =
    !!sel &&
    sel.num != null &&
    specs.some(
      (o) =>
        o.id !== sel.id && o.kind === sel.kind && pinnedNumber(o) === sel.num,
    );
  const selSeats = sel ? seatCount(sel) : 0;
  /** How many seats this table had when last saved, so shrinking can warn. */
  const seatsBookedOnSelected = (() => {
    if (!sel) return 0;
    const was = saved.find((s) => s.id === sel.id);
    return was ? seatCount(was) : 0;
  })();

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      {/* ------------------------------------------------------ the plan */}
      <div className="min-w-0 rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] p-3">
        <div className="overflow-x-auto">
          <div
            className="min-w-[760px]"
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            <PlanSheet
              title="LAYOUT EDITOR"
              subtitle={`${specs.length} TABLES · ${layout.seats.length} SEATS${dirty ? " · UNSAVED" : ""}`}
              onBackdropClick={() => setSelected(null)}
            >
              <g
                ref={gRef}
                transform={`translate(${PLAN_FIT.tx} ${PLAN_FIT.ty}) scale(${PLAN_FIT.scale})`}
              >
                {/* seats, drawn faintly — they follow from the tables */}
                <g pointerEvents="none">
                  {layout.seats.map((s) => (
                    <rect
                      key={s.id}
                      x={s.x - CHAIR_W / 2}
                      y={s.y - CHAIR_H / 2}
                      width={CHAIR_W}
                      height={CHAIR_H}
                      rx={6}
                      transform={`rotate(${s.rot} ${s.x} ${s.y})`}
                      fill="var(--seat-free)"
                      opacity={s.tableId === selected ? 0.95 : 0.5}
                      stroke="var(--seat-edge)"
                      strokeWidth={1.5}
                    />
                  ))}
                </g>

                {/* tables — these are what you grab */}
                {layout.tables.map((t) => {
                  const on = t.id === selected;
                  const common = {
                    fill: on ? "var(--seat-active)" : "var(--table-fill)",
                    fillOpacity: on ? 0.28 : 1,
                    stroke: on ? "var(--seat-active)" : "var(--plan-line)",
                    strokeWidth: on ? 5 : 3,
                    style: { cursor: "grab" as const },
                  };
                  const spec = specs.find((s) => s.id === t.id)!;
                  const grab = (e: React.PointerEvent) =>
                    onTablePointerDown(e, spec);
                  return (
                    <g key={t.id} onPointerDown={grab}>
                      <title>
                        {t.code} — drag to move, arrow keys to nudge
                      </title>
                      {t.kind === "round" && (
                        <circle cx={t.x} cy={t.y} r={t.r} {...common} />
                      )}
                      {t.kind === "computer" && (
                        <path
                          d={t.path}
                          transform={
                            t.spin ? `rotate(${t.spin} ${t.x} ${t.y})` : undefined
                          }
                          {...common}
                        />
                      )}
                      {t.kind === "square" && (
                        <rect
                          x={t.x - t.w! / 2}
                          y={t.y - t.h! / 2}
                          width={t.w}
                          height={t.h}
                          transform={`rotate(${t.rot} ${t.x} ${t.y})`}
                          {...common}
                        />
                      )}
                      <text
                        x={t.x}
                        y={t.y}
                        fontSize={20}
                        fontWeight={700}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={on ? "var(--seat-active)" : "var(--plan-label)"}
                        pointerEvents="none"
                      >
                        {t.code}
                      </text>
                    </g>
                  );
                })}

                {/* the point the room fans around, for orientation */}
                <g pointerEvents="none" opacity={0.5}>
                  <circle
                    cx={FAN.x}
                    cy={FAN.y}
                    r={7}
                    fill="none"
                    stroke="var(--plan-dim)"
                    strokeWidth={2}
                  />
                  <line
                    x1={FAN.x - 16}
                    y1={FAN.y}
                    x2={FAN.x + 16}
                    y2={FAN.y}
                    stroke="var(--plan-dim)"
                    strokeWidth={1.5}
                  />
                  <line
                    x1={FAN.x}
                    y1={FAN.y - 16}
                    x2={FAN.x}
                    y2={FAN.y + 16}
                    stroke="var(--plan-dim)"
                    strokeWidth={1.5}
                  />
                </g>
              </g>
            </PlanSheet>
          </div>
        </div>
        <p className="px-2 pt-3 text-xs text-[color:var(--muted)]">
          Drag a table to move it · arrow keys nudge (shift for 10) ·{" "}
          <kbd>[</kbd> and <kbd>]</kbd> rotate (shift for 15°) · Delete removes
          it. Left on auto, study tables and computer desks turn to face the
          marked centre by themselves.
        </p>
      </div>

      {/* ------------------------------------------------------- controls */}
      <aside className="space-y-4">
        {(error || msg) && (
          <p
            role="status"
            className={`rounded-xl border px-3 py-2 text-sm ${
              error
                ? "border-[color:var(--danger)] text-[color:var(--danger)]"
                : "border-[color:var(--accent)] text-[color:var(--accent)]"
            }`}
          >
            {error || msg}
          </p>
        )}

        <Card title="Add a table">
          <div className="grid gap-2">
            {KINDS.map((k) => (
              <button
                key={k}
                onClick={() => addTable(k)}
                className="rounded-xl border border-[color:var(--line)] px-3 py-2 text-left text-sm transition hover:border-[color:var(--accent)]"
              >
                <span className="font-medium">{KIND_META[k].name}</span>
                <span className="block text-xs text-[color:var(--muted)]">
                  {KIND_META[k].blurb}
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card title="Selected">
          {!sel ? (
            <p className="text-sm text-[color:var(--muted)]">
              Click a table on the plan.
            </p>
          ) : (
            <>
              <p className="text-base font-medium">
                {selTable?.code} · {KIND_META[sel.kind].name}
              </p>
              <p className="mb-3 text-xs text-[color:var(--muted)]">
                {selSeats} seat{selSeats > 1 ? "s" : ""}
              </p>

              {/* display number */}
              <label className="mb-3 block">
                <span className="mb-1 flex items-baseline justify-between gap-2 text-xs uppercase tracking-wide text-[color:var(--muted)]">
                  Number
                  <span className="normal-case tracking-normal">
                    {sel.num == null ? "auto" : "pinned"}
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm text-[color:var(--muted)]">
                    {KIND_META[sel.kind].letter}
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={MAX_TABLE_NUMBER}
                    value={selNum}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      patchSelected({
                        num: Math.min(MAX_TABLE_NUMBER, Math.max(1, Math.round(n))),
                      });
                    }}
                    className="w-20 rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] px-2 py-1.5 font-mono text-sm outline-none focus:border-[color:var(--accent)]"
                  />
                  <button
                    onClick={() => patchSelected({ num: null })}
                    disabled={sel.num == null}
                    className="rounded-lg border border-[color:var(--line)] px-2 py-1.5 text-xs transition hover:border-[color:var(--accent)] disabled:opacity-40"
                  >
                    Auto
                  </button>
                </div>
                {numberClash && (
                  <span className="mt-1 block text-xs text-[color:var(--danger)]">
                    Another {KIND_META[sel.kind].name.toLowerCase()} is already
                    pinned to {KIND_META[sel.kind].letter}
                    {selNum}.
                  </span>
                )}
              </label>

              {/* type */}
              <label className="mb-3 block">
                <span className="mb-1 block text-xs uppercase tracking-wide text-[color:var(--muted)]">
                  Type
                </span>
                <select
                  value={sel.kind}
                  onChange={(e) =>
                    patchSelected({ kind: e.target.value as TableKind })
                  }
                  className="w-full rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] px-2 py-1.5 text-sm outline-none focus:border-[color:var(--accent)]"
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_META[k].name}
                    </option>
                  ))}
                </select>
              </label>

              {/* how many people sit here */}
              <label className="mb-3 block">
                <span className="mb-1 flex items-baseline justify-between gap-2 text-xs uppercase tracking-wide text-[color:var(--muted)]">
                  Seats
                  <span className="normal-case tracking-normal">
                    {!seatsAdjustable(sel.kind)
                      ? "one machine, one chair"
                      : sel.seats == null
                        ? "default"
                        : "custom"}
                  </span>
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={MIN_SEATS}
                    max={MAX_SEATS}
                    value={selSeats}
                    disabled={!seatsAdjustable(sel.kind)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (!Number.isFinite(n)) return;
                      patchSelected({
                        seats: Math.min(MAX_SEATS, Math.max(MIN_SEATS, Math.round(n))),
                      });
                    }}
                    className="w-20 rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] px-2 py-1.5 font-mono text-sm outline-none focus:border-[color:var(--accent)] disabled:opacity-40"
                  />
                  <button
                    onClick={() => patchSelected({ seats: null })}
                    disabled={!seatsAdjustable(sel.kind) || sel.seats == null}
                    className="rounded-lg border border-[color:var(--line)] px-2 py-1.5 text-xs transition hover:border-[color:var(--accent)] disabled:opacity-40"
                  >
                    Default
                  </button>
                </div>
                {selSeats < seatsBookedOnSelected && (
                  <span className="mt-1 block text-xs text-[color:var(--danger)]">
                    Fewer seats than before — any booking on a dropped seat will
                    be flagged under Bookings.
                  </span>
                )}
              </label>

              <div className="mb-3 grid grid-cols-2 gap-2">
                <NumField
                  label="X"
                  value={sel.x}
                  onChange={(v) => patchSelected({ x: v })}
                />
                <NumField
                  label="Y"
                  value={sel.y}
                  onChange={(v) => patchSelected({ y: v })}
                />
              </div>

              {/* rotation */}
              <div className="mb-3">
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-xs uppercase tracking-wide text-[color:var(--muted)]">
                    Rotation
                  </span>
                  <span className="text-xs text-[color:var(--muted)]">
                    {sel.rot == null ? "auto" : "manual"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={-180}
                    max={180}
                    step={1}
                    value={Math.round(selRot)}
                    onChange={(e) =>
                      patchSelected({ rot: Number(e.target.value) })
                    }
                    className="min-w-0 flex-1 accent-[color:var(--accent)]"
                  />
                  <input
                    type="number"
                    min={-180}
                    max={180}
                    value={Math.round(selRot)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) patchSelected({ rot: norm180(n) });
                    }}
                    className="w-16 rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] px-2 py-1.5 font-mono text-sm outline-none focus:border-[color:var(--accent)]"
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {[-90, -45, 45, 90].map((d) => (
                    <button
                      key={d}
                      onClick={() => patchSelected({ rot: norm180(selRot + d) })}
                      className="rounded-lg border border-[color:var(--line)] px-2 py-1 font-mono text-xs transition hover:border-[color:var(--accent)]"
                    >
                      {d > 0 ? `+${d}` : d}°
                    </button>
                  ))}
                  <button
                    onClick={() => patchSelected({ rot: null })}
                    disabled={sel.rot == null}
                    className="rounded-lg border border-[color:var(--line)] px-2 py-1 text-xs transition hover:border-[color:var(--accent)] disabled:opacity-40"
                  >
                    Auto
                  </button>
                </div>
              </div>
              <button
                onClick={removeSelected}
                className="w-full rounded-xl border border-[color:var(--line)] px-3 py-2 text-sm text-[color:var(--danger)] transition hover:border-[color:var(--danger)]"
              >
                Remove table
              </button>
            </>
          )}
        </Card>

        <Card title="Room">
          <dl className="space-y-1 text-sm">
            {counts.map((c) => (
              <div key={c.kind} className="flex justify-between gap-3">
                <dt className="text-[color:var(--muted)]">
                  {KIND_META[c.kind].name}s
                </dt>
                <dd className="font-medium">
                  {c.tables} · {c.seats} seats
                </dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-[color:var(--line)] pt-1">
              <dt className="text-[color:var(--muted)]">Total</dt>
              <dd className="font-semibold">
                {specs.length} · {layout.seats.length} seats
              </dd>
            </div>
          </dl>
          <button
            onClick={() => {
              setSpecs((cur) => fitSpecsToRoom(cur));
              setMsg("Layout re-centred in the room.");
            }}
            className="mt-3 w-full rounded-xl border border-[color:var(--line)] px-3 py-2 text-sm transition hover:border-[color:var(--accent)]"
          >
            Fit to room
          </button>
        </Card>

        <div className="space-y-2">
          <button
            onClick={save}
            disabled={busy || !dirty || clashes}
            className="w-full rounded-xl bg-[color:var(--accent)] px-4 py-2.5 text-sm font-semibold text-[color:var(--accent-ink)] transition disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy
              ? "Working…"
              : clashes
                ? "Fix duplicate numbers"
                : dirty
                  ? "Save layout"
                  : "Saved"}
          </button>
          <button
            onClick={() => {
              setSpecs(saved);
              setSelected(null);
              setMsg("Reverted to the last save.");
            }}
            disabled={busy || !dirty}
            className="w-full rounded-xl border border-[color:var(--line)] px-3 py-2 text-sm transition hover:border-[color:var(--accent)] disabled:opacity-40"
          >
            Discard changes
          </button>
          <button
            onClick={resetToDefault}
            disabled={busy}
            className="w-full rounded-xl border border-[color:var(--line)] px-3 py-2 text-sm text-[color:var(--danger)] transition hover:border-[color:var(--danger)] disabled:opacity-40"
          >
            Reset to original room
          </button>
        </div>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------- bits */

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-wide text-[color:var(--muted)]">
        {label}
      </span>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.round(n * 10) / 10);
        }}
        className="w-full rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] px-2 py-1.5 font-mono text-sm outline-none focus:border-[color:var(--accent)]"
      />
    </label>
  );
}
