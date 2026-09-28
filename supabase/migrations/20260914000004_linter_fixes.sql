-- Fixes for findings from Supabase's database linter, run against the schema
-- the first three migrations create. Each is a real finding, not noise.

-- ------------------------------------------------ btree_gist out of `public`

-- Lint 0014. Anything in `public` is part of the exposed API surface; an
-- extension has no business there.
alter extension btree_gist set schema extensions;

-- --------------------------------------- trigger functions are not endpoints

-- Lints 0028 and 0029. Both of these live in `public`, so PostgREST exposes
-- them at /rest/v1/rpc/<name> to anon and authenticated alike. Calling a
-- trigger function directly fails anyway, but it should not be reachable.
revoke execute on function public.handle_new_user()      from public, anon, authenticated;
revoke execute on function public.enforce_booking_quota() from public, anon, authenticated;

-- ------------------------------------------------- occupancy without the view

-- Lint 0010. The previous seat_occupancy was a SECURITY DEFINER view: it read
-- every reservation as its owner and returned only the non-identifying
-- columns. It worked, but it left an object in the schema that sees rows no
-- policy allows, which is what the linter objects to.
--
-- The obvious alternative — let everyone select every row, and withhold the
-- student_id column with a grant — does not work. Postgres requires SELECT
-- privilege on every column a query *references*, including in a WHERE clause,
-- so withholding student_id would also stop a student filtering their own
-- bookings by it.
--
-- So the privileged path stays, but narrowed to the shape the booking page
-- actually needs: one date, and no column that identifies anybody. There is
-- nothing here worth protecting, which is why it is safe to expose to anon —
-- the plan has to grey out taken seats before you sign in.
drop view if exists public.seat_occupancy;

create or replace function public.seat_occupancy(on_date date)
returns table (seat_id text, start_slot int, end_slot int)
language sql
security definer
stable
set search_path = ''
as $$
  select r.seat_id, r.start_slot, r.end_slot
    from public.reservations r
   where r.date = on_date;
$$;

revoke execute on function public.seat_occupancy(date) from public;
grant execute on function public.seat_occupancy(date) to anon, authenticated;

comment on function public.seat_occupancy(date) is
  'Which seats are taken on one date. Deliberately returns no student_id: '
  'the booking page needs occupancy, never identity.';

-- Staff need no equivalent — the "staff read every reservation" and "staff read
-- every profile" policies already let them select both tables and join.
