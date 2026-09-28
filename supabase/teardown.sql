-- Drops everything the four migrations create, so an empty project can be
-- rebuilt from scratch. Destructive: every booking and profile goes with it.
-- Not a migration — run it by hand.
--
-- Order matters. Dropping the helper functions first fails, because the
-- policies on `reservations` depend on is_registered(); the tables have to go
-- first so their policies go with them. Verified by running it and rolling back.

drop function if exists public.seat_occupancy(date);

drop trigger if exists on_auth_user_created on auth.users;

-- Policies and the quota trigger are dropped with their tables.
drop table if exists public.role_audit;
drop table if exists public.reservations;
drop table if exists public.layout_tables;
drop table if exists public.settings;
drop table if exists public.profiles;

-- set_user_role takes app_role, so it has to go before the type.
drop function if exists public.set_user_role(uuid, public.app_role);
drop function if exists public.is_registered();
drop function if exists public.is_admin();
drop function if exists public.is_staff();
drop function if exists public.current_app_role();
drop function if exists public.custom_access_token_hook(jsonb);
drop function if exists public.hook_restrict_signup_by_email_domain(jsonb);
drop function if exists public.enforce_booking_quota();
drop function if exists public.handle_new_user();

drop type if exists public.app_role;

-- btree_gist is left in place; it is shared infrastructure, not ours to remove.
