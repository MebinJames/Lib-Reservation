/**
 * Floor-plan geometry.
 *
 * The room's contents are just a list of tables — kind and position — held in
 * the database and editable from /admin. Everything else is derived here:
 * chair positions, table rotation, display numbering, and the transform that
 * fits the furniture inside the walls. Nothing about the layout is hard-coded
 * except DEFAULT_LAYOUT, which seeds an empty database.
 *
 * Coordinates are final drawing coordinates, so what the editor stores is
 * exactly what gets drawn.
 */

export type TableKind = "round" | "square" | "computer";

/** A row of the layout table: what the admin actually edits. */
export interface TableSpec {
  /** stable id — reservations hang off this, so renumbering can't orphan them */
  id: string;
  kind: TableKind;
  x: number;
  y: number;
  /**
   * Display number, as in the "3" of S3. Null/undefined means "take the next
   * free one by position". Pinning a number reserves it; the tables left on
   * auto number around it.
   */
  num?: number | null;
  /**
   * How many people sit here. Null/undefined means the type's usual number:
   * 2 at a round table, 4 at a study table. Computer stations are always 1.
   */
  seats?: number | null;
  /**
   * Degrees. Null/undefined means "face wherever this position implies" —
   * study tables turn their long axis to the fan centre, computer desks follow
   * their ring, round tables sit level. Set it to override that.
   */
  rot?: number | null;
}

/* ------------------------------------------------------------------ sheet */
/* 80 units = 1 metre. The sheet is larger than the room so dimension
   strings, the title and the scale bar get their own margin. */
export const SHEET = { w: 1720, h: 1280 } as const;
export const U_PER_M = 80;
export const WALL = 22;
/** Inner face of the walls — the clear span that gets dimensioned. */
export const IN = { x0: 182, y0: 152, x1: 1622, y1: 1032 } as const;
/** Furniture keeps this much clear of every wall. */
const MARGIN = 55;

/** The point below the room that the whole arrangement fans around. */
export const FAN = { x: 756, y: 960 } as const;

const rad = (d: number) => (d * Math.PI) / 180;
const onCircle = (cx: number, cy: number, r: number, a: number) => ({
  x: cx + r * Math.cos(rad(a)),
  y: cy + r * Math.sin(rad(a)),
});

export interface Seat {
  id: string;
  tableId: string;
  kind: TableKind;
  label: string;
  x: number;
  y: number;
  /** degrees; 0 means the chair back faces "up" */
  rot: number;
}

export interface Table {
  /** stable id, matching the spec it came from */
  id: string;
  /** display id: R1, S3, C11 */
  code: string;
  /** the numeric part of the code */
  num: number;
  /** true when the number came from position rather than being pinned */
  autoNum: boolean;
  kind: TableKind;
  label: string;
  capacity: number;
  x: number;
  y: number;
  rot: number;
  /** round */
  r?: number;
  /** square */
  w?: number;
  h?: number;
  /** computer: annular-sector path, drawn at its natural angle */
  path?: string;
  /** degrees to spin the drawn shape about (x, y) — non-zero only when the
      table's rotation has been overridden */
  spin: number;
  /** true when rot came from the position rather than from an override */
  autoRot: boolean;
}

export interface Layout {
  tables: Table[];
  seats: Seat[];
  /** fits the furniture block inside the walls with an even margin */
  fit: { scale: number; tx: number; ty: number };
}

/* --------------------------------------------------------------- shapes */

export const ROUND_R = 36;
const ROUND_SEAT_R = 52;
export const SQ_W = 150;
export const SQ_H = 78;
const SQ_SEAT_OFF = 19;
/** computer desks: a band this deep, centred on the table's own radius */
const DESK_DEPTH = 70;
const DESK_HALF_ANGLE = 4.4;
const DESK_SEAT_IN = 59;

export const CHAIR_W = 30;
export const CHAIR_H = 24;

/** A table can seat between this many people. */
export const MIN_SEATS = 1;
export const MAX_SEATS = 12;
/** Highest display number a table may be pinned to. */
export const MAX_TABLE_NUMBER = 999;

/** A pinned display number, or null when this table numbers itself. */
export function pinnedNumber(spec: { num?: number | null }): number | null {
  if (spec.num === null || spec.num === undefined) return null;
  const n = Number(spec.num);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  return i >= 1 && i <= MAX_TABLE_NUMBER ? i : null;
}
/** Computer stations are one machine, one chair — not adjustable. */
export const seatsAdjustable = (kind: TableKind) => kind !== "computer";

/** How many seats a table actually has, honouring any override. */
export function seatCount(spec: {
  kind: TableKind;
  seats?: number | null;
}): number {
  if (!seatsAdjustable(spec.kind)) return 1;
  // Explicit null/undefined check: Number(null) is 0, which is finite, so a
  // truthiness test here would quietly turn every default into one seat.
  if (spec.seats === null || spec.seats === undefined)
    return KIND_META[spec.kind].capacity;
  const n = Number(spec.seats);
  if (!Number.isFinite(n)) return KIND_META[spec.kind].capacity;
  return Math.min(MAX_SEATS, Math.max(MIN_SEATS, Math.round(n)));
}

/** Chairs need this much room side by side before they start touching. */
const CHAIR_PITCH = CHAIR_W + 6;

/**
 * A table with more seats is a bigger table. These grow only when the default
 * size would crowd the chairs, so the standard 2- and 4-seaters are untouched.
 */
export const roundSeatRadius = (n: number) =>
  Math.max(ROUND_SEAT_R, (n * CHAIR_PITCH) / (2 * Math.PI));
export const roundTableRadius = (n: number) =>
  roundSeatRadius(n) - (ROUND_SEAT_R - ROUND_R);
export const squareWidth = (n: number) =>
  Math.max(SQ_W, Math.ceil(n / 2) * CHAIR_PITCH);

export const KIND_META: Record<
  TableKind,
  { name: string; blurb: string; capacity: number; letter: string }
> = {
  round: { name: "Round table", blurb: "2 seats, one each side", capacity: 2, letter: "R" },
  square: { name: "Study table", blurb: "4 seats, two per side", capacity: 4, letter: "S" },
  computer: { name: "Computer station", blurb: "Single seat", capacity: 1, letter: "C" },
};

function annularSector(r0: number, r1: number, a0: number, a1: number) {
  const o0 = onCircle(FAN.x, FAN.y, r1, a0);
  const o1 = onCircle(FAN.x, FAN.y, r1, a1);
  const i1 = onCircle(FAN.x, FAN.y, r0, a1);
  const i0 = onCircle(FAN.x, FAN.y, r0, a0);
  return [
    `M ${o0.x.toFixed(2)} ${o0.y.toFixed(2)}`,
    `A ${r1} ${r1} 0 0 1 ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}`,
    `L ${i1.x.toFixed(2)} ${i1.y.toFixed(2)}`,
    `A ${r0} ${r0} 0 0 0 ${i0.x.toFixed(2)} ${i0.y.toFixed(2)}`,
    "Z",
  ].join(" ");
}

/**
 * The angle a table takes when nothing overrides it: study tables aim their
 * long axis at the fan centre, computer desks sit tangent to their own ring,
 * round tables stay level so their two chairs are left and right.
 */
export function autoRotation(kind: TableKind, x: number, y: number): number {
  if (kind === "round") return 0;
  const a = (Math.atan2(FAN.y - y, FAN.x - x) * 180) / Math.PI;
  return norm180(kind === "square" ? a : a + 90);
}

/** Degrees folded into (-180, 180], so overrides read sensibly in the editor. */
export function norm180(deg: number) {
  const d = ((deg % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

/** Rotate a point about a centre. */
function spinPoint(x: number, y: number, cx: number, cy: number, deg: number) {
  if (!deg) return { x, y };
  const c = Math.cos(rad(deg));
  const s = Math.sin(rad(deg));
  const dx = x - cx;
  const dy = y - cy;
  return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
}

/* ---------------------------------------------------------------- build */

/** Right to left, then top to bottom for anything sharing a column. */
const byPosition = <T extends { x: number; y: number }>(list: T[]) =>
  [...list].sort((a, b) => b.x - a.x || a.y - b.y);

export function buildLayout(specs: TableSpec[]): Layout {
  const tables: Table[] = [];
  const seats: Seat[] = [];

  for (const kind of ["round", "square", "computer"] as const) {
    const meta = KIND_META[kind];
    const ofKind = byPosition(specs.filter((s) => s.kind === kind));

    // Pinned numbers are reserved first; everything else takes the lowest
    // number still free, working right to left across the room.
    const taken = new Set<number>();
    for (const s of ofKind) {
      const pinned = pinnedNumber(s);
      if (pinned !== null) taken.add(pinned);
    }
    let next = 1;
    const numberFor = (s: TableSpec) => {
      const pinned = pinnedNumber(s);
      if (pinned !== null) return pinned;
      while (taken.has(next)) next += 1;
      taken.add(next);
      return next;
    };

    ofKind.forEach((spec) => {
      const num = numberFor(spec);
      const autoNum = pinnedNumber(spec) === null;
      const code = `${meta.letter}${num}`;
      const label = `${meta.name} ${num}`;

      // Everything below is built at the table's natural angle; an override is
      // then applied as a rigid spin about the table's own centre, so the
      // chairs keep their relationship to the top.
      const auto = autoRotation(kind, spec.x, spec.y);
      const hasOverride = typeof spec.rot === "number" && Number.isFinite(spec.rot);
      const finalRot = hasOverride ? (spec.rot as number) : auto;
      const spin = finalRot - auto;

      const seat = (n: number, x: number, y: number, rot: number, suffix: string) => {
        const p = spinPoint(x, y, spec.x, spec.y, spin);
        seats.push({
          id: `${spec.id}:${n}`,
          tableId: spec.id,
          kind,
          label: meta.capacity === 1 ? code : `${code} · seat ${suffix}`,
          x: p.x,
          y: p.y,
          rot: rot + spin,
        });
      };
      const base = { id: spec.id, code, num, autoNum, kind, label, spin, autoRot: !hasOverride };

      const capacity = seatCount(spec);

      if (kind === "round") {
        const seatR = roundSeatRadius(capacity);
        tables.push({
          ...base,
          capacity,
          x: spec.x,
          y: spec.y,
          rot: finalRot,
          r: roundTableRadius(capacity),
        });
        // Spread evenly round the table, starting on the left — so the usual
        // pair still comes out as one seat left and one right.
        for (let i = 0; i < capacity; i += 1) {
          const a = 180 + (360 * i) / capacity;
          const p = onCircle(spec.x, spec.y, seatR, a);
          seat(i + 1, p.x, p.y, a + 90, String.fromCharCode(65 + i));
        }
      } else if (kind === "square") {
        const rot = auto;
        const w = squareWidth(capacity);
        tables.push({ ...base, capacity, x: spec.x, y: spec.y, rot: finalRot, w, h: SQ_H });
        const c = Math.cos(rad(rot));
        const s = Math.sin(rad(rot));
        // Split between the two long edges, the far side taking the odd one.
        const perSide: [number, number][] = [
          [-(SQ_H / 2 + SQ_SEAT_OFF), Math.ceil(capacity / 2)],
          [SQ_H / 2 + SQ_SEAT_OFF, Math.floor(capacity / 2)],
        ];
        let n = 0;
        for (const [ly, k] of perSide) {
          for (let j = 0; j < k; j += 1) {
            // (j + 0.5) / k keeps the default pair at the familiar +/- W/4.
            const lx = w * ((j + 0.5) / k - 0.5);
            n += 1;
            seat(
              n,
              spec.x + lx * c - ly * s,
              spec.y + lx * s + ly * c,
              rot + (ly < 0 ? 0 : 180),
              String(n),
            );
          }
        }
      } else {
        // A computer desk is a slice of the ring it happens to sit on, so its
        // curve follows from its position rather than a fixed arc definition.
        const dx = spec.x - FAN.x;
        const dy = spec.y - FAN.y;
        const radius = Math.hypot(dx, dy) || 1;
        const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        tables.push({
          ...base,
          capacity,
          x: spec.x,
          y: spec.y,
          rot: finalRot,
          path: annularSector(
            radius - DESK_DEPTH / 2,
            radius + DESK_DEPTH / 2,
            angle - DESK_HALF_ANGLE,
            angle + DESK_HALF_ANGLE,
          ),
        });
        const p = onCircle(FAN.x, FAN.y, radius - DESK_SEAT_IN, angle);
        seat(1, p.x, p.y, angle - 90, "A");
      }
    });
  }

  return { tables, seats, fit: PLAN_FIT };
}

/* ------------------------------------------------------------------ fit */

/**
 * Fixed transform from layout coordinates to sheet coordinates.
 *
 * Deliberately constant rather than recomputed per layout: the admin editor
 * drags tables through this same transform, and a fit that changed as you
 * dragged would shift the furniture out from under the cursor. When a layout
 * does drift out of frame, `fitSpecsToRoom` re-centres it on request.
 */
export const PLAN_FIT = { scale: 0.905, tx: 147.5, ty: 182.7 } as const;

/** Bounding box of the furniture, in layout coordinates. */
export function furnitureBounds(tables: Table[], seats: Seat[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const eat = (x: number, y: number) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };

  // chair body plus the back bar: half-extents 15 across, -20..+12 along
  for (const s of seats) {
    const c = Math.cos(rad(s.rot)), si = Math.sin(rad(s.rot));
    for (const [lx, ly] of [[-15, -20], [15, -20], [15, 12], [-15, 12]] as const)
      eat(s.x + lx * c - ly * si, s.y + lx * si + ly * c);
  }
  for (const t of tables) {
    if (t.kind === "round") { eat(t.x - ROUND_R, t.y - ROUND_R); eat(t.x + ROUND_R, t.y + ROUND_R); }
    else if (t.kind === "square") {
      const c = Math.cos(rad(t.rot)), si = Math.sin(rad(t.rot));
      for (const [lx, ly] of [[-SQ_W / 2, -SQ_H / 2], [SQ_W / 2, -SQ_H / 2], [SQ_W / 2, SQ_H / 2], [-SQ_W / 2, SQ_H / 2]] as const)
        eat(t.x + lx * c - ly * si, t.y + lx * si + ly * c);
    } else {
      const dx = t.x - FAN.x, dy = t.y - FAN.y;
      const radius = Math.hypot(dx, dy) || 1;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      for (let a = angle - DESK_HALF_ANGLE; a <= angle + DESK_HALF_ANGLE; a += 1)
        for (const r of [radius - DESK_DEPTH / 2, radius + DESK_DEPTH / 2]) {
          const p = onCircle(FAN.x, FAN.y, r, a);
          eat(p.x, p.y);
        }
    }
  }

  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Rescales and re-centres a layout so it sits neatly inside the walls under
 * PLAN_FIT. Used by the admin editor's "Fit to room" action — an explicit
 * step, never something that happens mid-drag.
 */
export function fitSpecsToRoom(specs: TableSpec[]): TableSpec[] {
  const { tables, seats } = buildLayout(specs);
  const b = furnitureBounds(tables, seats);
  if (!b) return specs;

  // The window in layout coordinates that maps onto the room, inset by MARGIN.
  const { scale, tx, ty } = PLAN_FIT;
  const wx0 = (IN.x0 + MARGIN - tx) / scale;
  const wx1 = (IN.x1 - MARGIN - tx) / scale;
  const wy0 = (IN.y0 + MARGIN - ty) / scale;
  const wy1 = (IN.y1 - MARGIN - ty) / scale;

  const w = Math.max(b.maxX - b.minX, 1);
  const h = Math.max(b.maxY - b.minY, 1);
  const k = Math.min((wx1 - wx0) / w, (wy1 - wy0) / h);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const dx = (wx0 + wx1) / 2;
  const dy = (wy0 + wy1) / 2;

  return specs.map((t) => ({
    ...t,
    x: Math.round((dx + (t.x - cx) * k) * 10) / 10,
    y: Math.round((dy + (t.y - cy) * k) * 10) / 10,
  }));
}

/* --------------------------------------------------------------- default */

/** Seeds an empty database. After that the layout lives in the DB. */
export const DEFAULT_LAYOUT: { kind: TableKind; x: number; y: number }[] = [
  { kind: "round", x: 1480.5, y: 836.1 },
  { kind: "round", x: 1459.5, y: 410.9 },
  { kind: "round", x: 1326.2, y: 273.3 },
  { kind: "round", x: 1167.6, y: 168.3 },
  { kind: "round", x: 989.1, y: 99 },
  { kind: "round", x: 800.1, y: 68.5 },
  { kind: "round", x: 610.1, y: 79 },
  { kind: "round", x: 426.3, y: 130.5 },
  { kind: "round", x: 257.3, y: 219.8 },
  { kind: "round", x: 186.9, y: 495.9 },
  { kind: "square", x: 1421.7, y: 648.2 },
  { kind: "square", x: 1289.4, y: 453.9 },
  { kind: "square", x: 1138.2, y: 296.4 },
  { kind: "square", x: 919.8, y: 233.4 },
  { kind: "square", x: 714, y: 229.2 },
  { kind: "square", x: 515.6, y: 269.1 },
  { kind: "square", x: 327.6, y: 363.6 },
  { kind: "computer", x: 1177.4, y: 763.5 },
  { kind: "computer", x: 1136.9, y: 693.3 },
  { kind: "computer", x: 1084.8, y: 631.2 },
  { kind: "computer", x: 1022.7, y: 579.1 },
  { kind: "computer", x: 952.5, y: 538.6 },
  { kind: "computer", x: 876.4, y: 510.8 },
  { kind: "computer", x: 635.6, y: 510.8 },
  { kind: "computer", x: 559.5, y: 538.6 },
  { kind: "computer", x: 489.3, y: 579.1 },
  { kind: "computer", x: 427.2, y: 631.2 },
  { kind: "computer", x: 375.1, y: 693.3 },
  { kind: "computer", x: 334.6, y: 763.5 },
];
