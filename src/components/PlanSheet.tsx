"use client";

import type { ReactNode } from "react";

import { IN, SHEET, U_PER_M, WALL } from "@/lib/floorplan";

/**
 * The drawing sheet everything else sits on: border, title block, north
 * arrow, floor, setting-out grid and wall poché. Both the booking plan and
 * the admin editor render inside it, so the two views stay the same drawing.
 */

const MID = {
  x: IN.x0 - WALL / 2,
  y: IN.y0 - WALL / 2,
  w: IN.x1 - IN.x0 + WALL,
  h: IN.y1 - IN.y0 + WALL,
};

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
        rx={14}
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
    </svg>
  );
}
