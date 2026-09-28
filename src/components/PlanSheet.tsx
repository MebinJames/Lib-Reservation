"use client";

import type { ReactNode } from "react";

import { IN, SHEET, U_PER_M, WALL } from "@/lib/floorplan";

/**
 * The drawing sheet everything else sits on: border, title block, north
 * arrow, floor, setting-out grid, wall poché, dimension strings and scale
 * bar. Both the booking plan and the admin editor render inside it, so the
 * two views stay the same drawing.
 */

const MID = {
  x: IN.x0 - WALL / 2,
  y: IN.y0 - WALL / 2,
  w: IN.x1 - IN.x0 + WALL,
  h: IN.y1 - IN.y0 + WALL,
};

const metres = (units: number) => (units / U_PER_M).toFixed(2);
const AREA = ((IN.x1 - IN.x0) * (IN.y1 - IN.y0)) / (U_PER_M * U_PER_M);

export default function PlanSheet({
  title,
  subtitle,
  children,
  onBackdropClick,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  /** admin editor uses this to clear the selection */
  onBackdropClick?: () => void;
}) {
  return (
    <svg
      viewBox={`0 0 ${SHEET.w} ${SHEET.h}`}
      className="h-auto w-full select-none"
      role="group"
      aria-label={title}
      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
    >
      <rect
        x={0}
        y={0}
        width={SHEET.w}
        height={SHEET.h}
        fill="var(--plan-bg)"
        onClick={onBackdropClick}
      />

      {/* sheet border */}
      <rect
        x={28}
        y={28}
        width={SHEET.w - 56}
        height={SHEET.h - 56}
        fill="none"
        stroke="var(--plan-dim)"
        strokeWidth={1.5}
        opacity={0.5}
      />

      {/* title block */}
      <g fill="var(--plan-ink)" pointerEvents="none">
        <text x={60} y={72} fontSize={30} fontWeight={700} letterSpacing={3}>
          {title}
        </text>
        <text x={60} y={98} fontSize={15} letterSpacing={2.5} fill="var(--plan-dim)">
          {subtitle}
        </text>
      </g>

      {/* north arrow */}
      <g transform={`translate(${SHEET.w - 96} 84)`} pointerEvents="none">
        <circle r={30} fill="none" stroke="var(--plan-dim)" strokeWidth={1.5} opacity={0.7} />
        <path d="M 0 -22 L 8 8 L 0 1 L -8 8 Z" fill="var(--plan-ink)" />
        <text
          y={-34}
          fontSize={14}
          fontWeight={700}
          textAnchor="middle"
          fill="var(--plan-ink)"
          letterSpacing={1}
        >
          N
        </text>
      </g>

      {/* floor and 1 m setting-out grid, clipped inside the walls */}
      <defs>
        <clipPath id="room-clip">
          <rect x={IN.x0} y={IN.y0} width={IN.x1 - IN.x0} height={IN.y1 - IN.y0} />
        </clipPath>
      </defs>
      <g clipPath="url(#room-clip)">
        <rect
          x={IN.x0}
          y={IN.y0}
          width={IN.x1 - IN.x0}
          height={IN.y1 - IN.y0}
          fill="var(--plan-floor)"
          onClick={onBackdropClick}
        />
        <g stroke="var(--plan-grid)" strokeWidth={1} pointerEvents="none">
          {Array.from(
            { length: Math.round((IN.x1 - IN.x0) / U_PER_M) + 1 },
            (_, i) => IN.x0 + i * U_PER_M,
          ).map((x) => (
            <line key={`v${x}`} x1={x} y1={IN.y0} x2={x} y2={IN.y1} />
          ))}
          {Array.from(
            { length: Math.round((IN.y1 - IN.y0) / U_PER_M) + 1 },
            (_, i) => IN.y0 + i * U_PER_M,
          ).map((y) => (
            <line key={`h${y}`} x1={IN.x0} y1={y} x2={IN.x1} y2={y} />
          ))}
        </g>
      </g>

      {/* walls, stroked along the centre-line so the band reads as poché */}
      <rect
        x={MID.x}
        y={MID.y}
        width={MID.w}
        height={MID.h}
        fill="none"
        stroke="var(--plan-wall)"
        strokeWidth={WALL}
        pointerEvents="none"
      />

      {/* the furniture */}
      {children}

      {/* dimension strings */}
      <g pointerEvents="none">
        <Dimension
          x1={IN.x0}
          y1={IN.y1 + 80}
          x2={IN.x1}
          y2={IN.y1 + 80}
          from={{ x: IN.x0, y: IN.y1 }}
          to={{ x: IN.x1, y: IN.y1 }}
          label={`${metres(IN.x1 - IN.x0)} m`}
        />
        <Dimension
          x1={IN.x0 - 96}
          y1={IN.y0}
          x2={IN.x0 - 96}
          y2={IN.y1}
          from={{ x: IN.x0, y: IN.y0 }}
          to={{ x: IN.x0, y: IN.y1 }}
          label={`${metres(IN.y1 - IN.y0)} m`}
          vertical
        />
      </g>

      {/* scale bar */}
      <g transform={`translate(${IN.x1 - 4 * U_PER_M} ${SHEET.h - 74})`} pointerEvents="none">
        {[0, 1, 2, 3].map((i) => (
          <rect
            key={i}
            x={i * U_PER_M}
            y={0}
            width={U_PER_M}
            height={11}
            fill={i % 2 ? "var(--plan-bg)" : "var(--plan-ink)"}
            stroke="var(--plan-ink)"
            strokeWidth={1.2}
          />
        ))}
        {[0, 2, 4].map((m) => (
          <text
            key={m}
            x={m * U_PER_M}
            y={32}
            fontSize={13}
            textAnchor="middle"
            fill="var(--plan-dim)"
          >
            {m}
          </text>
        ))}
        <text
          x={4 * U_PER_M}
          y={-9}
          fontSize={13}
          textAnchor="end"
          fill="var(--plan-dim)"
          letterSpacing={1.5}
        >
          METRES
        </text>
      </g>
      <text
        x={60}
        y={SHEET.h - 52}
        fontSize={13}
        fill="var(--plan-dim)"
        letterSpacing={1.5}
        pointerEvents="none"
      >
        AREA {AREA.toFixed(0)} m² · GRID 1.00 m
      </text>
    </svg>
  );
}

/**
 * An architectural dimension string: extension lines back to the thing being
 * measured, a run between 45° ticks, and the distance sitting on the line.
 */
function Dimension({
  x1,
  y1,
  x2,
  y2,
  from,
  to,
  label,
  vertical = false,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  label: string;
  vertical?: boolean;
}) {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return (
    <g stroke="var(--plan-dim)" strokeWidth={1.2} fill="none">
      <line x1={from.x} y1={from.y} x2={x1} y2={y1} opacity={0.55} />
      <line x1={to.x} y1={to.y} x2={x2} y2={y2} opacity={0.55} />
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      <line x1={x1 - 6} y1={y1 - 6} x2={x1 + 6} y2={y1 + 6} strokeWidth={1.6} />
      <line x1={x2 - 6} y1={y2 - 6} x2={x2 + 6} y2={y2 + 6} strokeWidth={1.6} />
      <text
        x={vertical ? mx - 10 : mx}
        y={vertical ? my : my - 12}
        fontSize={16}
        letterSpacing={1}
        textAnchor="middle"
        stroke="none"
        fill="var(--plan-ink)"
        transform={vertical ? `rotate(-90 ${mx - 10} ${my})` : undefined}
      >
        {label}
      </text>
    </g>
  );
}
