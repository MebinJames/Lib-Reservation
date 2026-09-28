-- Booking no longer waits on a registration form.
--
-- The college domain is the qualification. An account cannot exist at all
-- unless its address is @mgits.ac.in — the signup hook refuses anything else,
-- and the check constraint on profiles.email makes an out-of-domain row
-- impossible to hold. Asking for a roll number on top of that was asking
-- students to retype something their own address already contains
-- (25ad056@mgits.ac.in), for no additional assurance.
--
-- profiles.roll_no, department, year and registered_at all stay. They are
-- still filled in by /register and still worth having; they are simply no
-- longer a condition of booking a seat. is_registered() also stays, so staff
-- screens can tell who has completed their details.

drop policy if exists "book as yourself, once registered" on public.reservations;
drop policy if exists "book as yourself" on public.reservations;

create policy "book as yourself" on public.reservations
  for insert to authenticated
  with check (student_id = (select auth.uid()));
