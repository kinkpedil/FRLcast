-- FRL Broadcast: the whole event, in Postgres.
--
-- Two kinds of person touch this database and they are authenticated completely
-- differently, on purpose.
--
--   An operator is a Supabase Auth user. They own events and everything hanging off one.
--
--   A driver is not. Making twelve people create email accounts to receive a yellow flag
--   is friction the app was built to avoid, so a driver holds a row in driver_accounts
--   with a bcrypt hash and signs in through a SECURITY DEFINER function with a race
--   number and a password. That function is the security boundary; the table itself is
--   unreachable from the API.
--
-- Timing data is public to read. It is being broadcast to an audience, so there is nothing
-- to protect, and overlays running in OBS have no login to offer. What is not public is
-- the sign-in queue and anything that could identify or impersonate a driver.

-- Supabase keeps pgcrypto in the extensions schema, not public. The definer functions
-- below pin their search_path, which is what stops a caller putting their own schema in
-- front of a function running with the definer's rights, so extensions has to be named in
-- that path or crypt() and gen_salt() are simply not visible to them.
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- events

create table if not exists public.events (
  id            uuid primary key default gen_random_uuid(),
  owner         uuid not null references auth.users (id) on delete cascade,

  -- What a driver types into the app. Short, unambiguous, no look alike characters.
  code          text not null unique,

  name          text not null default 'UNTITLED EVENT',
  round         text not null default '',
  track         text not null default '',
  session_type  text not null default 'race',
  session_label text not null default '',
  total_laps    int  not null default 0,

  status        text not null default 'idle',
  flag_source   text not null default 'operator',
  started_at    timestamptz,
  clear_since   timestamptz,

  -- Themes, brand, scene layouts, rule toggles. Long tail that would be forty columns of
  -- churn, and that nothing queries by.
  settings      jsonb not null default '{}'::jsonb,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint events_code_shape check (code ~ '^[A-Z0-9]{4,12}$'),
  constraint events_status_known check (status in
    ('idle','formation','green','yellow','safety','vsc','red','finished'))
);

create index if not exists events_owner_idx on public.events (owner);

-- ---------------------------------------------------------------- driver accounts

-- Never selectable through the API. Every column below is either a secret or lets somebody
-- work out a secret, and the functions at the bottom of this file are the only way in.
create table if not exists public.driver_accounts (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  num           text not null,
  nick          text not null,
  -- Typed by the driver on their phone, and put on their car when the sign-in is accepted.
  team          text not null default '',
  pass_hash     text not null,
  token         uuid,
  token_expires timestamptz,
  created_at    timestamptz not null default now(),

  -- One number per event. Two cars wearing 7 is a timing bug waiting to happen.
  unique (event_id, num)
);

-- ---------------------------------------------------------------- grid

create table if not exists public.drivers (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  account_id  uuid references public.driver_accounts (id) on delete set null,

  num         text not null,
  name        text not null,
  short       text not null default '',
  team        text not null default '',
  color       text not null default '#8e8e93',

  position    int  not null default 0,
  laps_done   int  not null default 0,
  last_lap    int,
  best_lap    int,
  progress    double precision not null default 0,

  pit         boolean not null default false,
  dnf         boolean not null default false,
  finished    boolean not null default false,
  blue_flag   boolean not null default false,

  created_at  timestamptz not null default now(),
  unique (event_id, num)
);

create index if not exists drivers_event_idx on public.drivers (event_id);

-- ---------------------------------------------------------------- sign in queue

create table if not exists public.registrations (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  account_id  uuid not null references public.driver_accounts (id) on delete cascade,
  driver_id   uuid references public.drivers (id) on delete set null,
  nick        text not null,
  num         text not null,
  team        text not null default '',
  status      text not null default 'pending',
  created_at  timestamptz not null default now(),

  unique (event_id, account_id),
  constraint registrations_status_known check (status in ('pending','approved','rejected'))
);

create index if not exists registrations_event_idx on public.registrations (event_id);

-- ---------------------------------------------------------------- penalties

create table if not exists public.penalties (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  driver_id  uuid not null references public.drivers (id) on delete cascade,

  type       text not null default 'time',
  seconds    int  not null default 0,
  reason     text not null default 'Incident',
  lap        int  not null default 0,
  status     text not null default 'applied',
  served     boolean not null default false,
  auto       boolean not null default false,

  created_at timestamptz not null default now(),

  constraint penalties_type_known check (type in
    ('time','warning','drivethrough','blackflag','dq','note')),
  constraint penalties_status_known check (status in
    ('applied','investigating','dropped'))
);

create index if not exists penalties_event_idx on public.penalties (event_id, created_at desc);
create index if not exists penalties_driver_idx on public.penalties (driver_id);

-- ---------------------------------------------------------------- event log

-- Doubles as the VOD marker list: anything worth announcing is worth a timestamp.
create table if not exists public.feed (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  driver_id  uuid references public.drivers (id) on delete set null,
  kind       text not null,
  text       text not null,
  created_at timestamptz not null default now()
);

create index if not exists feed_event_idx on public.feed (event_id, created_at desc);

-- ---------------------------------------------------------------- championship

create table if not exists public.results (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  round       text not null,
  num         text not null,
  name        text not null,
  position    int  not null,
  points      int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (event_id, round, num)
);

-- ---------------------------------------------------------------- updated_at

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists events_touch on public.events;
create trigger events_touch before update on public.events
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- row level security

alter table public.events           enable row level security;
alter table public.drivers          enable row level security;
alter table public.penalties        enable row level security;
alter table public.feed             enable row level security;
alter table public.results          enable row level security;
alter table public.registrations    enable row level security;
alter table public.driver_accounts  enable row level security;

-- driver_accounts gets no policy at all. RLS with zero policies denies everything to
-- anon and authenticated alike, which is exactly right: the hashes and tokens in there
-- are reachable only through the SECURITY DEFINER functions below.

-- Timing is public. An overlay in OBS carries the anon key and nothing else.
drop policy if exists events_read on public.events;
create policy events_read on public.events        for select using (true);
drop policy if exists drivers_read on public.drivers;
create policy drivers_read on public.drivers       for select using (true);
drop policy if exists pen_read on public.penalties;
create policy pen_read on public.penalties     for select using (true);
drop policy if exists feed_read on public.feed;
create policy feed_read on public.feed          for select using (true);
drop policy if exists results_read on public.results;
create policy results_read on public.results       for select using (true);

-- Writing is the operator's alone, and only inside events they own.
drop policy if exists events_own on public.events;
create policy events_own on public.events for all
  using (auth.uid() = owner) with check (auth.uid() = owner);

drop policy if exists drivers_own on public.drivers;
create policy drivers_own on public.drivers for all
  using (exists (select 1 from public.events e where e.id = event_id and e.owner = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner = auth.uid()));

drop policy if exists pen_own on public.penalties;
create policy pen_own on public.penalties for all
  using (exists (select 1 from public.events e where e.id = event_id and e.owner = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner = auth.uid()));

drop policy if exists feed_own on public.feed;
create policy feed_own on public.feed for all
  using (exists (select 1 from public.events e where e.id = event_id and e.owner = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner = auth.uid()));

drop policy if exists results_own on public.results;
create policy results_own on public.results for all
  using (exists (select 1 from public.events e where e.id = event_id and e.owner = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner = auth.uid()));

-- The queue is not public: it is a list of people who have asked to join, and publishing
-- it would tell every viewer who tried and was turned down.
drop policy if exists reg_own on public.registrations;
create policy reg_own on public.registrations for all
  using (exists (select 1 from public.events e where e.id = event_id and e.owner = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner = auth.uid()));

-- ---------------------------------------------------------------- table grants
--
-- Explicit, rather than leaning on the privileges a hosted Supabase project happens to
-- hand out by default. Two reasons: the migration then behaves the same on any Postgres,
-- and it puts a second lock under the policies. anon holds no INSERT or UPDATE on anything
-- at all, so a policy written wrongly still cannot be used to write.

grant select on public.events, public.drivers, public.penalties,
                public.feed, public.results to anon, authenticated;

grant insert, update, delete on
  public.events, public.drivers, public.penalties,
  public.feed, public.results, public.registrations to authenticated;

grant select on public.registrations to authenticated;

-- The admin key. It bypasses row level security by design, but grants are a separate
-- gate and it needs them too: without this the Supabase dashboard's own table editor
-- cannot write, and neither can any maintenance run outside a user session.
grant all on all tables in schema public to service_role;

-- driver_accounts is granted to nobody through the API roles. The definer functions own
-- it, and service_role above is the deliberate exception for administration.
--
-- Revoked explicitly rather than left to the platform's defaults for new tables in public.
-- Those defaults handed anon TRUNCATE on this table: not reachable through PostgREST, so
-- not an open door, but a role with no business here should not be able to empty every
-- driver account in the league either.
revoke all on public.driver_accounts from anon, authenticated;

-- The sign-in queue is the operator's, and only theirs. A hosted Supabase project grants
-- anon SELECT on every new table in public by default, which left this table protected by
-- its policy alone: the request succeeded and returned an empty array rather than being
-- refused. No rows leaked, but one careless permissive policy later and they would.
-- Drivers never read this table directly; they learn their own standing from driver_state.
revoke all on public.registrations from anon;

-- ---------------------------------------------------------------- driver sign in
--
-- An earlier version of this file defined driver_register and driver_login without a team.
-- Adding a defaulted parameter makes a new function rather than changing the old one, so
-- the old pair has to go: PostgREST picks a function by the parameter names in the request
-- body, and a phone naming code, nick, number and password matches both.
drop function if exists public.driver_register(text, text, text, text);
drop function if exists public.driver_login(text, text, text);

--
-- These run as the definer so they can reach driver_accounts, which nothing else can.
-- search_path is pinned on each one: without it a caller can put a schema of their own in
-- front and have a definer function call their code with the definer's rights.

create or replace function public.driver_register(
  p_code text, p_nick text, p_num text, p_password text, p_team text default ''
) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_event   public.events;
  v_account public.driver_accounts;
  v_token   uuid := gen_random_uuid();
  v_team    text := trim(coalesce(p_team, ''));
begin
  if length(coalesce(p_password, '')) < 4 then
    return json_build_object('ok', false, 'error', 'Password needs at least 4 characters');
  end if;
  if length(trim(coalesce(p_nick, ''))) = 0 then
    return json_build_object('ok', false, 'error', 'Type the name you race under');
  end if;

  select * into v_event from public.events where code = upper(trim(p_code));
  if not found then
    return json_build_object('ok', false, 'error', 'No event with that code');
  end if;

  select * into v_account from public.driver_accounts
    where event_id = v_event.id and num = trim(p_num);

  if found then
    -- The number is taken. The person who owns it may sign in again from a new phone;
    -- anybody else is turned away with the same wording as a wrong password, so the
    -- endpoint cannot be used to find out which numbers exist.
    if v_account.pass_hash <> crypt(p_password, v_account.pass_hash) then
      return json_build_object('ok', false, 'error', 'That number is already registered');
    end if;
    update public.driver_accounts
       set token = v_token, token_expires = now() + interval '30 days',
           nick = trim(p_nick),
           -- An empty box means "leave it as it is", not "I have no team". A driver
           -- rejoining from a new phone should not have to retype it to keep it.
           team = case when v_team <> '' then v_team else team end
     where id = v_account.id
     returning * into v_account;

    -- The queue and the grid have to follow the account. Renaming only the account left
    -- race control looking at the old name, and the car went onto the grid wearing it.
    update public.registrations set nick = trim(p_nick), team = v_account.team
     where account_id = v_account.id;
    update public.drivers set name = trim(p_nick), team = v_account.team
     where account_id = v_account.id;

    return json_build_object('ok', true, 'rejoined', true, 'token', v_token,
      'nick', trim(p_nick), 'num', v_account.num, 'team', v_account.team);
  end if;

  insert into public.driver_accounts (event_id, num, nick, team, pass_hash, token, token_expires)
  values (v_event.id, trim(p_num), trim(p_nick), v_team,
          crypt(p_password, gen_salt('bf', 10)), v_token, now() + interval '30 days')
  returning * into v_account;

  insert into public.registrations (event_id, account_id, nick, num, team)
  values (v_event.id, v_account.id, v_account.nick, v_account.num, v_account.team);

  return json_build_object('ok', true, 'rejoined', false, 'token', v_token,
    'nick', v_account.nick, 'num', v_account.num, 'team', v_account.team);
end $$;

create or replace function public.driver_login(
  p_code text, p_num text, p_password text, p_team text default null
) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_event   public.events;
  v_account public.driver_accounts;
  v_token   uuid := gen_random_uuid();
  v_team    text := trim(coalesce(p_team, ''));
begin
  select * into v_event from public.events where code = upper(trim(p_code));
  if not found then
    -- Same answer as a wrong password on purpose. A different one here would let anybody
    -- enumerate which event codes are live.
    return json_build_object('ok', false, 'error', 'Wrong number or password');
  end if;

  select * into v_account from public.driver_accounts
    where event_id = v_event.id and num = trim(p_num);
  if not found or v_account.pass_hash <> crypt(p_password, v_account.pass_hash) then
    return json_build_object('ok', false, 'error', 'Wrong number or password');
  end if;

  -- Signing in is also how a driver corrects their team between rounds, which is the only
  -- reason the field is on this screen at all. Blank changes nothing.
  update public.driver_accounts
     set token = v_token, token_expires = now() + interval '30 days',
         team = case when v_team <> '' then v_team else team end
   where id = v_account.id
   returning * into v_account;

  if v_team <> '' then
    update public.registrations set team = v_account.team where account_id = v_account.id;
    update public.drivers        set team = v_account.team where account_id = v_account.id;
  end if;

  return json_build_object('ok', true, 'token', v_token,
    'nick', v_account.nick, 'num', v_account.num, 'team', v_account.team);
end $$;

create or replace function public.driver_logout(p_token uuid)
returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  update public.driver_accounts set token = null, token_expires = null where token = p_token;
  return json_build_object('ok', true);
end $$;

-- Everything one driver's phone is allowed to know: the session flag, their own car, and
-- their own penalties. Nobody else's penalties, and no part of the sign-in queue beyond
-- their own standing in it.
create or replace function public.driver_state(p_token uuid)
returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_account public.driver_accounts;
  v_event   public.events;
  v_reg     public.registrations;
  v_driver  public.drivers;
begin
  select * into v_account from public.driver_accounts
    where token = p_token and token_expires > now();
  if not found then
    return json_build_object('ok', false, 'error', 'Signed out');
  end if;

  select * into v_event  from public.events where id = v_account.event_id;
  select * into v_reg    from public.registrations where account_id = v_account.id;
  select * into v_driver from public.drivers where id = v_reg.driver_id;

  return json_build_object(
    'ok', true,
    'driver', json_build_object('nick', v_account.nick, 'num', v_account.num,
                                'team', v_account.team),
    'status', coalesce(v_reg.status, 'pending'),
    'flag', v_event.status,
    'event', json_build_object('name', v_event.name, 'round', v_event.round,
                               'session', v_event.session_label),
    'me', case when v_driver.id is null then null else json_build_object(
      'position', v_driver.position, 'lapsDone', v_driver.laps_done,
      'lastLap', v_driver.last_lap, 'bestLap', v_driver.best_lap,
      'pit', v_driver.pit, 'blueFlag', v_driver.blue_flag,
      'blackFlag', exists (
        select 1 from public.penalties p
         where p.driver_id = v_driver.id and p.status = 'applied'
           and p.type in ('blackflag','dq') and not p.served)
    ) end,
    'penalties', coalesce((
      select json_agg(json_build_object(
               'id', p.id, 'type', p.type, 'seconds', p.seconds, 'reason', p.reason,
               'lap', p.lap, 'status', p.status, 'served', p.served,
               'at', extract(epoch from p.created_at) * 1000,
               -- The headline and the reason, never a sentence built from both. There is
               -- already one composer, in the timing code, and a second here drifted from
               -- it within a day: this function joined them with a hyphen while the tower
               -- used an em dash, so a driver's phone and the broadcast disagreed about
               -- the wording of the same penalty.
               'headline', public.penalty_headline(p.type, p.seconds))
               order by p.created_at desc)
        from public.penalties p
       where p.driver_id = v_driver.id), '[]'::json)
  );
end $$;

-- One source for the wording, so the phone, the tower and the steward's screen are quoting
-- the same sentence.
create or replace function public.penalty_headline(p_type text, p_seconds int)
returns text language sql immutable set search_path = public, extensions, pg_temp as $$
  select case p_type
    when 'time'         then '+' || p_seconds || 's PENALTY'
    when 'blackflag'    then 'BLACK FLAG'
    when 'drivethrough' then 'DRIVE THROUGH'
    when 'dq'           then 'DISQUALIFIED'
    when 'warning'      then 'WARNING'
    else 'NOTE'
  end $$;

-- Approving a sign-in is what puts a car on the grid, so it is one statement rather than
-- three round trips the operator could be interrupted in the middle of.
create or replace function public.approve_registration(p_registration uuid)
returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_reg    public.registrations;
  v_event  public.events;
  v_driver public.drivers;
begin
  select * into v_reg from public.registrations where id = p_registration;
  if not found then
    return json_build_object('ok', false, 'error', 'No such sign-in');
  end if;

  select * into v_event from public.events where id = v_reg.event_id;
  if v_event.owner <> auth.uid() then
    return json_build_object('ok', false, 'error', 'Not your event');
  end if;

  -- A car already wearing that number is adopted rather than duplicated: race control may
  -- have entered the grid by hand before anybody signed in.
  select * into v_driver from public.drivers
   where event_id = v_reg.event_id and num = v_reg.num;

  if not found then
    insert into public.drivers (event_id, account_id, num, name, team)
    values (v_reg.event_id, v_reg.account_id, v_reg.num, v_reg.nick, v_reg.team)
    returning * into v_driver;
  else
    -- A driver who left the box empty must not wipe a team the operator typed in.
    update public.drivers
       set account_id = v_reg.account_id, name = v_reg.nick,
           team = case when v_reg.team <> '' then v_reg.team else team end
     where id = v_driver.id returning * into v_driver;
  end if;

  update public.registrations set status = 'approved', driver_id = v_driver.id
   where id = v_reg.id;

  return json_build_object('ok', true, 'driver_id', v_driver.id);
end $$;

-- The anon key may call the driver functions. It may not call anything else here, and it
-- has no reach into driver_accounts by any other route.
revoke all on function public.driver_register(text, text, text, text, text) from public;
revoke all on function public.driver_login(text, text, text, text)          from public;
revoke all on function public.driver_logout(uuid)                     from public;
revoke all on function public.driver_state(uuid)                      from public;
revoke all on function public.approve_registration(uuid)              from public;

grant execute on function public.driver_register(text, text, text, text, text) to anon, authenticated;
grant execute on function public.driver_login(text, text, text, text)          to anon, authenticated;
grant execute on function public.driver_logout(uuid)                     to anon, authenticated;
grant execute on function public.driver_state(uuid)                      to anon, authenticated;
grant execute on function public.approve_registration(uuid)              to authenticated;

-- ---------------------------------------------------------------- realtime
--
-- Change driven, with no heartbeat anywhere in it. The old server pushed the entire state
-- once a second while racing; ported straight across that is roughly 1.26 GB of egress for
-- a two hour event, and the free plan allows 5 GB a month. Sending only what actually
-- changed puts the same event closer to 4 MB. The running clock and the predicted running
-- order are arithmetic every client can do for itself from the last change and its own
-- wall clock.

do $pub$ begin
  alter publication supabase_realtime add table public.events;
exception when duplicate_object then null;
end $pub$;
do $pub$ begin
  alter publication supabase_realtime add table public.drivers;
exception when duplicate_object then null;
end $pub$;
do $pub$ begin
  alter publication supabase_realtime add table public.penalties;
exception when duplicate_object then null;
end $pub$;
do $pub$ begin
  alter publication supabase_realtime add table public.feed;
exception when duplicate_object then null;
end $pub$;
do $pub$ begin
  alter publication supabase_realtime add table public.registrations;
exception when duplicate_object then null;
end $pub$;
