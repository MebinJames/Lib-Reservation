# Supabase

> The database half of the system. For how it fits together with the app and
> with Google sign-in, see [`../docs/architecture.md`](../docs/architecture.md).

Schema for the Reading Room, replacing the libSQL schema that was inlined in
`src/lib/db.ts`. Applied to the project with `supabase db push`, or one file at
a time in the SQL editor, in filename order.

| File | What it does |
| --- | --- |
| `20260914000001_init_schema.sql` | Tables, the two exclusion constraints, the quota trigger |
| `20260914000002_auth_hooks.sql` | Domain restriction at signup; the role claim |
| `20260914000003_rls_policies.sql` | Row-level security and `set_user_role` |
| `20260914000004_linter_fixes.sql` | Findings from Supabase's database linter |
| `20260914000005_data_layer_support.sql` | `replace_layout`, and a distinct `LR001` code for the quota |
| `teardown.sql` | Drops all of it. Destructive; run by hand |

## Two things SQL cannot do for you

### 1. Turn the hooks on

Creating the functions is not enough — nothing calls them until they are
selected in the dashboard under **Authentication → Hooks**:

- **Before user created** → `hook_restrict_signup_by_email_domain`
- **Custom access token** → `custom_access_token_hook`

Until the first is enabled, **any** Google account can sign up. Until the second
is, every JWT lacks `user_role`, so `is_staff()` and `is_admin()` read as
`student` and the admin area is closed to everybody.

Hooks are a Beta feature.

### 2. Make the first admin

`set_user_role` refuses a caller who is not already an admin, and everyone
starts as `student`. That is deliberate — it means the role cannot be
self-granted through the API — but it leaves a bootstrap problem: the first
admin has to be made directly in the database.

Sign in once with the account that should own the system, then run this in the
SQL editor, substituting the real address:

```sql
update public.profiles
   set role = 'admin'
 where email = 'you@mgits.ac.in';
```

From then on, role changes go through `set_user_role`, which records every one
in `role_audit` and refuses to demote the last remaining admin.

## Things worth knowing before changing this

**The college domain is in two places, both deliberately hard-coded**: the
signup hook and the `profiles_email_domain` check constraint. Changing it is a
migration, not a setting. The constraint is what replaces the old behaviour of
re-checking the domain on every session read — the hook only ever runs once, at
signup, so without the constraint an account admitted under a looser rule would
keep working forever.

**Both overlap rules are enforced by an index, not by application code.**
`reservations_no_seat_overlap` and `reservations_no_student_overlap` are
`EXCLUDE` constraints over `int4range(start_slot, end_slot)`, which is half-open
— exactly the app's "start inclusive, end exclusive" convention. A booking of
4–8 and one of 8–12 do not overlap. SQLite had no equivalent, which is why
`store.ts` did this by hand inside a transaction.

**The quota is not.** A count cannot be an exclusion constraint, so
`enforce_booking_quota()` takes a row lock on the student's profile first.
Without that lock two concurrent bookings could each count `quota - 1` and both
succeed. It reads `maxPerStudent` from `settings`, falling back to 3, and counts
from today **in Asia/Kolkata** — `current_date` would be the UTC day, which is
the previous day for the first five and a half hours of every morning.

**`seat_occupancy(date)` is `security definer` on purpose.** The booking page
needs to know which seats are taken without learning who took them. It returns
`seat_id`, `start_slot` and `end_slot` and nothing else. Supabase's linter warns
about it, along with `set_user_role`; both are intentional and both guard
themselves.

**Role changes are not instant.** The role lives in `profiles` and is copied
into the JWT by the access-token hook, so a change takes effect on the user's
next token refresh.
