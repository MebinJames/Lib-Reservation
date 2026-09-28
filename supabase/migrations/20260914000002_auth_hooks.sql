-- Auth hooks.
--
-- Both are plain Postgres functions, so neither needs an Edge Function and
-- neither costs anything on the free tier. Each must be selected by hand in the
-- dashboard under Authentication > Hooks before it does anything — creating the
-- function is not enough.

-- ------------------------------------------------- who is allowed to sign up

-- Runs immediately before a row is inserted into auth.users. Returning an error
-- object refuses the signup; returning '{}' allows it.
--
-- This is the enforcement point for the college-only rule. Google's `hd`
-- parameter is only a hint to the account chooser and can be tampered with, so
-- it is never trusted; the decision is made here, on the address Google
-- actually returned.
create or replace function public.hook_restrict_signup_by_email_domain(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  addr   text := lower(trim(event -> 'user' ->> 'email'));
  domain text;
begin
  -- Exactly one '@', and not in first position. Without this, split_part on
  -- 'a@b@mgits.ac.in' would yield 'b' and the address would fall through.
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

-- ------------------------------------------------------- the role in the JWT

-- Runs before an access token is issued, copying the profile's role into the
-- token so RLS can read it without a table lookup per row.
--
-- profiles.role stays the source of truth; the claim is a cache, so a role
-- change takes effect on the user's next token refresh rather than instantly.
--
-- A user with no profile row falls through to 'student', the least privileged
-- role — absence must never grant anything.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  claims    jsonb;
  user_role public.app_role;
begin
  select role into user_role
    from public.profiles
   where id = (event ->> 'user_id')::uuid;

  claims := event -> 'claims';
  claims := jsonb_set(claims, '{user_role}',
                      to_jsonb(coalesce(user_role, 'student'::public.app_role)));

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- ---------------------------------------------------------------- privileges

-- Supabase Auth runs hooks as supabase_auth_admin. Nobody else may call them:
-- an authenticated user able to execute custom_access_token_hook could forge a
-- claims object.
grant usage on schema public to supabase_auth_admin;

grant execute on function public.hook_restrict_signup_by_email_domain(jsonb)
  to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup_by_email_domain(jsonb)
  from authenticated, anon, public;

grant execute on function public.custom_access_token_hook(jsonb)
  to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb)
  from authenticated, anon, public;

-- The token hook needs to read the role. Select only — profiles holds PII, and
-- the hook has no reason to write.
grant select on table public.profiles to supabase_auth_admin;

create policy "auth admin reads profiles"
  on public.profiles
  as permissive for select
  to supabase_auth_admin
  using (true);
