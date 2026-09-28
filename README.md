# Reading Room — library seat reservations

Students pick a date and a time window, click a seat on an interactive floor
plan, and book it. Sign-in is restricted to college Google accounts.

- **[Supabase](https://supabase.com)** — Postgres, row-level security, and auth
- **[React](https://react.dev/)** — the interface
- **[Next.js](https://nextjs.org/)** — hosting, routing and the server-side API
- **[Tailwind](https://tailwindcss.com/)** — styling
- **Google Cloud OAuth**, through Supabase Auth — sign-in, college domain only

```bash
npm install
npm run dev
```

The app needs a Supabase project and a Google OAuth client before anyone can
sign in — neither can be created for you. [`docs/architecture.md`](docs/architecture.md)
explains how the three parties fit together and which redirect URL goes where;
[`supabase/README.md`](supabase/README.md) covers the schema and the two steps
that cannot be done in SQL.

Copy [`.env.example`](.env.example) to `.env.local` and fill it in.

## The room

The plan is drawn from the architect's layout, on a 1512 × 1008 canvas. Every
table fans out around a single point below the room, which is also the centre
the two computer banks curve around — that is what gives the room its radial
arrangement.

The **default** room, which seeds an empty deployment:

| Type                   | Tables | Seats each                  | Total  |
| ---------------------- | -----: | --------------------------- | -----: |
| Round table (`R1–R10`) |     10 | 2 by default, one each side |     20 |
| Study table (`S1–S7`)  |      7 | 4 by default, two per edge  |     28 |
| Computer (`C1–C12`)    |     12 | 1, always                   |     12 |
| **Total**              | **29** |                             | **60** |

The live room will differ once anyone edits it — the layout lives in the data,
not in code. `DEFAULT_LAYOUT` in [`src/lib/floorplan.ts`](src/lib/floorplan.ts)
only seeds an empty deployment.

The furniture sits on two concentric curves around the fan centre:

- **The arc** (radius ≈735) — all seven study tables plus a round table at each
  end: `R10 · S7 S6 S5 S4 S3 S2 S1 · R1`, one continuous half-curve across the
  room.
- **The outer ring** (radius ≈892) — the other eight round tables, `R2`–`R9`,
  evenly spaced 12.3° apart.

Round tables always seat one person on the left and one on the right.

**Tables are numbered right to left.** Within each kind they are sorted by
descending x before numbers are assigned, so `R1` is the rightmost round table
by default and moving a table renumbers the room. Any table's number can be
pinned in the admin editor; the rest flow around it.

A table may override its number, its seat count and its rotation. Left unset,
each is derived from the table's type and where it sits.

### Seat ids versus labels

These are deliberately different things:

- A **seat id** is `<tableId>:<n>` — the table's stable id and a 1-based seat
  index, for example `778ddc85-…:2`. This is what a booking refers to.
- A **label** is what people read, like `S7 · seat 4`. It is derived from the
  table's position and number.

Moving a table changes its label and leaves its id alone, so renumbering the
room never points an existing booking at a different chair.

Layout coordinates map onto the drawing sheet through `PLAN_FIT`, a fixed
transform. It is constant on purpose: the editor drags tables through it, and a
fit that changed while dragging would slide the furniture out from under the
cursor. "Fit to room" re-centres a layout on request instead.

## Booking rules

Enforced on the server, so they hold regardless of what the browser sends. All
of them are editable from `/admin`; the values below are the defaults:

- **Opening hours 8:00 am – 5:30 pm**, in half-hour slots (the half-hour grid is
  what lets 5:30 be a real boundary). Nothing can be booked past closing.
- A booking runs 30 minutes to 4 hours and cannot start in the past.
- The calendar is today plus 13 days.
- A seat cannot be double-booked for any overlapping half-hour.
- **One student may hold 3 seats at a time**, counting every booking from today
  onward. Cancelling frees a slot immediately.
- A student cannot hold two seats at the same time.
- A booking can only be cancelled by the account that made it.

"Today" means today in **Asia/Kolkata**, not on the server's clock — hosted in
UTC, everything between midnight and 05:30 in India would otherwise still be
answering "yesterday". `libraryDateKey()` in
[`src/lib/slots.ts`](src/lib/slots.ts) is the single place that decides this.

The seat check, the clash check and the quota check all happen inside **one
transaction**, so two simultaneous requests cannot both be told a seat is free.
This has to be verified under real concurrent load rather than assumed:
[`scripts/check-concurrency.mjs`](scripts/check-concurrency.mjs) fires
simultaneous requests and **refuses to report a pass unless it measures that
they actually overlapped** — an earlier version of that check looked like a
pass while the requests were in fact minutes apart.

## Sign-in

Booking requires a **college Google account**. Only verified addresses in the
allowed domain (default `mgits.ac.in`) can reserve a seat.

The domain test is an **equality** test on the part after the `@`, never a
suffix test, so `you@evil.mgits.ac.in` and `you@mgits.ac.in.evil.com` are both
refused. The `hd=` parameter sent to Google only pre-fills the account chooser;
it can be edited out of the URL, so it is never trusted.

Identity comes from the verified session on the server, never from the request
body, so a crafted request cannot book as somebody else. The day view reports
**which seats are taken, never by whom** — there is no route that returns
another student's bookings.

Google sends the student back to **Supabase**, and Supabase sends them on to
this app. So the authorised redirect URI registered in Google Cloud is
Supabase's, not this app's:

```
https://<project-ref>.supabase.co/auth/v1/callback
```

Registering the app's own URL there instead produces
`Error 400: redirect_uri_mismatch`. The app's URL goes in a different list —
Supabase's own **Redirect URLs**. Both, and why, are in
[`docs/architecture.md`](docs/architecture.md).

## Admin

`/admin`, deliberately **not linked from the booking page** — students have no
route to it. Five tabs:

- **Overview** — seats in use right now, bookings today and the busiest moment,
  the week ahead, headcount by role, busiest hours and most-booked seats.
  Counted fresh from existing rows, so the figures cannot drift from the
  bookings they describe.
- **Layout** — drag tables around the plan, nudge with the arrow keys (shift
  for 10), rotate with `[` and `]` (shift for 15°), add or remove tables,
  change a table's type, "Fit to room" to re-centre, save, or reset.

  Rotation is **auto by default**: study tables aim their long axis at the fan
  centre, computer desks sit tangent to their own ring, round tables stay level
  so their two chairs are left and right. Override it with the slider and the
  table becomes "manual"; the *Auto* button hands it back. An override rotates
  the table and its chairs as one rigid body.

  **A table's number** can be pinned — set `S3` and it stays `S3`. Tables still
  on auto number around it. Two tables of one type cannot claim the same
  number; the editor says so and holds the save.

  **Seats per table** is editable too — 1 to 12, or *Default* for the type's
  usual number. Round tables spread their chairs evenly, study tables split
  them between the two long edges, and both grow physically when the default
  size would crowd the chairs. Computer stations stay at one seat.

  Changing a table's type or seat count keeps its stable id, so bookings on the
  seats that remain survive. Shrinking a table drops the higher seat numbers,
  and any booking left on one is flagged under **Bookings**.
- **Booking rules** — opening hours, slot length, maximum booking, how far
  ahead the calendar runs, and seats per student. Saved rules take effect on
  the booking page immediately.
- **Bookings** — filter by date range, search by student name, address or seat,
  and cancel any booking. Bookings whose seat was deleted are flagged so they
  cannot sit unnoticed.
- **People** — everyone who has signed in, searchable, with a role of student,
  staff or admin. Every change is recorded, and the last admin cannot be
  demoted — losing it would lock everyone out with no way back.

The admin area is currently behind one shared password, set as `ADMIN_PASSWORD`
in `.env.local`. Without it the admin area refuses to open, so a deployment
cannot accidentally ship an unguarded editor. It exists only because there were
no accounts with roles when it was written; the role model now exists, and
steps 6 and 7 of [the plan](docs/plan/library-reservation.md) replace it.

## Keeping the database awake

Supabase pauses Free Plan projects after a week of low activity, and a paused
project means the booking page is down until somebody notices the email and
clicks Resume. Their documentation says a few database requests a day prevent
it, so [`vercel.json`](vercel.json) runs `/api/keepalive` daily and that route
reads one row.

It has to reach the **database** — a route that returned without querying would
keep Vercel busy and let Supabase pause anyway. The response says so:

```json
{ "ok": true, "reached": "database", "ms": 1169, "at": "2026-09-22T10:54:44.389Z" }
```

Set `CRON_SECRET` in the Vercel project and Vercel sends it as a bearer token
on cron requests; the route then refuses everyone else. Left unset, the route
stays open — it only reads one public row.

**This only helps once the app is deployed.** Until then the project pauses if
left alone for a week, and is restored with one click from the dashboard.

## Layout of the code

```
supabase/migrations/     the schema: tables, constraints, triggers, policies
src/lib/supabase/server.ts  the two clients — signed-in user, and service
src/lib/store.ts         reservations and the rules the database cannot hold
src/lib/room.ts          layout and booking-rule persistence
src/lib/profile.ts       the signed-in student's profile
src/lib/people.ts        accounts and role changes
src/lib/overview.ts      the admin statistics, counted fresh
src/lib/auth.ts          the domain rule
src/lib/admin.ts         admin password, signed cookie, route guard
src/lib/floorplan.ts     geometry: tables in, seats + numbering + drawing out
src/lib/policy.ts        the booking-rule shape, defaults and validation
src/lib/slots.ts         calendar and clock, all derived from a policy
src/lib/types.ts         shapes shared by server and browser
src/middleware.ts        keeps the signed-in session alive
src/app/api/             route handlers: reservations, auth, admin
src/components/PlanSheet.tsx     the drawing sheet both plans share
src/components/FloorPlan.tsx     the bookable plan
src/components/LayoutEditor.tsx  drag-to-edit plan for admins
src/components/Reserve.tsx       date/time controls, booking panel, cancellation
src/components/AdminClient.tsx   tabs: overview, layout, rules, bookings, people
src/components/RegisterForm.tsx  optional student details
```

`floorplan.ts`, `policy.ts`, `slots.ts` and the three plan components are pure
functions over plain data. The move from libSQL to Supabase left every one of
them untouched, which is the main reason a backend change is a contained job.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — how the pieces fit, which
  redirect URL goes where, and what enforces each rule
- [`supabase/README.md`](supabase/README.md) — the schema, and the two steps
  that cannot be done in SQL
- [`docs/plan/library-reservation.md`](docs/plan/library-reservation.md) — the
  twelve-step plan from the original app to the desired state
- [`docs/plan/step-1-auth-architecture.md`](docs/plan/step-1-auth-architecture.md)
  — why Supabase Auth, and what the domain restriction has to guarantee
