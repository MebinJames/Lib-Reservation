# Architecture

The stack:

- **[Supabase](https://supabase.com)** — Postgres, row-level security, and auth
- **[React](https://react.dev/)** — the interface
- **[Next.js](https://nextjs.org/)** — hosting, routing and the server-side API
- **[Tailwind](https://tailwindcss.com/)** — styling
- **Google Cloud OAuth**, through Supabase Auth — sign-in, college domain only

The decision behind the auth half is recorded in
[`plan/step-1-auth-architecture.md`](plan/step-1-auth-architecture.md); the
route from the original libSQL app is in
[`plan/library-reservation.md`](plan/library-reservation.md).

## The governing idea

**A rule that matters lives in the database, not in a route.**

Every booking rule that could be lost by a forgotten check is a constraint, a
trigger or a policy. The application still checks these things, because a
student deserves a sentence rather than a constraint violation — but if the
application forgot, the database would still refuse.

That is the whole reason this app is on Postgres, and it is the property to
protect when changing anything below.

## Sign-in: three parties, not two

This is the part that most often goes wrong, so it is worth being precise about
who talks to whom.

```
browser → /api/auth/signin        the app asks Supabase to start a sign-in
        → Supabase /authorize     Supabase redirects to Google
        → Google consent screen   the student picks their account
        → Supabase /auth/v1/callback   Google returns HERE, not to the app
        → /api/auth/callback      Supabase returns the student to the app
```

Two redirect URLs are involved and they are **not** interchangeable:

| Registered where | Value | Purpose |
| --- | --- | --- |
| Google Cloud → OAuth client → Authorised redirect URIs | `https://<project-ref>.supabase.co/auth/v1/callback` | Where **Google** sends the student |
| Supabase → Authentication → URL Configuration → Redirect URLs | `http://localhost:3000/api/auth/callback` | Where **Supabase** sends the student |

Putting the app's own URL into Google's list produces
`Error 400: redirect_uri_mismatch`. Google talks to Supabase; Supabase talks to
the app. The app's own domain never appears in Google's configuration.

Two further details, both deliberate:

- **`prompt=select_account`** is sent on every sign-in. Without it Google
  silently reuses whichever account the browser last used, so on a shared
  library machine the next student would land in the previous student's account
  without ever being asked.
- **`hd=mgits.ac.in`** is sent too, but only pre-fills Google's account
  chooser. It can be edited out of the URL, so it is never trusted — the domain
  is enforced server-side, three times over.

### Consent screen

The Google Cloud project uses an **External** consent screen, published out of
Testing mode. Only `openid`, `email` and `profile` are requested — all
non-sensitive — so no Google verification review is required.

One consequence worth knowing: because the OAuth client's redirect lives on
`supabase.co`, a domain nobody here owns, Google shows that domain on the
consent screen rather than the app's name. Changing it needs a custom domain on
Supabase, which is a paid feature. It is cosmetic.

## The domain rule lives in three places

Only `@mgits.ac.in` accounts may exist. That is enforced at three levels, and
each covers a different failure:

1. **`hook_restrict_signup_by_email_domain`** — a Before User Created auth
   hook. Refuses the sign-up outright, with a readable message.
2. **`profiles_email_domain`** — a check constraint on the column. Makes an
   out-of-domain row impossible to hold *at all*, which is what replaces the
   old behaviour of re-checking the domain on every session read. The hook only
   ever runs once, at sign-up.
3. **`emailAllowed()`** in [`../src/lib/auth.ts`](../src/lib/auth.ts) — the
   friendly one, and a backstop if a dashboard toggle is ever switched off.

All three are **equality** tests on the part after the `@`, never suffix tests:
`x@evil.mgits.ac.in` yields `evil.mgits.ac.in` and is refused, as is
`x@mgits.ac.in.evil.com`.

Changing the college domain is therefore a migration, not a setting.

## Two things SQL cannot do for itself

Creating the hook functions is not enough — nothing calls them until they are
selected in the dashboard, under **Authentication → Hooks**:

- **Before User Created** → `hook_restrict_signup_by_email_domain`
- **Custom Access Token** → `custom_access_token_hook`

Until the first is on, any Google account can reach sign-up; the check
constraint still refuses it, but the student sees a database error instead of a
sentence. Until the second is on, no JWT carries `user_role`, so `is_staff()`
and `is_admin()` read as `student` for everybody and the role system is inert.

The second unavoidable manual step is the **first admin**. `set_user_role`
refuses a caller who is not already an admin — deliberately, so the role cannot
be self-granted — which leaves a bootstrap problem. See
[`../supabase/README.md`](../supabase/README.md).

## Where each rule is enforced

| Rule | Held by |
| --- | --- |
| A seat cannot be double-booked over any overlapping slot | `reservations_no_seat_overlap`, an `EXCLUDE` constraint |
| A student cannot hold two seats at once | `reservations_no_student_overlap`, an `EXCLUDE` constraint |
| A student holds at most `maxPerStudent` seats | `enforce_booking_quota()` trigger, under a row lock |
| Only in-domain accounts exist | the signup hook and the check constraint |
| A student reads and cancels only their own bookings | row-level security policies |
| A student cannot promote themselves | column privileges — `role` is not grantable |
| The day view never reveals who booked a seat | `seat_occupancy(date)` returns no identity |
| Only an admin changes roles; the last admin cannot be demoted | `set_user_role()`, which also writes `role_audit` |
| Opening hours, calendar window, booking length | [`../src/lib/store.ts`](../src/lib/store.ts) — policy the database cannot see |

The last row is the honest exception. Opening hours are a business rule read
from `settings`, not an invariant of the data, so they live in the application.

### Why the overlap rules are constraints and the quota is a trigger

Both `EXCLUDE` constraints are over `int4range(start_slot, end_slot)`, which is
half-open — exactly the app's "start inclusive, end exclusive" convention. A
booking of 4–8 and one of 8–12 do not overlap. SQLite had no equivalent, which
is why the original `store.ts` did this by hand inside a transaction.

A quota is a **count**, and a count cannot be an exclusion constraint. So
`enforce_booking_quota()` takes a row lock on the student's profile before
counting:

```sql
perform 1 from public.profiles where id = new.student_id for update;
```

Without that lock, two simultaneous bookings would each count `quota - 1` and
both succeed. It raises `LR001`, a distinct error code, so the application can
turn it into a readable message without string-matching.

### Verified, not assumed

Both properties were checked under genuinely simultaneous load by
[`../scripts/check-concurrency.mjs`](../scripts/check-concurrency.mjs):

- 25 requests in flight at once for one seat → exactly **1** booking, 24
  exclusion violations
- 10 requests in flight at once for one student, quota 3 → exactly **3**
  bookings, 7 quota refusals

The script **refuses to report a pass unless it measures that the requests
actually overlapped**, and prints every outcome rather than only the ones it
expects. Both safeguards were added after an earlier version reported a pass on
requests that were in fact three minutes apart, and after a run whose totals
silently failed to add up.

## Authorization

Two mechanisms, because row-level security alone is not enough.

**Row-level security** decides which rows. Students select and delete their own
reservations and read their own profile; staff read every profile.

**Column privileges** decide which fields. RLS cannot restrict a single column,
so the "update own profile" policy would otherwise let a student set their own
`role`. That is closed underneath:

```sql
revoke update on public.profiles from authenticated;
grant update (full_name, roll_no, department, year, registered_at)
  to authenticated;
```

Verified with a real signed-in token: registering succeeds (204), setting
`role: admin` is refused (403, `42501`), and editing another student's profile
changes nothing. That last one is worth knowing about — PostgREST answers
**204, as though it worked**, because "no rows matched" is not an error. The
row was confirmed untouched rather than the status code believed.

### A privacy rule that needed its own function

`GET /api/reservations?date=` originally returned whole reservation rows, so
every student could see who held which seat. `seat_occupancy(date)` is
`security definer` and returns `seat_id`, `start_slot`, `end_slot` and nothing
else. Supabase's linter warns about `security definer` objects; this one and
`set_user_role` are both intentional, and both guard themselves.

## Two clients, two keys

[`../src/lib/supabase/server.ts`](../src/lib/supabase/server.ts) exposes
exactly two, and the difference matters:

- **`userClient()`** acts as whoever is signed in. Row-level security decides
  what it can reach, so a bug in a route cannot hand one student another's
  data. Everything student-facing uses this.
- **`serviceClient()`** bypasses row-level security entirely. Only for code
  that has already decided the caller is allowed — today, the password-gated
  admin routes.

`server-only` is imported at the top of that module, so importing it from a
client component is a build error rather than a leaked secret key.

Even the admin area changes roles through `set_user_role` rather than writing
`profiles.role` directly. The service key *could* write the column — that is
precisely why it shouldn't, because doing so would skip the audit row and the
last-admin guard.

A rejected key is reported as such: Supabase returns `{message: "Invalid API
key"}` — or `"Unregistered API key"` once rotated — as a **plain object, not an
`Error`**, so without explicit handling it falls through to a generic 500 and a
rotated key looks like a dead database.

## Data model

```sql
profiles      (id, email, full_name, roll_no, department, year, role,
               registered_at, created_at)
reservations  (id, seat_id, date, start_slot, end_slot, student_id, created_at)
layout_tables (id, kind, x, y, rot, seats, num)
settings      (key, value)
role_audit    (id, actor_id, target_id, old_role, new_role, changed_at)
```

- **`date` is a `YYYY-MM-DD` string** and slots are integers counted from
  opening time, `start_slot` inclusive and `end_slot` exclusive.
- **`seat_id` is `<table uuid>:<n>`**, 1-based, derived from a table's stable id
  rather than its display code. Moving a table renumbers its label without
  pointing existing bookings at a different chair.
- **`role` is an enum**: `student`, `staff`, `admin`.
- **`registered_at`** records who has filled in their own details. It is *not* a
  condition of booking — a college account is the qualification, which is the
  point of restricting the domain.

### "Today" means today in Asia/Kolkata

The quota trigger counts from the Kolkata day. Server-side code must agree with
it, which is what `libraryDateKey()` in [`../src/lib/slots.ts`](../src/lib/slots.ts)
is for. `toDateKey()` reads the machine's clock — correct in a browser, wrong
on a server: hosted in UTC, everything between midnight and 05:30 in India
would still answer "yesterday".

## What is deliberately not in the database

- `src/lib/floorplan.ts` — geometry, numbering and drawing. Pure, no I/O.
- `src/lib/policy.ts` — the booking-rule shape, defaults and validation.
- `src/lib/slots.ts` — the calendar and clock, derived from a policy.
- The plan components — rendering and interaction only.

These are pure functions over plain data, which is why two backend migrations
have left them untouched.

## Staying awake on the free plan

Supabase pauses Free Plan projects after a week of low activity. That is the
one place where the free tier is genuinely unsuitable for something people rely
on: the booking page would be down until an email was noticed.

The documented remedy is a few database requests a day, so `vercel.json`
schedules `/api/keepalive` daily and that route performs a real query. The
route deliberately reports what it reached, because a keepalive that has
stopped touching the database is indistinguishable from a working one until the
project pauses.

It is a workaround for a free-tier limitation, not a design feature. Upgrading
to Pro removes the pausing and makes the cron unnecessary.

## Known gaps

- **The admin area is one shared password.** `ADMIN_PASSWORD` and an
  HMAC-signed cookie, because there were no accounts with roles when it was
  written. The role model now exists; steps 6 and 7 of the plan replace it.
- **No tests beyond the concurrency check**, and no git history. Both are
  required before a deploy.
- **`everything-claude-code/`** in the project root fails `tsc`. Unrelated to
  this app, but it will break a production build.
