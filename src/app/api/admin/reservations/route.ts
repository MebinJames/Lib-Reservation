import { NextResponse } from "next/server";

import { AdminError, requireAdmin } from "@/lib/admin";
import { buildLayout } from "@/lib/floorplan";
import { loadSpecs } from "@/lib/room";
import { isValidDateKey, libraryDateKey } from "@/lib/slots";
import { listRange } from "@/lib/store";
import {
  ConfigError,
  rejectedCredentials,
  serviceClient,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const DEFAULT_AHEAD_DAYS = 90;

/**
 * GET /api/admin/reservations?from=&to=&q=
 *
 * Defaults to everything from today onwards, which is what the previous
 * version returned. Pass an earlier `from` to look backwards.
 */
export async function GET(req: Request) {
  try {
    await requireAdmin();
    const sb = serviceClient();
    const { searchParams } = new URL(req.url);

    const rawFrom = searchParams.get("from");
    const rawTo = searchParams.get("to");
    const from = isValidDateKey(rawFrom) ? rawFrom : libraryDateKey();
    const to = isValidDateKey(rawTo)
      ? rawTo
      : libraryDateKey(new Date(), DEFAULT_AHEAD_DAYS);
    const q = (searchParams.get("q") ?? "").trim().toLowerCase();

    const [rows, specs] = await Promise.all([
      listRange(sb, from, to),
      loadSpecs(sb),
    ]);

    const { seats } = buildLayout(specs);
    const labels = new Map(seats.map((s) => [s.id, s.label]));
    const live = new Set(seats.map((s) => s.id));

    // Searching covers the seat's label as well as its id, because the label
    // is the only one of the two an admin ever sees on screen.
    const reservations = q
      ? rows.filter((r) =>
          `${r.name} ${r.studentId} ${labels.get(r.seatId) ?? ""} ${r.seatId}`
            .toLowerCase()
            .includes(q),
        )
      : rows;

    return NextResponse.json({
      reservations,
      orphanedIds: reservations
        .filter((r) => !live.has(r.seatId))
        .map((r) => r.id),
      // Only the seats actually in the results: a booking row carries a seat
      // id, and "R5 · seat 2" is the only form of it worth showing an admin.
      labels: Object.fromEntries(
        reservations
          .map((r) => [r.seatId, labels.get(r.seatId) ?? r.seatId] as const)
          .filter(([, label]) => label),
      ),
      range: { from, to },
    });
  } catch (err) {
    if (err instanceof AdminError || err instanceof ConfigError)
      return NextResponse.json({ error: err.message }, { status: err.status });
    const rejected = rejectedCredentials(err);
    if (rejected)
      return NextResponse.json(
        { error: rejected.message },
        { status: rejected.status },
      );
    console.error("admin/reservations failed:", err);
    return NextResponse.json(
      { error: "Could not load reservations." },
      { status: 500 },
    );
  }
}
