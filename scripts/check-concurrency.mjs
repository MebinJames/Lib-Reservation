/**
 * Proves the booking rules hold under genuinely simultaneous requests.
 *
 *   npm run check:concurrency
 *
 * Needs SUPABASE_SECRET_KEY in .env.local. Creates throwaway @mgits.ac.in
 * fixture users, fires simultaneous inserts through the same client library
 * the app uses, checks what landed, and removes everything it created — even
 * when a check fails.
 *
 * It inserts directly instead of calling create(), because create() also
 * checks the seat exists in the saved layout and these fixture seats don't.
 * The INSERT is the same statement, and that statement is where the database
 * enforces the rules.
 *
 * A pass requires the requests to have actually overlapped. Firing requests
 * "in parallel" that the transport quietly serialises proves nothing, so the
 * script measures overlap and fails outright if there was none.
 */

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL || !KEY) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.");
  process.exit(2);
}

const sb = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TAG = "concurrency-check";
const SEAT_RACERS = 25;
const QUOTA_ATTEMPTS = 10;

// The quota trigger counts from today in Asia/Kolkata, so book tomorrow there.
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const tomorrow = new Date(`${today}T00:00:00Z`);
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
const DATE = tomorrow.toISOString().slice(0, 10);

const created = [];
let failed = false;

const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failed = true;
};

/** Most requests that were in flight at the same instant. */
function maxInFlight(spans) {
  const edges = spans
    .flatMap(({ t0, t1 }) => [[t0, 1], [t1, -1]])
    // at a tie, an end sorts before a start, so touching spans don't count
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let now = 0;
  let most = 0;
  for (const [, step] of edges) most = Math.max(most, (now += step));
  return most;
}

async function attempt(row) {
  const t0 = performance.now();
  const { error } = await sb.from("reservations").insert(row);
  return {
    t0,
    t1: performance.now(),
    code: error?.code ?? null,
    message: error?.message ?? null,
  };
}

/**
 * Every outcome, counted. Checking only for the codes you expect lets an
 * unexpected failure pass unnoticed while the totals quietly stop adding up.
 */
function report(results) {
  const tally = new Map();
  for (const r of results) {
    const key = r.code ?? "booked";
    if (!tally.has(key)) tally.set(key, { n: 0, message: r.message });
    tally.get(key).n++;
  }
  for (const [key, { n, message }] of [...tally].sort((a, b) => b[1].n - a[1].n))
    console.log(`    ${String(n).padStart(3)} x ${key}${message ? `  ${message.slice(0, 90)}` : ""}`);
}

async function fixtureStudent(n) {
  const email = `${TAG}-${String(n).padStart(2, "0")}@mgits.ac.in`;
  const { data, error } = await sb.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw new Error(`could not create ${email}: ${error.message}`);
  created.push(data.user.id);
  // Booking requires a completed registration.
  const { error: reg } = await sb
    .from("profiles")
    .update({ registered_at: new Date().toISOString(), full_name: "Concurrency fixture" })
    .eq("id", data.user.id);
  if (reg) throw new Error(`could not register ${email}: ${reg.message}`);
  return data.user.id;
}

async function cleanUp() {
  await sb.from("reservations").delete().like("seat_id", `${TAG}%`);
  // Includes leftovers from an earlier run that crashed before cleaning up.
  const { data } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const ids = new Set(created);
  for (const u of data?.users ?? []) if (u.email?.startsWith(`${TAG}-`)) ids.add(u.id);
  for (const id of ids) await sb.auth.admin.deleteUser(id);
}

try {
  await cleanUp();

  const { data: rules } = await sb.from("settings").select("value").eq("key", "maxPerStudent");
  const quota = Number(rules?.[0]?.value ?? 3);

  console.log(`Creating ${SEAT_RACERS} fixture students…`);
  const students = [];
  for (let i = 1; i <= SEAT_RACERS; i++) students.push(await fixtureStudent(i));

  // ------------------------------------------ many students, one seat
  const seat = `${TAG}-seat:0`;
  const race = await Promise.all(
    students.map((id) =>
      attempt({ seat_id: seat, date: DATE, start_slot: 4, end_slot: 8, student_id: id }),
    ),
  );
  const seatOverlap = maxInFlight(race);
  const { count: seatRows } = await sb
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("seat_id", seat);

  console.log(`\n${SEAT_RACERS} students, one seat — up to ${seatOverlap} requests in flight at once`);
  report(race);
  check(seatOverlap > 1, "requests genuinely overlapped");
  check(race.filter((r) => r.code === null).length === 1, "exactly one request succeeded");
  check(race.filter((r) => r.code === "23P01").length === SEAT_RACERS - 1, "every other one hit the exclusion constraint");
  check(seatRows === 1, `exactly one row in the table (found ${seatRows})`);

  // ------------------------------------------ one student, many seats
  // A student who took no part in the seat race. Reusing a racer would let the
  // seat they just won count against this quota and overlap these slots, which
  // looks exactly like a broken quota.
  const greedy = await fixtureStudent(SEAT_RACERS + 1);
  const grab = await Promise.all(
    Array.from({ length: QUOTA_ATTEMPTS }, (_, i) =>
      attempt({
        seat_id: `${TAG}-quota-${i}:0`,
        date: DATE,
        start_slot: i,
        end_slot: i + 1,
        student_id: greedy,
      }),
    ),
  );
  const quotaOverlap = maxInFlight(grab);
  const { count: heldRows } = await sb
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("student_id", greedy)
    .like("seat_id", `${TAG}-quota-%`);

  console.log(`\n${QUOTA_ATTEMPTS} seats for one student, quota ${quota} — up to ${quotaOverlap} requests in flight at once`);
  report(grab);
  check(quotaOverlap > 1, "requests genuinely overlapped");
  check(grab.filter((r) => r.code === null).length === quota, `exactly ${quota} succeeded`);
  check(grab.filter((r) => r.code === "LR001").length === QUOTA_ATTEMPTS - quota, "every other one hit the quota");
  check(heldRows === quota, `exactly ${quota} rows in the table (found ${heldRows})`);
} catch (err) {
  failed = true;
  console.error("\nThe check could not run:", err.message ?? err);
} finally {
  await cleanUp();
  console.log("\nFixtures removed.");
}

process.exit(failed ? 1 : 0);
