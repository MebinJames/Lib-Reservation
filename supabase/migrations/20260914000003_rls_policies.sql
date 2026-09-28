-- Row-level security.
--
-- Until now store.ts was the only thing standing between one student and
-- another student's data. These policies move that boundary into the database,
-- so a bug in a route handler cannot leak rows.

alter table public.profiles      enable row level security;
alter table public.reservations  enable row level security;
alter table public.layout_tables enable row level security;
alter table public.settings      enable row level security;
alter table public.role_audit    enable row level security;

-- ------------------------------------------------------------------ helpers

-- The role arrives as a JWT claim, put there by custom_access_token_hook.
-- Anything missing or unrecognised reads as 'student'.
create or replace function public.current_app_role()
returns text
language sql
stable
set search_path = ''
as $$ select coalesce(auth.jwt() ->> 'user_role', 'student') $$;

create or replace function public.is_staff()
returns boolean
language sql
stable
set search_path = ''
as $$ select public.current_app_role() in ('staff', 'admin') $$;

create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$ select public.current_app_role() = 'admin' $$;

-- Booking is refused until registration is finished. Runs as the caller, so
-- it reads the caller's own profile through the policy below.
create or replace function public.is_registered()
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
     where id = (select auth.uid())
       and registered_at is not null
  )
$$;

-- ----------------------------------------------------------------- profiles

create policy "read own profile" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "staff read every profile" on public.profiles
  for select to authenticated
  using ((select public.is_staff()));

create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- RLS cannot restrict a single column: the policy above would otherwise let a
-- student set role = 'admin' in the same statement that edits their department.
-- Column privileges are checked underneath RLS, so this closes it properly.
-- Note this binds admins too — role changes go through set_user_role() below,
-- which is the only audited path.
revoke update on public.profiles from authenticated;
grant update (full_name, roll_no, department, year, registered_at)
  on public.profiles to authenticated;

-- Nobody inserts or deletes a profile directly; the trigger on auth.users
-- creates it and the cascade removes it.

-- ------------------------------------------------------------- reservations

create policy "read own reservations" on public.reservations
  for select to authenticated
  using (student_id = (select auth.uid()));

create policy "staff read every reservation" on public.reservations
  for select to authenticated
  using ((select public.is_staff()));

create policy "book as yourself, once registered" on public.reservations
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and (select public.is_registered())
  );

create policy "cancel your own booking" on public.reservations
  for delete to authenticated
  using (student_id = (select auth.uid()));

create policy "staff cancel any booking" on public.reservations
  for delete to authenticated
  using ((select public.is_staff()));

-- There is deliberately no UPDATE policy. A booking is created or cancelled,
-- never edited — moving one is a cancel plus a new booking, which has to pass
-- the overlap and quota checks again.

-- --------------------------------------------------------- room and settings

create policy "anyone may read the layout" on public.layout_tables
  for select to anon, authenticated using (true);

create policy "staff edit the layout" on public.layout_tables
  for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

create policy "anyone may read the rules" on public.settings
  for select to anon, authenticated using (true);

create policy "staff edit the rules" on public.settings
  for all to authenticated
  using ((select public.is_staff()))
  with check ((select public.is_staff()));

-- ---------------------------------------------------------------- the audit

create policy "admins read the role audit" on public.role_audit
  for select to authenticated
  using ((select public.is_admin()));

-- No insert policy: only set_user_role() writes here, and it is security
-- definer, so it bypasses RLS by design.

-- ------------------------------------------------------------- who is where

-- The booking page needs to know which seats are taken, but not by whom. The
-- old GET /api/reservations?date= returned whole reservation rows — names and
-- student ids included — to every signed-in student. RLS makes that query
-- return nothing, which is correct; this view is the replacement.
--
-- security_invoker = off is deliberate: the view runs as its owner so it can
-- see rows the caller cannot, and it exposes no identifying column. Supabase's
-- linter flags security-definer views, and this one is intentional.
create view public.seat_occupancy
  with (security_invoker = off)
  as select seat_id, date, start_slot, end_slot
       from public.reservations;

grant select on public.seat_occupancy to anon, authenticated;

-- ------------------------------------------------------------ role changes

-- The only way a role changes. Security definer because the column grant above
-- denies UPDATE(role) to every authenticated user, admins included.
create or replace function public.set_user_role(
  target   uuid,
  new_role public.app_role
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor    uuid := (select auth.uid());
  old_role public.app_role;
  admins   int;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can change roles.'
      using errcode = 'insufficient_privilege';
  end if;

  select role into old_role from public.profiles where id = target for update;
  if not found then
    raise exception 'No such user.' using errcode = 'no_data_found';
  end if;

  if old_role = new_role then
    return;
  end if;

  -- Losing the last admin would lock everyone out of the admin area with no
  -- way back in short of editing the database by hand.
  if old_role = 'admin' then
    select count(*) into admins from public.profiles where role = 'admin';
    if admins <= 1 then
      raise exception 'This is the last admin. Promote someone else first.'
        using errcode = 'check_violation';
    end if;
  end if;

  update public.profiles set role = new_role where id = target;

  insert into public.role_audit (actor_id, target_id, old_role, new_role)
  values (actor, target, old_role, new_role);
end;
$$;

revoke execute on function public.set_user_role(uuid, public.app_role) from public, anon;
grant execute on function public.set_user_role(uuid, public.app_role) to authenticated;
