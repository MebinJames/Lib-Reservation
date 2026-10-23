# Step 2: Booking page layout and a fuller admin

> Planned 2026-10-04. Written to be carried out phase by phase by an agent
> (Sonnet 5.5) without needing the conversation that produced it. Read
> **Rules for whoever executes this** before touching anything.

Two goals:

1. **Booking page (`/`):** the floor plan and the "Book" button should be where
   a student looks, on both a laptop and a phone.
2. **Admin (`/admin`):** opening it should give a calm, readable picture of
   the room without any clicks. Everything else should be one tap away and
   should not look complicated.

No database migrations and no new npm dependencies. Every number the admin shows
can be computed from tables that already exist (`reservations`, `profiles`,
`layout_tables`, `settings`, `role_audit`).

---

## Rules for whoever executes this

These come from decisions the owner has already made. Do not reopen them.

- **Do not link `/admin` from the booking page.** The admin may link back to `/`.
- **Do not change floor-plan geometry or numbering** (`src/lib/floorplan.ts`):
  numbering runs right to left, round tables seat left and right, and the arc
  radius stays fixed. This plan only changes how the plan is *presented*.
- **`src/components/PlanSheet.tsx` and `src/lib/floorplan.ts` contain uncommitted
  edits by the owner** (dimension strings and the scale bar were removed, and
  `SHEET.h` became 1184). Keep them. Never `git checkout`/`restore` these files.
- **Keep `src/lib/` free of DOM and React code.** The project will become an
  app later, so new pure helpers go in `src/lib/`, and anything visual goes in
  `src/components/`. Do not start any app or PWA work.
- **Client components import server modules as types only** (`import type`),
  as `AdminClient.tsx` already does. `overview.ts` and `people.ts` are
  `server-only`.
- **Booking identity always comes from the session.** Do not add any client
  path that sends a student id.
- **Names are shown only under `/admin`.** The booking page and
  `/api/reservations` stay anonymous (`seat_occupancy` returns no identity).
  Every "who booked" feature in this plan reads through the admin API routes,
  which call `requireAdmin()` first.
- **Do not commit** unless the owner asks. Finish each phase with the checks in
  its **Done when** list.
- **Style:** match the existing code. Use Tailwind with the CSS variables in
  `globals.css` (`text-[color:var(--muted)]` etc.), comments that explain *why*,
  and plain-English UI copy ("Could not reach the server.", never "Error 500").

### Verifying in the browser

`.claude/launch.json` defines `lib-reservation` on port 3005. If another
session already runs it, use `navigate` to `http://localhost:3005` instead of
starting a second one. Check every phase at **1440×900, 800×600 and 375×812
(mobile preset)**, in **both light and dark** (`resize_window` `colorScheme`).

The admin is password-protected. **Ask the owner to sign in to `/admin` in the
browser pane.** Do not read the password from `.env.local` and type it in
yourself.

Static checks after every phase:

```bash
npx tsc --noEmit
```

```bash
npm run build
```

---

## What is wrong today

Observed on 2026-10-04 at 800×600 and 375×812.

**Booking page**

| # | Problem | Where |
|---|---|---|
| B1 | The date, time and filter controls fill the first screen, so the plan starts below the fold even on a laptop. | `Reserve.tsx` controls `<section>` |
| B2 | On a phone the plan scrolls sideways from its **left** edge. Because numbering runs right to left, R1–R6, S1–S5 and C1–C6 are off screen, and nothing hints that the plan scrolls. | `min-w-[760px]` wrapper |
| B3 | On a phone, the seat card and **Confirm** button sit a full screen below the plan. A student taps a seat and nothing visible happens. | `<aside>` stacks under the plan |
| B4 | Success and error messages appear at the top of the sidebar. On a phone that is off screen. | `error \|\| notice` block |
| B5 | The filter chips wrap onto three lines on a phone. | chips row |
| B6 | The sidebar is two near-empty cards most of the time ("Pick a green seat…", "Sign in to see…"). | aside |
| B7 | Dates in "Your reservations" are raw `2026-10-05`, and past bookings sit in the same list as upcoming ones. | reservations list |
| B8 | Seat states differ by colour alone, and blue (selected) vs purple (yours) is hard to tell apart with common colour-vision deficiencies. | `FloorPlan.tsx` `FILL` |
| B9 | `--muted` (#78716c) on `--bg` (#f7f5f1) is about 4.4:1, just under WCAG AA for small text. | `globals.css` |

**Admin**

| # | Problem |
|---|---|
| A1 | Every tab is capped at `max-w-4xl` inside a 1600 px shell, so on a laptop the right half of the screen is blank. This is most of the "empty" feeling. |
| A2 | The overview shows four numbers and two short lists. It has no picture of the room, nothing about *today*, and no "is anything wrong?" section. |
| A3 | "Busiest hours" leaves out hours with zero bookings, so the bars do not show the shape of the day. |
| A4 | The Rules tab asks for opening and closing times as **minutes past midnight** (`480`). |
| A5 | Bookings are cancelled with one click and no confirmation. The list is a flat table with no day grouping and no quick ranges. |
| A6 | Changing someone's role, including to or from admin, happens the moment the `<select>` changes. The audit trail that already exists (`role_audit`) is never shown. |
| A7 | The tabs are plain buttons, without tab semantics or keyboard navigation, and the selected tab is lost on refresh. |
| A8 | `AdminClient.tsx` is 832 lines and is about to grow. |

---

## Target layouts

### Booking page: desktop (≥1024 px)

```
Reading Room                                         [Sign in with Google]
Open today 8:00 am – 5:30 pm · up to 4 h · 3 seats each

┌ When ────────────────────────────────────────────────────────────────────┐
│ [Today 4][Mon 5][Tue 6][Wed 7] … (scrolls)    From [12:30 pm▾] For [2 h▾] │
└──────────────────────────────────────────────────────────────────────────┘
┌ Plan ───────────────────────────────────────────────┐ ┌ Book ───────────┐
│ 12:30–2:30 pm · 52 of 64 free   [All][Round][Study]… │ │ (sticky)        │
│                                                      │ │ Seat  S3 · 2    │
│                 floor plan                           │ │ Date  Sat 4 Oct │
│                                                      │ │ Time  12:30–2:30│
│ ■ Free  ■ Selected  ■ Yours  ▨ Taken                 │ │ [Confirm]       │
└──────────────────────────────────────────────────────┘ ├ Your bookings ──┤
                                                         │ Sat 4 Oct · now │
                                                         └─────────────────┘
```

- The controls collapse into one **When** row: the date strip uses `flex-1` and
  scrolls, and From/For sit at the right end.
- The free-seat count and the kind filter chips move into the **plan card's
  header row**, so they sit next to the thing they filter.
- The right column is `position: sticky; top: 1rem`, so **Confirm** stays
  visible while the plan scrolls.

### Booking page: phone (<1024 px)

```
Reading Room                    [Sign in]
Open 8:00 am – 5:30 pm
[Today 4][Mon 5][Tue 6]…  ← one row, scrolls
From [12:30▾]  For [2 h▾]
52 of 64 free · [All][Round][Study][PCs] ← one row, scrolls
┌──────────────────────────────┐
│  plan (opens centred)        │
│  ← swipe to see the room →   │
└──────────────────────────────┘
Your bookings …
┌──────────────────────────────┐  ← fixed bottom bar, only when a seat
│ S3 · seat 2 · 12:30–2:30 pm  │     is selected or a message is showing
│ [   Book this seat   ]       │
└──────────────────────────────┘
```

### Admin overview: desktop

```
Room admin                                   View booking page · Sign out
[Bookings] [Overview] [Layout] [Settings] [Privileges]     ← role="tablist"
──────────────────────────────────────────────────────────────────────────
● Open now · closes 5:30 pm                      Updated 12:41 pm [Refresh]
12 of 64 seats are in use. 31 bookings today, 84 more this week.

┌ In use now ──┐┌ Booked today ┐┌ Next 7 days ┐┌ People ──────┐
│ 12 / 64      ││ 31           ││ 84          ││ 212          │
│ ▓▓▓░░░░░░░░  ││ peak 18 at 2 ││ bookings    ││ 190 added    │
└──────────────┘└──────────────┘└─────────────┘│ their details│
                                               └──────────────┘
┌ Room at [now ▾] on [today ▾] ───────────────┐┌ Who's booked · today ────┐
│                                              ││ [Find a name…        ]   │
│         floor plan, coloured by occupancy    ││ ● In now · 12            │
│         hover a name → its seat is ringed    ││  Asha K    S3·2  –2:30pm │◄ hover/click
│         click a seat → its name is ringed    ││  Ben R     R4·1  –1:00pm │  links to
│ ■ Free ▨ Taken ■ Selected                    ││ Coming up · 9            │  the plan
├──────────────────────────────────────────────┤│  Chitra M  C2   2:00pm–  │
│ S3 · seat 2 — Asha K (asha@mgits.ac.in)      ││ Earlier today · 10  ▸    │
│ 12:30–2:30 pm · 2 more bookings this week    │└──────────────────────────┘
│ [See in People]                  [Cancel…]   │┌ Needs attention ─────────┐
└──────────────────────────────────────────────┘│ ✓ Nothing needs attention│
                                                └──────────────────────────┘
┌ Bookings per day ───────────┐┌ Busiest hours ─────┐┌ Seat types ────────┐
│ last 14 days · next 7       ││ 8 am … 5 pm        ││ Round   ▓▓▓▓░ 41%  │
└─────────────────────────────┘└────────────────────┘└────────────────────┘
┌ Most booked seats ──────────┐┌ Recent activity ─────────────────────────┐
│ S3 · 2      14              ││ 12:38 Asha K booked S3·2 for Sat 4 Oct   │
│ …                           ││ 11:02 Role: Ben → staff (by admin@…)     │
└─────────────────────────────┘└──────────────────────────────────────────┘
```

### Admin people: desktop

```
[Find a person: asha_______________]  [Search]
3 people match "asha" · 1 has a booking
Booking: [All 3] [Has a booking 1] [In now 1]   Role: [All] [Students] [Staff] [Admins]
┌ Person ───────────────┬ Booking ──────────────────────────────┬ Joined ───┬─────────┐
│ Asha K                │ ● In now · S3 · seat 2 · until 2:30 pm │ 12 Sep    │ Details▾│
│ asha@mgits.ac.in      │                                        │           │         │
├───────────────────────┴────────────────────────────────────────┴───────────┴─────────┤
│ Roll 22CS041 · CSE · year 3            Role [Student ▾]                              │
│ Upcoming:  Today 12:30–2:30 pm · S3·2 [Cancel…]   Tue 6 Oct 10–12 · R4·1 [Cancel…]   │
│ Last 30 days ▸ (7)                                                                   │
├───────────────────────┬────────────────────────────────────────┬───────────┬─────────┤
│ Asha Mathew           │ No upcoming booking                    │ 2 Oct     │ Details▸│
└───────────────────────┴────────────────────────────────────────┴───────────┴─────────┘
Recent role changes …
```

On a phone the cards stack in this order: status line, KPI tiles (2×2), Room,
Today, Needs attention, and then the charts. The room plan scrolls sideways and
opens centred, the same way as on the booking page.

**Keeping it simple:** the page reads top to bottom as *status sentence, four
numbers, the room, today's list, trends*. Each card has a plain title and one
small grey note. There are no more than three chart cards, all built from plain
CSS bars with their numbers printed beside them. There is no chart library,
legend-matching or hover-only information.

---

## Phases

Do them in order. Each one leaves the app working.

### Phase 0: Shared pieces and tokens

**Files:** `src/app/globals.css`, new `src/components/ui.tsx`, `src/lib/slots.ts`

1. In `globals.css`:
   - Change light `--muted` to `#6b6560` (≥4.5:1 on `--bg` and `--panel`). Leave
     the dark value as it is.
   - Add `--surface-2` (light `#f1eee8`, dark `#2a2930`) for inset areas such as
     the bottom bar and table headers.
   - Add `--warn` (light `#b45309`, dark `#fbbf24`) for "needs attention".
   - Add `--seat-taken-hatch` (light `#a8a29e`, dark `#6b6975`) for the hatch
     lines on taken seats.
   - Expose the new tokens in the `@theme inline` block.
   - Add a `@media (prefers-reduced-motion: reduce)` block that sets
     `transition: none` on `*`.
2. Create `src/components/ui.tsx` (`"use client"` not needed, since these are
   presentational) and move these **out of both `Reserve.tsx` and
   `AdminClient.tsx`** without changing how they look: `Notice`, `Chip`,
   `Label`, `Field`, `Swatch`, `Stat`, `Panel` (rename to `Card`, with props
   `title`, optional `note`, optional `action` slot on the right of the title,
   and `children`). Also add:
   - `Button`: `variant: "primary" | "secondary" | "danger"`, sizes `sm | md`,
     forwards props. Make the class strings identical to the ones already
     inlined everywhere.
   - `Meter`: `value`, `max`, accessible as `role="meter"` with
     `aria-valuenow/min/max` and `aria-label`. A rounded bar using `--accent`.
   - `Bar`: one row of a horizontal bar chart with a label, a bar and the number
     printed. Bars are decorative (`aria-hidden`), and the number is the content.
3. In `slots.ts` (pure), add:
   - `dayLabel(dateKey, todayKey)`: `"Today"`, `"Tomorrow"`, otherwise
     `"Mon 5 Oct"`. Parse the key as local Y-M-D and **never use `new
     Date("YYYY-MM-DD")`**, which is UTC and shifts the day.
   - `toHHMM(min)` (`480` → `"08:00"`) and `fromHHMM(s)` (`"08:00"` → `480`,
     `NaN` on bad input).

**Done when:** `tsc` and `build` pass, both pages look exactly as they did
before (compare screenshots), and no component file defines its own copy of
the moved helpers any more.

### Phase 1: Booking page layout

**Files:** `src/components/Reserve.tsx`, `src/components/FloorPlan.tsx`, new
`src/components/PlanScroller.tsx`

1. **Header (B6, mobile wrap):** title on the left and `Identity` on the right
   on **one row at every width**. On a phone `Identity` shows a compact
   "Sign in" button. Move the "College accounts only" line into the booking
   card. The subtitle becomes "Open today 8:00 am – 5:30 pm · up to 4 h · 3 seats
   each". When the selected date is closed, say so instead.
2. **When row (B1, B5):** one card. At `lg` it is a single flex row: the date
   strip (`flex-1 min-w-0 overflow-x-auto`) followed by From/For. Below `lg`
   the date strip takes its own row. Date tiles shrink to about 56 px wide.
   Scroll the selected tile into view on mount and on change
   (`scrollIntoView({inline: "nearest", block: "nearest"})`).
3. **Plan card header:** "12:30 – 2:30 pm · **52 of 64 free**" on the left and
   the kind chips on the right. On a phone the chips sit in one
   `overflow-x-auto` row (`flex-nowrap`), never wrapping.
4. **`PlanScroller` (B2):** wraps the plan's `overflow-x-auto` +
   `min-w-[760px]` pair. On mount, and whenever the container resizes
   (`ResizeObserver`), set `scrollLeft = (scrollWidth - clientWidth) / 2` so
   the plan opens centred. When the content overflows, show a small muted
   "Swipe to see the whole room" line and soft edge fades (absolutely
   positioned gradients, `pointer-events-none`). Hide both once the user has
   scrolled. Reuse this component in the admin room view (Phase 3) and in
   `LayoutEditor.tsx` in place of its own wrapper.
5. **Booking panel (B3, B6):**
   - Desktop: `lg:sticky lg:top-4 lg:self-start` aside.
   - With **no seat selected**, replace "Pick a green seat…" with a three-step
     guide: *1 Pick a day · 2 Pick a time · 3 Tap a green seat*, ticking each
     step off as it applies (the day and time are always set, so in practice it
     points at step 3).
   - **Signed out:** the panel shows the Google button and
     "College accounts only — @mgits.ac.in". Students can still pick a seat to
     look at it.
   - Rows: Seat, Date (`dayLabel`), Time, with **Confirm booking** below.
6. **Mobile bottom bar (B3, B4):** below `lg`, when `seat` is set **or** there
   is an `error`/`notice`, render a `fixed inset-x-0 bottom-0` bar on
   `--surface-2` with a top border, `pb-[env(safe-area-inset-bottom)]`. It shows
   the seat, date and time in one line plus a full-width **Book this seat**
   button (min height 44 px), or the message. Add bottom padding to the page
   while it is shown so it never covers "Your bookings". There must be **one
   `aria-live="polite"` region for messages per breakpoint**: hide the
   sidebar's copy below `lg` and the bar's copy at `lg` and above, so screen
   readers do not hear every message twice.
7. **Your bookings (B7):** split into **Upcoming** (date ≥ today, sorted) and a
   `<details>` "Past" list (hidden when empty). Each row shows
   `dayLabel · rangeLabel`, and a "Now" badge when today's slot range contains
   the current time. Before cancelling, ask with an inline confirm: the row
   swaps to "Cancel this booking? [Yes, cancel] [Keep]". Do not use
   `window.confirm`.
8. **Seat states not by colour alone (B8)** in `FloorPlan.tsx`:
   - `booked`: add an SVG `<pattern id="seat-hatch">` with diagonal lines in
     `--seat-taken-hatch` over `--seat-taken`, with the fill pointing at the
     pattern.
   - `selected`: keep the 4 px stroke and add an outer ring
     (`<rect>` 6 units larger, no fill, `--seat-active`, strokeWidth 3).
   - `mine`: a small `--panel`-coloured dot in the chair's centre.
   - Update the legend swatches to match (the hatch swatch can be a small
     inline SVG).
   - Add an optional prop `canSelect?: (seatId: string) => boolean`. The default
     is today's behaviour (`state !== "booked" && !dimmed`), so the booking page
     does not change. The admin view in Phase 3 passes `() => true`.
   - Pattern ids must be unique per instance (`useId()`), because the admin can
     show two plans.
   - Add an optional prop `ringed?: string | null`: that seat gets the same
     outer ring as `selected` but dashed (`strokeDasharray="6 4"`), whatever its
     state. The booking page never passes it. The admin overview uses it to
     show which seat a hovered name belongs to (Phase 3) without changing what
     is selected.

**Done when:**
- At 375×812 a student can pick a seat and see the **Book** button without
  scrolling, and the plan opens showing the fan centre (R1 and C1 visible after
  a short swipe right, with the swipe hint showing).
- At 800×600 at least the top third of the plan is visible without scrolling.
- At 1440×900 the whole plan and the Confirm button are visible together.
- Keyboard only: Tab reaches the date tiles, selects, chips and seats in that
  order; Enter on a seat selects it; the Confirm button is the next stop.
- Light and dark both look right, and the hatch is visible in both.
- There is still no link to `/admin` anywhere on `/`.

### Phase 2: Overview data

**Files:** `src/lib/overview.ts`, `src/lib/store.ts`, `src/lib/people.ts`,
`src/lib/slots.ts`, `src/app/api/admin/people/route.ts`,
`src/app/api/admin/people/[id]/route.ts`, `src/app/api/admin/reservations/route.ts`

1. In `store.ts`, add `listRecent(sb, limit = 8)`: the same `COLUMNS` select,
   `order("created_at", { ascending: false })`, `limit(limit)`. Map rows with
   `toReservation`.
2. In `people.ts`, add `listRoleChanges(sb, limit = 10)`. Read `role_audit`
   ordered by `changed_at desc`, then resolve `actor_id`/`target_id` to emails
   with **one** extra `profiles` query (`.in("id", ids)`). Return
   `{ at, targetEmail, targetName, from, to, byEmail | null }[]`.
3. Extend `Overview` in `overview.ts` by **adding** fields only; keep the
   existing ones so nothing breaks mid-way:
   ```ts
   generatedAt: string;                       // ISO, for "Updated 12:41 pm"
   status: { openNow: boolean; opensAt: string; closesAt: string; slotNow: number | null };
   seatsByKind: { kind: TableKind; total: number; occupiedNow: number }[];
   today: { …existing, peakAt: string | null; students: number }; // distinct students
   byDay: { date: string; bookings: number; isToday: boolean }[];  // today-13 … today+7, zero-filled (21 rows)
   byKind: { kind: TableKind; bookings: number; share: number }[]; // over the 30+7-day window
   quietSeats: { count: number; labels: string[] };              // live seats with 0 bookings in window; first 5 labels
   recent: { id: string; name: string; seatLabel: string; date: string; start: number; end: number; createdAt: string }[];
   roleChanges: RoleChange[];                                    // last 5; export `RoleChange` from people.ts
   attention: { orphanedUpcoming: number; withoutDetails: number };
   ```
   - **`byHour` must cover every hour from opening to closing**, zero-filled
     (A3). Compute it from `policy.openMin`/`closeMin`.
   - `peakAt` is the clock label of the *first* slot that reached the peak.
   - `orphanedUpcoming` counts reservations dated today or later whose
     `seat_id` is not in the current layout.
   - To fetch `student_id` for `today.students`, add `student_id` to the
     existing select. Never send `student_id` to the client: only the count
     leaves the server.
   - Keep all date logic in `Asia/Kolkata` through `libraryDateKey`, as the
     file's header comment explains.
4. Add `changes: await listRoleChanges(sb, 20)` to the response of
   `GET /api/admin/people`.

#### 2b. Who booked: data for the overview and People

Today an admin booking row carries the student's name and email but not their
account id, so a name in the overview cannot link to that person, and the
People list has no idea who holds a seat. Bookings are linked to people by
`reservations.student_id`, which already has an index on
`(student_id, date)`, so per-person lookups are cheap. No migration is needed.

5. **Move `slotNow`** from `overview.ts` into `slots.ts` as an exported pure
   function `librarySlotNow(p: Policy, now = new Date()): number | null`, with
   its comment. `overview.ts` imports it from there. People and the overview
   must agree on what "in the room now" means, so they use the same function.
6. **Admin booking rows carry the person's id.** In `store.ts`:
   - Add `ADMIN_COLUMNS = COLUMNS + ", student_id"`.
   - Export `interface AdminReservation extends Reservation { personId: string }`
     from `store.ts`. Do **not** add `personId` to the shared `Reservation` in
     `types.ts`, because that type is also returned to students.
   - Change `listRange` to use `ADMIN_COLUMNS` and return `AdminReservation[]`.
     Only the admin routes call it (check with
     `grep -rn listRange src`). `GET /api/admin/reservations` then passes
     `personId` through untouched.
7. **A booking summary per person** in `people.ts`:
   ```ts
   export interface BookingBrief {
     id: string;            // reservation id, so the UI can cancel it
     seatLabel: string;     // "S3 · seat 2", or "removed seat"
     date: string;          // YYYY-MM-DD
     time: string;          // rangeLabel(policy, start, end), formatted on the server
     now: boolean;          // today, and librarySlotNow falls inside it
   }
   export interface Person {
     …existing,
     /** today onwards, soonest first; at most maxPerStudent, so always small */
     upcoming: BookingBrief[];
   }
   ```
   - In `listPeople`, after loading profiles, make **one** extra query:
     `reservations` with `student_id in (ids)` and `date >= libraryDateKey()`,
     selecting `id, seat_id, date, start_slot, end_slot, student_id`, ordered
     by `date, start_slot`. Load the policy and specs once (`loadPolicy`,
     `loadSpecs`, then `buildLayout`) for labels and times. Group the rows by
     `student_id`. Run the three loads with `Promise.all`.
   - Drop any booking that ended earlier today (`date === today` and
     `end_slot <= slotNow`), so "upcoming" really means still to come.
   - Searching still goes through `searchable()`. Add the apostrophe to its
     allowed characters (`O'Brien`), because PostgREST's `or=` syntax treats it
     as ordinary text. Commas, brackets and `*` stay stripped.
8. **One person in full:** add `GET` to `src/app/api/admin/people/[id]/route.ts`
   (the file already has `PUT`; follow its error handling exactly). It returns
   `{ person: Person, past: BookingBrief[] }`, where `past` is that person's
   bookings over the last 30 days, newest first, using the same
   `(student_id, date)` index. Add `getPerson(sb, id)` to `people.ts` and use it.
   A uuid that is not a profile returns 404 "That account no longer exists.".

**Done when:** `GET /api/admin/overview` (signed in) returns every new field,
`byDay` has 21 entries and `byHour` has one entry per open hour, `tsc` and
`build` pass, and the current overview still renders unchanged. Also:
- `GET /api/admin/people?q=<part of a name>` returns matching people, each with
  an `upcoming` array (empty for people with no bookings).
- `GET /api/admin/people/<id>` returns that person and their last 30 days.
- `GET /api/admin/reservations` rows include `personId`.
- `GET /api/reservations?date=…` (the student route) is byte-for-byte the same
  shape as before: no names, no ids.

To check these, either ask the owner to make a test booking from the booking
page, or ask them before inserting a row with the Supabase MCP
`execute_sql`. Then cancel or delete only that test row afterwards, with their
OK.

### Phase 3: Admin shell and the new Overview

**Files:** replace `src/components/AdminClient.tsx` with a folder:

```
src/components/admin/
  AdminClient.tsx    – gates (Disabled, SignIn) + shell; default export used by app/admin/page.tsx
  Tabs.tsx           – accessible tablist
  OverviewTab.tsx
  RoomNow.tsx        – read-only plan + seat detail
  WhoList.tsx        – who's booked on the chosen day, linked to RoomNow
  BookingsTab.tsx
  RulesTab.tsx       – was SettingsTab
  PeopleTab.tsx
  LayoutTab.tsx      – thin wrapper around ../LayoutEditor
```

Move the existing tabs over **unchanged** first (one commit-sized step, then
check that it builds), and only then make the changes below. Update the import
in `src/app/admin/page.tsx`.

1. **Shell (A1, A7):**
   - Remove every `max-w-4xl`/`max-w-2xl` cap. Tabs use the full shell width,
     and the Rules form alone stays narrow (`max-w-2xl`) because it is a form.
   - `Tabs.tsx`: `role="tablist"`, each tab `role="tab"`,
     `aria-selected`, `aria-controls`, roving `tabIndex`, and Left/Right/Home/End
     keys. The panel is `role="tabpanel"` with `aria-labelledby`. Order and
     labels, as the owner set them: *Bookings · Overview · Layout · Settings ·
     Privileges* (the owner renamed "Booking rules" to "Settings" and "People"
     to "Privileges"; code ids stay `settings` and `people`, so `#people` links
     still work). **Bookings is the default tab** when `/admin` opens with
     no hash.
   - Keep the selected tab in `location.hash` (`#bookings`) and read it on
     mount. People also accepts `#people/<uuid>` (open that person) and
     `#people?q=<text>` (pre-fill the search), so the overview can link
     straight to someone. Parse the hash in one small function in `Tabs.tsx`,
     and ignore anything that is not a valid tab, uuid or short search. Changing tabs while the layout is dirty is fine (the editor stays
     mounted only while its tab is open, as today). Keep the existing
     `beforeunload` guard and the sign-out confirm.
   - Below `md`, the tab row scrolls sideways instead of wrapping.
2. **Overview (A2)**, top to bottom as in the wireframe:
   - **Status line:** a dot (`--seat-free` when open, `--muted` when shut),
     "Open now · closes 5:30 pm" or "Closed · opens 8:00 am", then on the right
     "Updated 12:41 pm" and a **Refresh** button.
     Refresh automatically every 60 s while `document.visibilityState ===
     "visible"`, and stop when the tab is hidden or unmounted.
   - **Summary sentence:** generated plain English, for example
     "12 of 64 seats are in use. 31 bookings today, 84 more this week." When
     shut: "The library is closed. 31 bookings today, 84 more this week."
   - **Four KPI tiles** (`Stat`, 2×2 on a phone and 4 across from `lg`):
     In use now (with a `Meter`), Booked today (note: "peak 18 at 2:00 pm",
     "{students} students"), Next 7 days, and People (note: "{withDetails}
     added their details").
   - **Room** card (`RoomNow.tsx`), about two thirds wide at `lg`:
     - Data: `GET /api/admin/layout` (specs, then run `buildLayout` on the
       client, which is safe because `floorplan.ts` is pure) plus
       `GET /api/admin/reservations?from=D&to=D` for the chosen day.
     - Controls in the card's `action` slot: a day `<select>` (today plus the
       next 6 days, labelled with `dayLabel`) and a time `<select>` of slots
       (default: the current slot if open, otherwise the first slot of the
       day).
     - `<FloorPlan>` inside `<PlanScroller>`, with `stateOf` set to occupied
       → `"booked"` and clicked → `"selected"`, `canSelect={() => true}`, and
       `labelOf` set to "R3 · seat 1 — free" or "… — Asha K, 12:30–2:30 pm".
     - Below the plan, a detail strip for the clicked seat: label, kind, and
       either "Free at this time" or the holder's name and email, the time, and
       **Cancel booking…**, which uses the same inline confirm pattern as Phase
       1 and calls `DELETE /api/admin/reservations/[id]`, then reloads.
     - Legend: Free, Taken, Selected.
   - **Who's booked** card (`WhoList.tsx`, replacing the `TodayList.tsx` in
     the folder listing above), one third wide, beside the Room card. This is
     where an admin sees who booked; the plan and the list are two views of the
     same rows and stay linked.
     - **One fetch:** lift the reservations fetch for the chosen day into
       `OverviewTab` and pass the rows to both `RoomNow` and `WhoList`, so the
       API is called once per day change or refresh. The rows carry `personId`
       (Phase 2b).
     - **Title** follows the Room card's day select: "Who's booked · Today",
       "Who's booked · Tue 6 Oct".
     - **Find a name:** a `type="search"` box at the top, labelled "Find a
       name", filtering the loaded rows as you type (name, email or seat
       label; case-insensitive; no server call). When it matches nothing:
       "Nobody booked matches 'asha' on this day. [Search everyone in People]",
       which opens People with the same search, because the person may exist
       without a booking that day.
     - **Groups**, with counts: **In now** (contains the time chosen in the Room
       card), **Coming up**, and **Earlier** (collapsed `<details>`). When the
       chosen day is not today, the groups are relative to the chosen time
       instead. Each row is a `<button>` reading "Asha K · S3 · seat 2 · until
       2:30 pm" (Coming up: "from 2:00 pm"), sorted by start time, then seat.
     - **Linked to the plan, both ways:**
       - Hovering or focusing a row sets `ringed` on the plan (Phase 1), which
         draws a dashed ring round that seat. Leaving clears it.
       - Clicking a row selects the seat in `RoomNow`, moves the time select to
         the booking's start if the booking is not at the current time, and
         scrolls the plan so the seat is visible.
       - Clicking a taken seat on the plan highlights its row in the list and
         scrolls it into view (`scrollIntoView({block: "nearest"})`).
     - **Seat detail strip** (under the plan, from the bullet above) gains the
       person's other upcoming bookings, read from the same day's rows plus a
       lazy `GET /api/admin/people/<personId>` ("2 more bookings this week"),
       and a **See in People** link to `#people/<personId>`.
     - Show at most 8 rows per group, then a "Show all N" button that expands in
       place. Do not paginate.
     - A muted footnote: "Names are visible to admins only."
   - **Needs attention** card: one line per non-zero `attention` item, each with
     a jump link ("3 upcoming bookings are on removed seats → Bookings"). With
     nothing to show: a green tick and "Nothing needs attention." The
     `withoutDetails` line is informational (muted, no warn colour), because
     details are optional for booking.
   - **Trends row** (three cards, stacked on a phone):
     - *Bookings per day*: 21 vertical CSS bars, today outlined, future bars at
       60 % opacity, weekday initial under each, and the count in each bar's
       `title` **and** in a visually-hidden list (`sr-only`) so screen readers
       get the numbers.
     - *Busiest hours*: the existing horizontal bars, zero-filled, with the
       current hour highlighted.
     - *Seat types*: one `Bar` per kind showing its share of bookings, and a
       muted footnote "{quietSeats.count} seats were not booked at all", listing
       up to 5 labels.
   - **Bottom row:** *Most booked seats* (existing list) and **Recent
     activity**, a single time-sorted list merging `recent` bookings
     ("12:38 pm · Asha K booked S3 · 2 for Sat 4 Oct") and `roleChanges`
     ("11:02 am · Ben R is now staff, changed by admin@…").
   - Loading: show grey skeleton blocks the size of each card (no layout jump),
     not "Counting…". Errors: one `Notice error` at the top with a **Try again**
     button.

**Done when:**
- At 1440×900 the status line, KPI tiles and the top of the Room and Today
  cards are visible without scrolling, and there is no large blank area on the
  right.
- At 375×812 nothing scrolls the *page* sideways (only the plan does).
- Clicking a taken seat shows who holds it, and cancelling after confirming
  updates the plan, the Who's booked list and the KPI tiles.
- Typing part of a name in **Find a name** narrows the list as you type.
  Hovering a name rings its seat, and clicking a seat highlights its name.
- **See in People** opens that person in the People tab.
- Tabs work with the keyboard only, `#people` in the URL opens People, and a
  refresh stays on the same tab.
- The auto-refresh stops when the browser tab is hidden (check with
  `document.visibilityState` in the console, or by watching network requests).

### Phase 4: Bookings, Rules and People

1. **Bookings (A5)** in `BookingsTab.tsx`:
   - Quick range chips above the form: *Today · Tomorrow · Next 7 days · Past
     30 days · Custom*. Custom reveals the existing From/To inputs. The default
     stays "today onwards", as the API already does.
   - Kind filter chips (All / Round / Study / Computer), applied on the client
     using the seat label map (seat ids start with the table uuid, so look the
     kind up through `buildLayout(specs)` from `/api/admin/layout`, fetched
     once).
   - Search filters as you type on the client (debounce 200 ms) over the rows
     already loaded. It only asks the server again when the range changes.
   - Group rows under **day headings** (`dayLabel` plus the count, e.g.
     "Tomorrow · 14 bookings"). Keep a real `<table>` inside each group, with
     a `<caption className="sr-only">` naming the day.
   - Cancel uses the inline confirm ("Cancel Asha K's booking? [Yes, cancel]
     [Keep]"). Show the server's error message if it fails, because today a
     failed cancel is silent.
   - **Download CSV** button: client-side `Blob` of the visible rows (date,
     time, seat, name, email). Plain `,`-joined, quoting any field that contains
     `,` `"` or a newline.
   - Orphan rows: keep the existing warning and add a "Show only these" toggle.
2. **Rules (A4)** in `RulesTab.tsx`:
   - Split into two `Card`s: **Opening hours** (Opens, Closes, Slot length) and
     **Limits** (Max booking, Calendar days, Seats per student).
   - Opens and Closes use `<input type="time" step={900}>`, converting with
     `toHHMM`/`fromHHMM`. Keep the stored value in minutes, so the API and
     database are unchanged. Closing at midnight (1440) is `"00:00"` in a time
     input, so map `"00:00"` on **Closes** back to 1440.
   - Keep the live summary sentence. Problems from `policyProblems` appear next
     to the field they concern (match on wording, or extend `policyProblems` to
     return `{ field, message }`, keeping the old string array as a derived
     export).
   - **Reset to defaults** asks with the inline confirm and lists what will
     change.
   - Show "Unsaved changes" next to Save when the form differs from what was
     loaded, and warn on leaving the tab with unsaved rule changes, the same way
     as the layout.
3. **People (A6)** in `PeopleTab.tsx`. The main job here is: *type a name,
   see straight away whether that person has a booking.*
   - **Search as you type.** One `type="search"` box labelled "Find a person",
     placeholder "Name, email, roll number or department", autofocused when the
     tab opens. Ask the server 250 ms after the last keystroke (it already
     searches all four fields), cancelling the previous request with an
     `AbortController` so a slow early answer cannot overwrite a later one. Keep
     the Search button for people who press Enter. Below the box, an
     `aria-live="polite"` line: "3 people match 'asha' · 1 has a booking".
   - **Booking column**, the second column after the name, filled from
     `Person.upcoming` (Phase 2b):
     - In the room now: a green dot and "**In now** · S3 · seat 2 · until
       2:30 pm".
     - Otherwise, the next booking: "**Next:** Tomorrow, 10:00 am – 12:00 pm ·
       R4 · seat 1", plus "+2 more" when there are more.
     - Nothing upcoming: muted "No upcoming booking".
     - The text carries the meaning; the dot is decoration (`aria-hidden`).
   - **Filter chips** in two short groups, all filtered on the client:
     *Booking:* All · Has a booking · In now. *Role:* All · Students ·
     Staff · Admins. Each chip shows its count, and they combine.
   - **Open a person:** each row has a "Details" disclosure button
     (`aria-expanded`, `aria-controls`). It expands **in place** under the row
     (no modal) and lazily loads `GET /api/admin/people/<id>`:
     - roll number, department, year, joined date and email;
     - **Upcoming bookings**, each with **Cancel…** (inline confirm, then
       `DELETE /api/admin/reservations/<id>`, then refresh the row);
     - **Last 30 days**, read-only, collapsed when longer than 5;
     - the role `<select>` moves here from the table, so the table stays
       readable at phone width. Keep the confirm-for-admin behaviour below.
   - `#people/<uuid>` opens that person's details and scrolls to them. If they
     are not in the current list (more than 500 people, or filtered out), show
     their details card above the table, from the same endpoint.
   - Add a **Joined** column (`dayLabel`-style date, or "Mon 5 Oct 2026" when
     it is not this year). Below `md`, hide the Joined column; the date is
     still in the expanded details.
   - Changing a role to or from **admin** opens an inline confirm in that row
     ("Make Ben R an admin? They will be able to change rules and cancel any
     booking."). Student and staff changes apply immediately, as today. After any
     change, show a success `Notice` ("Ben R is now staff.").
   - A **Recent role changes** card under the table, using `changes` from Phase
     2: "12 Oct, 11:02 am · Ben R: student → staff · by admin@…".
4. **Layout:** wrap `LayoutEditor` in `PlanScroller` (Phase 1) and give its
   sidebar `lg:sticky lg:top-4 lg:self-start`. Change nothing else in the editor.

**Done when:** every item above works at 1440 and 375 widths in light and dark;
cancelling, saving rules and changing a role each show a visible result; and a
failed request (stop the dev server briefly, or block the request in the
console) shows a readable error rather than nothing. For People specifically:
- Typing part of a name updates the list within about half a second, without
  pressing Enter, and the live line says how many match and how many have a
  booking.
- Someone with a booking shows "In now" or "Next: …" in the table, and someone
  without one shows "No upcoming booking".
- "Has a booking" narrows the list to the people with bookings.
- Expanding a person shows their upcoming and recent bookings, and cancelling
  one updates that person's Booking column.
- Typing quickly ("a", "as", "ash", "asha") never leaves the results for an
  earlier search on screen.

### Phase 4b: Saturday hours and closed days (Booking rules)

Run this after Phase 4, because it extends the Rules tab built there.

**Goal:** in **Booking rules**, an admin can give each weekday its own hours
(Saturday 9:00 am – 1:00 pm, say) or mark it closed (Sundays). They can also
close specific dates (holidays). Students see closed days on the booking page
and cannot book them.

**No migration.** The new rules are two more rows in the existing
`settings` key/value table, with JSON in `value`. The quota trigger only reads
`maxPerStudent`, so it is unaffected.

#### Why the slot grid matters

`reservations.start_slot`/`end_slot` are slot numbers counted from the opening
time (`slotLabel = openMin + slot × slotMin`), and the database's two overlap
constraints compare those numbers. So **every day must share one slot grid**,
or the same number would mean different times on different days. The rule:

- **Grid start** = the earliest opening time of any open weekday
  (`gridOpen(p)`). With the defaults that is the regular "Opens" time, so
  existing bookings keep exactly the times they have now.
- A day with its own hours is a **window on that grid**: its opening and
  closing times must fall on slot boundaries (`(open − gridOpen) % slotMin === 0`).
  Saturday 9:00 – 1:00 with 30-minute slots from 8:00 is slots 2–10.
- **This fixes an existing bug.** Today, changing **Opens** or **Slot length**
  while future bookings exist silently moves every one of them to a different
  time. From this phase on, the server refuses that change while any booking
  dated today or later exists (see step 4).

#### Steps

1. **Policy shape** (`src/lib/policy.ts`, pure):
   ```ts
   export type DayMode = "regular" | "custom" | "closed";
   export interface DayHours { mode: DayMode; open: number; close: number } // open/close used only when "custom"
   export interface ClosedDate { date: string; note: string }               // YYYY-MM-DD, note ≤ 40 chars
   export interface Policy {
     …existing,
     /** index = JS getDay(): 0 Sunday … 6 Saturday */
     week: DayHours[];
     closedDates: ClosedDate[];
   }
   ```
   - The defaults are every day `"regular"` and no closed dates, so nothing
     changes until an admin edits it.
   - `coerce`/`normalise` parse `week` and `closedDates` from JSON strings (the
     settings table stores text). Bad or missing JSON falls back to the
     defaults, so a broken row never takes the booking page down, as the file
     already promises. Clamp times like the other fields. Drop malformed dates,
     duplicates and dates before today (`libraryDateKey()`), sort by date, and
     cap at 100.
   - In `savePolicy` (`room.ts`), write `week` and `closedDates` with
     `JSON.stringify`. Today it calls `String(value)`, which would store
     `[object Object]`. `loadPolicy` needs no change because it hands raw
     strings to `normalise`.
   - `policyProblems` gains these checks:
     - each custom day: closing after opening, at least one slot long, and on
       the slot grid ("Saturday's opening time must line up with the 30-minute
       slots, e.g. 9:00 or 9:30.");
     - "The library can't be closed every day of the week.";
     - each closed date is a valid date, at most once.
2. **Pure schedule helpers** in `src/lib/slots.ts`. Everything else calls these
   and nothing else reads `openMin` directly:
   - `gridOpen(p)`: the earliest open time across open days.
   - `hoursFor(p, dateKey)`: returns `{ open, close }`, or
     `{ closed: true, reason }` where the reason is "Closed on Sundays" or
     "Closed · Onam". A closed date wins over the weekday.
   - `slotWindow(p, dateKey)`: returns `{ first, end }` in grid slots, or
     `null` when closed.
   - Change `slotLabel` to anchor on `gridOpen(p)` instead of `p.openMin`.
     `slotCount(p)` becomes the grid length up to the latest closing time; it
     is still used by charts.
   - `firstOpenSlot(p, dateKey, now)`: the larger of `window.first` and the
     slot "now" is in. It returns `window.end` for a closed or finished day.
     Keep the signature so callers barely change.
   - `isBookableDate`: also false on closed days.
   - `calendarDays`: each day gains `closed: string | null` (the reason).
   - `librarySlotNow` (from Phase 2b) uses today's `hoursFor`.
   - Weekday names come from `fromDateKey(key).getDay()`, never `new Date(key)`.
3. **Booking rule on the server** (`store.ts` `create()`): check
   `hoursFor` first ("The library is closed that day — closed on Sundays."), then
   the window ("On Saturdays the library opens at 9:00 am." / "…closes at
   1:00 pm."), then the existing checks. `slotCount(p)` comparisons become
   `window.end`. The owner's principle (architecture.md: a rule that matters
   lives in the database) is not met by this alone; see step 7.
4. **Saving rules safely** (`src/app/api/admin/policy/route.ts`, `PUT`):
   - **Grid guard:** if `gridOpen` or `slotMin` would change and any booking
     is dated today or later, return 409: "12 upcoming bookings would move to
     different times. Keep the opening time and slot length until they are
     over, or cancel them first." Count with one `head: true` count query.
   - **Dry run:** the body may carry `dryRun: true`. The route validates,
     then returns `{ affected: BookingBrief[] }` without saving. These are the
     upcoming bookings that would fall on a newly closed day or outside a day's
     new hours. Reuse `BookingBrief` from Phase 2b and add the person's name.
   - **Saving** with `cancelAffected: true` saves first, then removes those
     bookings with `forceRemove`. If a removal fails, answer 200 with
     `{ policy, notCancelled: n }` and let the UI say "Saved, but 2 bookings
     could not be cancelled. Cancel them from Bookings.". Never cancel first,
     because a failed save would then have removed bookings for nothing.
5. **Booking rules UI** (`RulesTab.tsx`), as a third and fourth card between
   **Opening hours** and **Limits**:
   ```
   ┌ Week ───────────────────────────────────────────────────────────┐
   │ Monday     [Regular hours ▾]   8:00 am – 5:30 pm                │
   │ …                                                               │
   │ Saturday   [Different hours ▾] [09:00] – [13:00]                │
   │ Sunday     [Closed ▾]          Closed                           │
   └─────────────────────────────────────────────────────────────────┘
   ┌ Closed dates ───────────────────────────────────────────────────┐
   │ [date] [Note, e.g. Onam      ] [Add]                            │
   │ Thu 15 Oct · Onam                                    [Remove]   │
   └─────────────────────────────────────────────────────────────────┘
   ```
   - The order is Monday first. Each row's `<select>` is labelled with the day
     name (a `<label>` or `aria-label`). "Different hours" reveals two
     `<input type="time">` fields using `toHHMM`/`fromHHMM`, with the closing
     midnight rule from Phase 4. A problem from `policyProblems` appears on
     that day's row.
   - Closed dates: the date input's `min` is today, and the note is optional
     (40 characters at most). Adding a date already in the list does nothing
     and says "Already closed that day.".
   - The summary sentence covers the week compactly: "Mon–Fri 8:00 am – 5:30 pm,
     Sat 9:00 am – 1:00 pm, closed Sun · 2 closed dates ahead". Group
     consecutive days with identical hours.
   - **Save flow:** Save sends a dry run first. With nothing affected it saves
     straight away. Otherwise an inline panel lists the affected bookings
     (name, seat, day, time) with three choices: **Save and cancel these 6
     bookings**, **Save and keep them**, and **Back**. "Keep" leaves the
     bookings in place, and they show in Overview's *Needs attention* (add
     `attention.outsideHours` to the overview, from the same check).
   - A 409 from the grid guard shows next to the Opens / Slot length fields.
   - **Reset to defaults** also clears the week and closed dates. Run it
     through the same dry run so it cannot strand bookings silently.
6. **Booking page** (`Reserve.tsx`, built in Phase 1):
   - Closed days stay in the date strip, so the week still reads in order, but
     are muted with "Closed" in place of the month. They are `disabled`, with
     the reason in `aria-label` ("Sunday 12 October, closed on Sundays").
   - If today is closed, the page opens on the first open day.
   - The From/For selects offer only that day's window, and the header summary
     uses that day's hours ("Open Saturday 9:00 am – 1:00 pm").
   - In *Your bookings*, a booking on a day that has since closed shows a
     warning line: "The library is closed that day (Onam). Cancel it to free
     the seat in your quota.". Students are not otherwise notified, because
     the app sends no email.
7. **Optional, ask the owner first: enforce in the database.** Students
   insert bookings through PostgREST under RLS, so `store.ts` is the only thing
   checking hours. That is true today for opening hours as well. A
   `before insert` trigger `enforce_opening_hours` could read `week` and
   `closedDates` from `settings` (plain `jsonb` operators) and refuse closed
   days and out-of-window slots with a new code `LR002`, mapped to a sentence
   in `refusal()`. That is a migration, so **ask the owner before applying
   it**. If they agree, apply it with the Supabase MCP `apply_migration`
   and add the `.sql` file under `supabase/migrations/`.

**Done when:**
- Pure checks pass. Write a throwaway script in the scratchpad and run it with
  `node --experimental-strip-types`, under `TZ=Asia/Kolkata` and
  `TZ=America/Los_Angeles`:
  - Saturday 9–1 with a grid starting at 8:00 in 30-minute slots gives
    window 2–10.
  - A closed date beats a custom weekday.
  - All seven days closed is a problem.
  - A misaligned Saturday time (9:15 with 30-minute slots) is a problem.
  - Default policy: `slotLabel` gives exactly the same times as before.
- In the browser, with Saturday set to 9–1 and Sunday closed:
  - Saturday's From list starts at 9:00 am, and the last end time is 1:00 pm.
  - Sunday tiles are greyed and cannot be picked.
  - Booking Sunday through the API directly (`fetch` from the console) is
    refused with a readable message.
- Closing a date that has a test booking shows it in the dry-run panel, and
  each of the three choices does what it says.
- Changing **Opens** while an upcoming booking exists is refused with the 409
  message, and the booking's time is unchanged.
- Overview's status line says "Closed today · closed on Sundays" on a Sunday
  (check by passing a fixed `now` in the pure script, not by waiting).

### Phase 5: Accessibility and final pass

1. Run through both pages with the keyboard only. The focus ring must be
   visible on every control, using the existing `:focus-visible` rule extended
   to `button, a, input, select, summary`.
2. Check that every chart has its numbers in text (visible or `sr-only`) and
   that no information is in a `title` attribute alone.
3. Touch targets are at least 44 px tall below `lg` (chips, date tiles, Cancel
   buttons, the tab row).
4. Contrast: check `--muted` text on `--panel`, `--bg` and `--surface-2` in both
   themes (≥4.5:1). Fix tokens rather than individual classes.
5. Delete anything left unused (the old `AdminClient.tsx` path, duplicate
   helpers) and run `tsc` and `build` one last time.
6. Take final screenshots: booking page and admin overview at 1440×900 and
   375×812, light and dark. Send them to the owner with a short summary of what
   changed per phase and anything that was skipped.

---

## Out of scope (do not do these here)

- Schema changes, new tables, or storing cancelled bookings (a cancellation log
  would need a migration; raise it as a follow-up if wanted).
- Changing how the admin password or Google sign-in works.
- Any app, PWA or offline work.
- Moving or renumbering furniture, or changing `PLAN_FIT`.
- A chart or UI library.

## Open choices (defaults chosen; the owner may override)

| Question | Default in this plan |
|---|---|
| Can the admin room view look at other days? | Yes, today plus the next 6 days. |
| Should a staff/student role change be confirmed too? | No, only changes to or from admin. |
| Should CSV export include past bookings? | It exports whatever range is on screen. |
| Auto-refresh interval on Overview | 60 s, only while the browser tab is visible. |
| How far back does a person's history go? | 30 days. |
| Default week when Phase 4b ships | Every day on regular hours, no closed dates, so nothing changes until an admin edits it. |
| Can a day open earlier than the regular "Opens"? | Yes, but only while no upcoming bookings exist, because it moves the slot grid. |
| Enforce closed days in the database too (Phase 4b step 7)? | Not until the owner approves the migration. |
| Can an admin cancel a booking from People? | Yes, with the same inline confirm as elsewhere. |
| Names on the floor plan itself? | No. A chair is about 13 px wide on screen, so names live in the linked list beside it. |

---

## Prompt to run this with Sonnet 5.5

Switch the session model to Sonnet 5.5 with the app's model picker, then send:

> Read `docs/plan/step-2-ui-and-admin.md` and carry out **Phase 0** only.
> Follow its "Rules for whoever executes this" exactly. When the phase's
> "Done when" checks pass, show me screenshots and stop. Do not commit.

Then repeat for Phase 1, 2, 3, 4, 4b and 5 in turn. Running one phase at a time keeps
each change reviewable, and Phase 3 in particular is large.
