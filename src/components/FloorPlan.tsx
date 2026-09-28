"use client";

import PlanSheet from "./PlanSheet";
import {
  CHAIR_H,
  CHAIR_W,
  type Layout,
  type TableKind,
} from "@/lib/floorplan";

export type SeatState = "available" | "booked" | "selected" | "mine";

interface Props {
  layout: Layout;
  stateOf: (seatId: string) => SeatState;
  labelOf: (seatId: string) => string;
  onSelect: (seatId: string) => void;
  /** null = show everything */
  filter: TableKind | null;
}

const FILL: Record<SeatState, string> = {
  available: "var(--seat-free)",
  booked: "var(--seat-taken)",
  selected: "var(--seat-active)",
  mine: "var(--seat-mine)",
};

export default function FloorPlan({
  layout,
  stateOf,
  labelOf,
  onSelect,
  filter,
}: Props) {
  const { tables, seats, fit } = layout;

  return (
    <PlanSheet
      title="READING ROOM"
      subtitle={`SEATING PLAN · ${tables.length} TABLES · ${seats.length} SEATS`}
    >
      <g transform={`translate(${fit.tx} ${fit.ty}) scale(${fit.scale})`}>
        {/* ------------------------------------------------------- tables */}
        <g
          fill="var(--table-fill)"
          stroke="var(--plan-line)"
          strokeWidth={3}
          strokeLinejoin="round"
          pointerEvents="none"
        >
          {tables.map((t) => {
            const dim = filter && t.kind !== filter ? 0.18 : 1;
            if (t.kind === "round")
              return <circle key={t.id} cx={t.x} cy={t.y} r={t.r} opacity={dim} />;
            if (t.kind === "computer")
              return (
                <path
                  key={t.id}
                  d={t.path}
                  opacity={dim}
                  transform={t.spin ? `rotate(${t.spin} ${t.x} ${t.y})` : undefined}
                />
              );
            return (
              <rect
                key={t.id}
                x={t.x - t.w! / 2}
                y={t.y - t.h! / 2}
                width={t.w}
                height={t.h}
                opacity={dim}
                transform={`rotate(${t.rot} ${t.x} ${t.y})`}
              />
            );
          })}
        </g>

        {/* table id labels */}
        <g
          fill="var(--plan-label)"
          fontSize={20}
          fontWeight={600}
          letterSpacing={1}
          textAnchor="middle"
          dominantBaseline="central"
          pointerEvents="none"
        >
          {tables.map((t) => (
            <text
              key={t.id}
              x={t.x}
              y={t.y}
              opacity={filter && t.kind !== filter ? 0.15 : 0.9}
            >
              {t.code}
            </text>
          ))}
        </g>

        {/* -------------------------------------------------------- seats */}
        <g>
          {seats.map((s) => {
            const state = stateOf(s.id);
            const dimmed = Boolean(filter && s.kind !== filter);
            const disabled = state === "booked" || dimmed;
            return (
              <g
                key={s.id}
                transform={`rotate(${s.rot} ${s.x} ${s.y})`}
                opacity={dimmed ? 0.18 : 1}
                className={disabled ? "cursor-not-allowed" : "cursor-pointer"}
                onClick={() => !disabled && onSelect(s.id)}
                role="button"
                tabIndex={disabled ? -1 : 0}
                aria-label={labelOf(s.id)}
                aria-disabled={disabled}
                onKeyDown={(e) => {
                  if (disabled) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(s.id);
                  }
                }}
              >
                <title>{labelOf(s.id)}</title>
                {/* generous invisible hit target */}
                <circle cx={s.x} cy={s.y} r={22} fill="transparent" />
                <rect
                  x={s.x - CHAIR_W / 2}
                  y={s.y - CHAIR_H / 2}
                  width={CHAIR_W}
                  height={CHAIR_H}
                  rx={6}
                  fill={FILL[state]}
                  stroke="var(--seat-edge)"
                  strokeWidth={state === "selected" ? 4 : 1.8}
                  className="transition-[fill] duration-150"
                />
                {/* seat back, so the chair reads as facing the table */}
                <rect
                  x={s.x - CHAIR_W / 2}
                  y={s.y - CHAIR_H / 2 - 4}
                  width={CHAIR_W}
                  height={5}
                  rx={2.5}
                  fill="var(--seat-edge)"
                />
              </g>
            );
          })}
        </g>
      </g>
    </PlanSheet>
  );
}
