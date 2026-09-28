-- What the TypeScript data layer needs from the database.

-- ------------------------------------------------ a code the app can match on

-- The quota trigger used check_violation (23514), which is also what every
-- CHECK constraint raises. The app would have had to tell "over quota" apart
-- from "invalid slot range" by reading the message text. LR001 is ours alone:
-- the LR class is this app's, and nothing in Postgres uses it.
create or replace function public.enforce_booking_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  quota int;
  held  int;
begin
  perform 1 from public.profiles where id = new.student_id for update;

  select coalesce(
           (select nullif(regexp_replace(value, '\D', '', 'g'), '')::int
              from public.settings
             where key = 'maxPerStudent'),
           3)
    into quota;

  select count(*) into held
    from public.reservations
   where student_id = new.student_id
     and date >= (now() at time zone 'Asia/Kolkata')::date;

  if held >= quota then
    raise exception
      'Each student can hold % seats at a time. Cancel one first.', quota
      using errcode = 'LR001';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_booking_quota() from public, anon, authenticated;

-- ------------------------------------------------- replacing the whole room

-- The layout editor saves the entire room at once. Over the Supabase client a
-- delete followed by an insert is two HTTP requests and two transactions, so a
-- failure between them would leave the room empty. One function call is one
-- transaction.
--
-- Tables that survive keep their id, and seat ids are derived from table ids,
-- so bookings on those seats still resolve. Only tables absent from `specs`
-- are removed.
--
-- security invoker: RLS applies, so only staff can change the room. For anyone
-- else the delete matches nothing and the insert is refused, which rolls the
-- whole call back.
create or replace function public.replace_layout(specs jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(specs) is distinct from 'array' then
    raise exception 'The layout must be a list of tables.'
      using errcode = 'invalid_parameter_value';
  end if;

  -- Has a WHERE clause, so Supabase's safeupdate guard is satisfied; with an
  -- empty list it removes every table, which is what an empty layout means.
  delete from public.layout_tables
   where id <> all (
     array(select (e ->> 'id')::uuid from jsonb_array_elements(specs) e)
   );

  insert into public.layout_tables (id, kind, x, y, rot, seats, num)
  select (e ->> 'id')::uuid,
         e ->> 'kind',
         (e ->> 'x')::double precision,
         (e ->> 'y')::double precision,
         (e ->> 'rot')::double precision,
         (e ->> 'seats')::int,
         (e ->> 'num')::int
    from jsonb_array_elements(specs) e
  on conflict (id) do update
     set kind  = excluded.kind,
         x     = excluded.x,
         y     = excluded.y,
         rot   = excluded.rot,
         seats = excluded.seats,
         num   = excluded.num;
end;
$$;

revoke execute on function public.replace_layout(jsonb) from public, anon;
grant execute on function public.replace_layout(jsonb) to authenticated, service_role;
