-- Let the password-gated admin area change roles through the guarded function.
--
-- The admin area is not a signed-in admin user yet — that is step 6. Today it
-- is a shared password, and it acts with the service key, which carries no
-- user_role claim, so is_admin() is false and set_user_role() refuses it.
--
-- The service key already bypasses row-level security, so the admin area could
-- simply UPDATE profiles.role directly. That would be the worse answer: it
-- would skip the audit row and the last-admin check that live inside this
-- function. Allowing service_role to call it therefore tightens the path
-- rather than loosening it.
--
-- actor_id is left null for these changes, which reads as "changed through the
-- shared admin password" rather than by a named admin. Once step 6 lands and
-- admins sign in as themselves, auth.uid() fills in and the audit trail names
-- a person again.

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
  if not (public.is_admin() or (select auth.role()) = 'service_role') then
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

grant execute on function public.set_user_role(uuid, public.app_role) to service_role;
