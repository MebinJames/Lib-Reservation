# Library Reservation — plan to the desired state

Derived from the existing Next.js 16 app in this repository, not from a blank
sheet. Each step says what is already true before naming what changes.

> Steps 1–7 are done. What they built is described in
> [`../architecture.md`](../architecture.md); this document is the plan they
> were carried out against, kept for the reasoning behind each step. Steps
> 8–12 — tests, hosting, the app, documentation — are still open.

## Where the code stands today

| Area | Today | Desired |
| --- | --- | --- |
| Database | libSQL — local SQLite file, Turso for hosting (`src/lib/db.ts`) | Supabase Postgres |
| Sign-in | Hand-rolled Google OIDC, auth-code + PKCE, HMAC session cookie (`src/lib/auth.ts`) | Supabase Auth with Google, `@mgits.ac.in` only |
| Registration | None — a Google identity is the whole account | A registration page capturing a student profile |
| Admin | One shared `ADMIN_PASSWORD`, no accounts, no roles (`src/lib/admin.ts`) | Role-based privileges, with the ability to grant roles |
| Hosting | Local dev only | A free tier, published |
| Client | Web only | Website and an app |
| Tests | No runner configured in `package.json` | Critical journeys covered |
| Version control | **Not a git repository** | Required before any deploy |

What already meets the target: the domain restriction. `emailAllowed()` tests
the part after `@` for equality with `ALLOWED_EMAIL_DOMAIN`, so
`you@evil.mgits.ac.in` and `you@mgits.ac.in.evil.com` are both refused, and the
domain is re-checked on every session read rather than only at sign-in. That
behaviour is a constraint on the steps below, not something to redesign.

What makes the port non-trivial: `create()` in `src/lib/store.ts` runs the seat
check, the clash check and the quota check inside one libSQL write transaction.
Whatever replaces it has to keep all three under one transaction, or two
simultaneous requests will both be told the seat is free. Postgres can express
the no-double-booking rule in the schema itself with a `btree_gist` exclusion
constraint, which SQLite cannot — so the port is a chance to move a rule from
application code into the database, not a line-for-line translation.

---

## Step 1. Decide the auth and data architecture for Supabase

Choose between keeping the hand-rolled PKCE gate and adopting Supabase Auth's
Google provider. The fork matters because Supabase RLS policies are naturally
written against `auth.uid()`; a session this app mints itself is invisible to
the database, so row-level rules would have to be re-implemented in application
code. Against that, the existing gate is understood, tested, and enforces the
domain more strictly than a provider's `hd` hint.

Also settle how roles are represented (a `role` column on a profile row versus
Postgres roles or custom JWT claims) and what happens to sessions already
issued under the current HMAC scheme.

## Step 2. Create the Supabase schema and RLS policies

Author the Postgres schema: `profiles` (email, full name, roll number,
department, year, role), `reservations`, `layout_tables`, `settings`. Add the
`btree_gist` exclusion constraint that makes overlapping bookings on one seat
impossible at the schema level. Write RLS so a student reaches only their own
rows and privileged roles reach everything.

Out of scope: rewriting the TypeScript data layer, which is step 3.

## Step 3. Port the data layer from libSQL to Supabase Postgres

`store.ts` exposes `listByDate`, `listByStudent`, `create`, `remove`,
`listUpcoming` and `forceRemove`; those are the only functions that touch SQL,
and the README already names them as the swap point. `room.ts` persists the
layout and policy alongside them. Port all of it, keeping `create` inside one
transaction and letting the exclusion constraint raise the clash rather than
the current `SELECT`-then-`INSERT` check.

Seat ids must come through byte-identical, or existing bookings point at
different chairs.

Out of scope: changing booking policy semantics or the floor-plan geometry.

## Step 4. Wire Google sign-in to the chosen model

Implement whichever path step 1 chose, preserving every check in `gate()`:
Google issuer, `aud` equal to this client, not expired, nonce match,
`email_verified` true, and domain equality. Demo sign-in stays off by default.

## Step 5. Build the registration page

After a first successful college sign-in, capture the student's profile before
any seat can be booked, and let them edit it afterwards. This is the piece with
no equivalent in the current code — today a Google identity is the entire
account record.

Out of scope: bulk import of existing student records.

## Step 6. Replace the shared admin password with role-based access

`src/lib/admin.ts` is one password for one operator, and its own comment says
to put it behind real SSO before staff use it. Derive admin access from the
signed-in college account's role instead. `/admin` stays unlinked from the
booking page — students have no route to it.

## Step 7. Build the role management screen

List college accounts, search them, and change a user's role. Privilege
escalation is the risk to design against: the last admin must not be able to
lock everyone out, and a lesser role must not be able to grant a greater one.
Every change is recorded.

## Step 8. Cover the critical journeys with tests

`package.json` has no test script and no runner. Set one up, then cover college
sign-in, registration, booking, cancellation and a role change — including the
refusals, not only the happy paths.

## Step 9. Publish on a free tier

Initialise the git repository this project does not yet have, then deploy the
web app with the Supabase project attached and the production redirect URI
registered with Google. Vercel's free tier is the natural fit for Next.js;
Netlify, Cloudflare Pages and Render are alternatives.

## Step 10. Choose how the app ships

An installable PWA over this same Next.js app, a React Native or Expo client
against the same API, or a Capacitor wrapper. The decision turns on store
presence, push notifications, offline seat viewing, and how much of
`src/components` survives the move.

## Step 11. Implement the app

Build the chosen path against the same authenticated API rather than a parallel
backend.

Out of scope: push notifications and offline booking, which need their own design pass.

## Step 12. Update the documentation

`README.md` and `.env.example` currently describe libSQL, Turso and
`ADMIN_PASSWORD` in detail. Bring them in line with what was actually built.
