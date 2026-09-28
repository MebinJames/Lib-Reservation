# Step 1 — Auth and data architecture for Supabase

> This is the decision record. For how the system ended up being built, see
> [`../architecture.md`](../architecture.md).

**Decision: adopt Supabase Auth, and retire the hand-rolled PKCE gate.**

Verified against the Supabase docs on 2026-09-14 rather than from memory, because
the whole decision turns on whether Supabase can enforce a domain restriction
server-side. It can.

---

## Why

The reason to move to Supabase at all is Postgres with row-level security. RLS
policies are written against `auth.uid()` and `auth.jwt()`, both of which come
from a Supabase-issued token. A session this app mints itself is invisible to
the database: every row rule would have to be re-implemented in TypeScript, and
`store.ts` would go on being the only thing standing between one student and
another student's data. That is the same position the app is in today — so
keeping the custom gate means paying for the migration and getting none of the
security benefit that motivated it.

The objection to Supabase Auth was that its Google provider treats the domain as
a hint. The `hd` parameter is indeed only a hint — the same thing
`src/lib/auth.ts` already says about its own `hd` — but it is not the only
mechanism available.

### The Before User Created Hook is the enforcement point

Supabase runs a [`before-user-created`
hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook)
immediately prior to inserting a row into `auth.users`. It receives the pending
user and either returns `{}` to allow or an error object to refuse. It can be a
plain Postgres function — no Edge Function, no extra service, nothing that costs
money on the free tier.

```sql
create or replace function public.hook_restrict_signup_by_email_domain(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  addr   text := lower(trim(event->'user'->>'email'));
  domain text;
begin
  -- Exactly one '@', and it may not be the first character. split_part on
  -- 'a@b@c' would otherwise yield 'b' and quietly admit the address.
  if addr is null
     or length(addr) - length(replace(addr, '@', '')) <> 1
     or position('@' in addr) = 1
  then
    return jsonb_build_object('error', jsonb_build_object(
      'message',   'Sign in with your college Google account.',
      'http_code', 403));
  end if;

  domain := split_part(addr, '@', 2);

  -- Equality, never a suffix test.
  if domain <> 'mgits.ac.in' then
    return jsonb_build_object('error', jsonb_build_object(
      'message',   'Only @mgits.ac.in accounts can use this system.',
      'http_code', 403));
  end if;

  return '{}'::jsonb;
end;
$$;

grant execute on function public.hook_restrict_signup_by_email_domain
  to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup_by_email_domain
  from authenticated, anon, public;
```

This preserves the property the current code is careful about:
`you@evil.mgits.ac.in` yields domain `evil.mgits.ac.in` and
`you@mgits.ac.in.evil.com` yields `mgits.ac.in.evil.com`. Both are refused,
because the test is equality.

---

## What this costs, stated plainly

**Auth Hooks are labelled Beta** in the Supabase dashboard. That is the main
thing being accepted here. The hook API is documented and stable in shape, but
it is not GA.

**The domain check moves from "every session read" to "once, at signup."** This
is a real regression and the most important finding in this step.
`readSession()` in `src/lib/auth.ts:134` re-runs `emailAllowed()` every time a
cookie is read, so tightening `ALLOWED_EMAIL_DOMAIN` invalidates already-issued
sessions immediately. The `before-user-created` hook fires only when the
`auth.users` row is first inserted; it never runs again. Left alone, a user
admitted under a looser rule keeps working forever.

Compensate in two places, so the property survives:

1. A `check` constraint on `profiles.email` so a row whose address is out of
   domain cannot exist at all.
2. An RLS predicate on the booking tables that requires the caller's profile to
   be in-domain, so the database refuses the write rather than trusting the app.

That is stricter than today's behaviour, not weaker — today the re-check lives
in one TypeScript function that every caller has to remember to go through.

**About 320 lines of hand-rolled security code go away** — `auth.ts`'s HMAC
signing, session minting, PKCE construction and token exchange. That is a
benefit, not a cost, but it is a rewrite: `session.ts`, the four routes under
`src/app/api/auth/`, `Reserve.tsx`'s identity block, and demo mode all change.

**Nothing needs migrating.** The only sessions and bookings in the database are
demo ones created during testing, so there is no cutover problem — the old
cookies simply stop being honoured.

---

## Every `gate()` guarantee, mapped

| Check in `gate()` today | Under Supabase Auth |
| --- | --- |
| `iss` is Google | Supabase validates the ID token against Google's JWKS |
| `aud` equals this client | Validated against the client configured in the dashboard |
| Not expired | Supabase validates `exp` |
| `nonce` matches this browser | Supabase owns the PKCE flow and the nonce |
| `email_verified` is true | **Assert explicitly in the hook.** Confirm against a real Google payload in step 4 before relying on the field being present — do not assume it |
| Domain equality | `before-user-created` hook, above |
| Re-checked on every session read | `check` constraint + RLS predicate, per the section above |

The first four move from our code into Supabase's, which is the point. The last
three stay our responsibility and must be built deliberately.

---

## Role model

A single `role` column, not Postgres roles and not raw JWT claims as the source
of truth.

```sql
create type public.app_role as enum ('student', 'staff', 'admin');

create table public.profiles (
  id            uuid primary key references auth.users on delete cascade,
  email         text  not null unique
                check (lower(split_part(email, '@', 2)) = 'mgits.ac.in'),
  full_name     text  not null,
  roll_no       text  unique,
  department    text,
  year          smallint,
  role          app_role not null default 'student',
  registered_at timestamptz,
  created_at    timestamptz not null default now()
);
```

The role reaches RLS through a [Custom Access Token
Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook),
which copies `profiles.role` into the JWT so policies can read
`auth.jwt() ->> 'user_role'` without a table lookup on every row.

The table stays the source of truth; the claim is a cache. A role change
therefore takes effect on the user's next token refresh, not instantly — worth
knowing when step 7 demotes someone.

**RLS cannot restrict individual columns.** A student needs `update` on their own
profile row to edit their department, and an RLS policy permitting that permits
them to set `role = 'admin'` in the same statement. Close it with a column
privilege, which Postgres enforces underneath RLS:

```sql
revoke update (role) on public.profiles from authenticated;
```

---

## RLS strategy, and one thing it forces you to fix

- `profiles` — a student selects and updates their own row; staff and admin
  select all; only admin updates `role`, via the column grant above.
- `reservations` — a student selects, inserts and deletes rows where
  `student_id = auth.uid()`; staff and admin reach everything.
- `layout_tables`, `settings` — everyone reads, only staff and admin write.

The thing that needs fixing: **the booking page currently sends every student's
name to every other student.** `GET /api/reservations?date=` returns whole
`Reservation` objects — `name` and `studentId` included — so the browser can grey
out taken seats. Under RLS a student cannot read another's reservation row at
all, so that query stops working as written, which is the correct outcome.

Replace it with a view that exposes occupancy without identity:

```sql
create view public.seat_occupancy
with (security_invoker = off) as
  select seat_id, date, start_slot, end_slot from public.reservations;
```

Readable by any authenticated user; it carries no names. This is a privacy bug
in the current code that the migration happens to surface.

---

## What step 2 inherits

1. The `before-user-created` hook function above, wired in the dashboard.
2. `profiles` with the domain `check` constraint and the `role` column grant.
3. The `custom_access_token_hook` copying `role` into the JWT.
4. `reservations` with the `btree_gist` exclusion constraint.
5. The `seat_occupancy` view replacing the identity-leaking date query.
6. RLS policies for all four tables, with an `authorize()` helper.

## Open question for step 4

Whether the `before-user-created` payload carries `email_verified` for a Google
identity. The documented sample shows an email signup with empty
`user_metadata`. Observe a real Google payload before writing the assertion, and
if the field is absent, fall back to checking the identity record rather than
silently dropping the check.
