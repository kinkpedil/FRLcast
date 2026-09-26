-- League features for the driver app and the public entry list (2026-09-25).
--
--   1. Pit board: driver_state gains the cars directly ahead and behind (with the gap to each),
--      the gap to the leader and the laps left.
--   2. Incident reports: a driver reports a car from the app; race control sees a queue.
--   3. Entry list and check-in: drivers register from a public page before race day, the
--      list of entries is public, and signing in on race day checks a driver in.
--
-- Also restores team radio in driver_state. The playerid migration rewrote driver_state
-- without the `radio` and `team` fields the radio migration had added, so on a project where
-- both were applied in order the phones stopped receiving team radio from a hosted event.
--
-- Safe to run more than once, and safe whether or not 20260917000000_playerid.sql was applied
-- first: everything it added is (re)declared here.

-- ---------------------------------------------------------------- columns

alter table public.driver_accounts add column if not exists game_id text not null default '';
alter table public.drivers          add column if not exists game_id text not null default '';
alter table public.registrations    add column if not exists game_id text not null default '';
-- When the driver last signed in from the app: the race-day check-in.
alter table public.registrations    add column if not exists checked_in_at timestamptz;

-- ---------------------------------------------------------------- incident reports

create table if not exists public.incident_reports (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  account_id  uuid references public.driver_accounts (id) on delete set null,
  from_nick   text not null default '',
  from_num    text not null default '',
  against_num text not null default '',
  lap         int,
  text        text not null,
  status      text not null default 'open',
  created_at  timestamptz not null default now(),
  constraint incident_status_known check (status in ('open', 'reviewed', 'dismissed'))
);

create index if not exists incident_reports_event_idx
  on public.incident_reports (event_id, created_at desc);

alter table public.incident_reports enable row level security;

-- The operator's alone, like the sign-in queue: a report names two drivers and an accusation,
-- which is race control's business and not the audience's. Drivers write through
-- driver_report below and never read the table.
drop policy if exists incident_own on public.incident_reports;
create policy incident_own on public.incident_reports for all
  using (exists (select 1 from public.events e where e.id = event_id and e.owner = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner = auth.uid()));

revoke all on public.incident_reports from anon;
grant select, update, delete on public.incident_reports to authenticated;
grant all on public.incident_reports to service_role;

-- ---------------------------------------------------------------- driver sign in
--
-- Redeclared in full (identical to the playerid migration, plus the check-in), so this file
-- works on a project that never ran that one. The older signatures are dropped first, as the
-- playerid migration did: PostgREST picks a function by the parameter names in the request,
-- and two candidates for one request is an error.
drop function if exists public.driver_register(text, text, text, text, text);
drop function if exists public.driver_login(text, text, text, text);

create or replace function public.driver_register(
  p_code text, p_nick text, p_num text, p_password text,
  p_team text default '', p_game_id text default ''
) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_event   public.events;
  v_account public.driver_accounts;
  v_token   uuid := gen_random_uuid();
  v_team    text := trim(coalesce(p_team, ''));
  v_game    text := trim(coalesce(p_game_id, ''));
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
    if v_account.pass_hash <> crypt(p_password, v_account.pass_hash) then
      return json_build_object('ok', false, 'error', 'That number is already registered');
    end if;
    update public.driver_accounts
       set token = v_token, token_expires = now() + interval '30 days',
           nick = trim(p_nick),
           team    = case when v_team <> '' then v_team else team end,
           game_id = case when v_game <> '' then v_game else game_id end
     where id = v_account.id
     returning * into v_account;

    -- Signing up again from the app on race day is being here: that is the check-in.
    update public.registrations
       set nick = trim(p_nick), team = v_account.team, game_id = v_account.game_id,
           checked_in_at = now()
     where account_id = v_account.id;
    update public.drivers set name = trim(p_nick), team = v_account.team, game_id = v_account.game_id
     where account_id = v_account.id;

    return json_build_object('ok', true, 'rejoined', true, 'token', v_token,
      'nick', trim(p_nick), 'num', v_account.num, 'team', v_account.team, 'gameId', v_account.game_id);
  end if;

  insert into public.driver_accounts (event_id, num, nick, team, game_id, pass_hash, token, token_expires)
  values (v_event.id, trim(p_num), trim(p_nick), v_team, v_game,
          crypt(p_password, gen_salt('bf', 10)), v_token, now() + interval '30 days')
  returning * into v_account;

  -- Registering from the app is done at the track, so it counts as checked in. The public
  -- entry page registers ahead of race day through event_join, which clears this again.
  insert into public.registrations (event_id, account_id, nick, num, team, game_id, checked_in_at)
  values (v_event.id, v_account.id, v_account.nick, v_account.num, v_account.team, v_account.game_id, now());

  return json_build_object('ok', true, 'rejoined', false, 'token', v_token,
    'nick', v_account.nick, 'num', v_account.num, 'team', v_account.team, 'gameId', v_account.game_id);
end $$;

create or replace function public.driver_login(
  p_code text, p_num text, p_password text, p_team text default null, p_game_id text default null
) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_event   public.events;
  v_account public.driver_accounts;
  v_token   uuid := gen_random_uuid();
  v_team    text := trim(coalesce(p_team, ''));
  v_game    text := trim(coalesce(p_game_id, ''));
begin
  select * into v_event from public.events where code = upper(trim(p_code));
  if not found then
    return json_build_object('ok', false, 'error', 'Wrong number or password');
  end if;

  select * into v_account from public.driver_accounts
    where event_id = v_event.id and num = trim(p_num);
  if not found or v_account.pass_hash <> crypt(p_password, v_account.pass_hash) then
    return json_build_object('ok', false, 'error', 'Wrong number or password');
  end if;

  update public.driver_accounts
     set token = v_token, token_expires = now() + interval '30 days',
         team    = case when v_team <> '' then v_team else team end,
         game_id = case when v_game <> '' then v_game else game_id end
   where id = v_account.id
   returning * into v_account;

  -- Signing in on the phone is the race-day check-in.
  update public.registrations
     set team = v_account.team, game_id = v_account.game_id, checked_in_at = now()
   where account_id = v_account.id;
  if v_team <> '' or v_game <> '' then
    update public.drivers set team = v_account.team, game_id = v_account.game_id where account_id = v_account.id;
  end if;

  return json_build_object('ok', true, 'token', v_token,
    'nick', v_account.nick, 'num', v_account.num, 'team', v_account.team, 'gameId', v_account.game_id);
end $$;

revoke all on function public.driver_register(text, text, text, text, text, text) from public;
revoke all on function public.driver_login(text, text, text, text, text)          from public;
grant execute on function public.driver_register(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.driver_login(text, text, text, text, text)          to anon, authenticated;

-- ---------------------------------------------------------------- the public entry page

-- Register ahead of race day, from the website. Same rules and the same account as the app,
-- so the driver later signs in on their phone with this number and password. Not a check-in:
-- a driver entering on Tuesday is not at the track yet.
create or replace function public.event_join(
  p_code text, p_nick text, p_num text, p_password text, p_team text default ''
) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_res json;
begin
  v_res := public.driver_register(p_code, p_nick, p_num, p_password, p_team, '');
  if (v_res ->> 'ok')::boolean and not (v_res ->> 'rejoined')::boolean then
    update public.registrations r set checked_in_at = null
      from public.driver_accounts a
     where a.id = r.account_id and a.token = (v_res ->> 'token')::uuid;
  end if;
  -- The website has no use for a session token; it is not handed out.
  return json_build_object('ok', (v_res ->> 'ok')::boolean, 'error', v_res ->> 'error',
    'rejoined', coalesce((v_res ->> 'rejoined')::boolean, false),
    'nick', v_res ->> 'nick', 'num', v_res ->> 'num', 'team', v_res ->> 'team');
end $$;

-- Check in from the website without touching the phone's session (driver_login would issue a
-- new token and sign the phone out).
create or replace function public.event_checkin(p_code text, p_num text, p_password text)
returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_event   public.events;
  v_account public.driver_accounts;
begin
  select * into v_event from public.events where code = upper(trim(p_code));
  if not found then
    return json_build_object('ok', false, 'error', 'Wrong number or password');
  end if;
  select * into v_account from public.driver_accounts
    where event_id = v_event.id and num = trim(p_num);
  if not found or v_account.pass_hash <> crypt(p_password, v_account.pass_hash) then
    return json_build_object('ok', false, 'error', 'Wrong number or password');
  end if;
  update public.registrations set checked_in_at = now() where account_id = v_account.id;
  return json_build_object('ok', true, 'nick', v_account.nick, 'num', v_account.num);
end $$;

-- The entry list: who is in, with no secrets and no refused sign-ins (publishing those would
-- tell every visitor who tried and was turned down). "Checked in" means within 18 hours, so a
-- weekly league reusing one event code starts every race day with nobody checked in.
create or replace function public.event_entries(p_code text)
returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_event public.events;
begin
  select * into v_event from public.events where code = upper(trim(p_code));
  if not found then
    return json_build_object('ok', false, 'error', 'No event with that code');
  end if;
  return json_build_object(
    'ok', true,
    'event', json_build_object('code', v_event.code, 'name', v_event.name,
                               'round', v_event.round, 'track', v_event.track),
    'entries', coalesce((
      select json_agg(json_build_object(
               'nick', r.nick, 'num', r.num, 'team', r.team, 'status', r.status,
               'checkedIn', r.checked_in_at is not null and r.checked_in_at > now() - interval '18 hours')
               order by r.created_at)
        from public.registrations r
       where r.event_id = v_event.id and r.status <> 'rejected'), '[]'::json)
  );
end $$;

revoke all on function public.event_join(text, text, text, text, text) from public;
revoke all on function public.event_checkin(text, text, text)           from public;
revoke all on function public.event_entries(text)                       from public;
grant execute on function public.event_join(text, text, text, text, text) to anon, authenticated;
grant execute on function public.event_checkin(text, text, text)           to anon, authenticated;
grant execute on function public.event_entries(text)                       to anon, authenticated;

-- ---------------------------------------------------------------- reporting an incident

create or replace function public.driver_report(p_token uuid, p_against text, p_text text)
returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_account public.driver_accounts;
  v_reg     public.registrations;
  v_driver  public.drivers;
  v_text    text := left(trim(coalesce(p_text, '')), 280);
  v_recent  int;
begin
  if v_text = '' then
    return json_build_object('ok', false, 'error', 'Say what happened');
  end if;
  select * into v_account from public.driver_accounts
    where token = p_token and token_expires > now();
  if not found then
    return json_build_object('ok', false, 'error', 'Signed out');
  end if;
  -- A heated driver should not be able to bury the queue.
  select count(*) into v_recent from public.incident_reports
    where account_id = v_account.id and created_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    return json_build_object('ok', false, 'error', 'Too many reports. Wait a few minutes.');
  end if;
  select * into v_reg    from public.registrations where account_id = v_account.id;
  select * into v_driver from public.drivers where id = v_reg.driver_id;
  insert into public.incident_reports (event_id, account_id, from_nick, from_num, against_num, lap, text)
  values (v_account.event_id, v_account.id, v_account.nick, v_account.num,
          left(trim(coalesce(p_against, '')), 6), v_driver.laps_done, v_text);
  return json_build_object('ok', true);
end $$;

revoke all on function public.driver_report(uuid, text, text) from public;
grant execute on function public.driver_report(uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------- what the phone sees

create or replace function public.driver_state(p_token uuid)
returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_account public.driver_accounts;
  v_event   public.events;
  v_reg     public.registrations;
  v_driver  public.drivers;
  v_best    boolean;
  v_timed   boolean;
begin
  select * into v_account from public.driver_accounts
    where token = p_token and token_expires > now();
  if not found then
    return json_build_object('ok', false, 'error', 'Signed out');
  end if;

  select * into v_event  from public.events where id = v_account.event_id;
  select * into v_reg    from public.registrations where account_id = v_account.id;
  select * into v_driver from public.drivers where id = v_reg.driver_id;
  -- A best-lap session measures gaps in lap time; a race measures them on the road.
  v_best  := v_event.session_type in ('qualifying', 'practice');
  -- A time race (endurance) has no laps left; the session type decides, not a leftover limit.
  v_timed := v_event.session_type = 'endurance';

  return json_build_object(
    'ok', true,
    'driver', json_build_object('nick', v_account.nick, 'num', v_account.num,
                                'team', v_account.team, 'gameId', v_account.game_id),
    'team', v_account.team,
    'radio', (
      select json_build_object(
               'id', tr.id, 'from', tr.from_nick, 'num', tr.from_num,
               'team', tr.team, 'text', tr.text,
               'at', extract(epoch from tr.created_at) * 1000)
        from public.team_radio tr
       where tr.event_id = v_account.event_id
         and tr.team = v_account.team
         and v_account.team <> ''
         and tr.created_at > now() - interval '120 seconds'
       order by tr.created_at desc
       limit 1
    ),
    'status', coalesce(v_reg.status, 'pending'),
    'checkedIn', v_reg.checked_in_at is not null and v_reg.checked_in_at > now() - interval '18 hours',
    'flag', v_event.status,
    'event', json_build_object('name', v_event.name, 'round', v_event.round,
                               'session', v_event.session_label),
    'me', case when v_driver.id is null then null else json_build_object(
      'position', v_driver.position, 'lapsDone', v_driver.laps_done,
      'lastLap', v_driver.last_lap, 'bestLap', v_driver.best_lap,
      'pit', v_driver.pit, 'blueFlag', v_driver.blue_flag, 'dnf', v_driver.dnf,
      'blackFlag', exists (
        select 1 from public.penalties p
         where p.driver_id = v_driver.id and p.status = 'applied'
           and p.type in ('blackflag', 'dq') and not p.served),
      -- The pit board.
      'cars', (select count(*) from public.drivers x where x.event_id = v_event.id),
      'session', v_event.session_type,
      'totalLaps', v_event.total_laps,
      'lapsLeft', case when v_event.total_laps > 0 and not v_timed and not v_best
                       then greatest(0, v_event.total_laps - v_driver.laps_done) end,
      'gapMs', case when v_driver.position > 1 then (
        case when v_best then v_driver.best_lap - (select l.best_lap from public.drivers l
                                                    where l.event_id = v_event.id and l.position = 1 limit 1)
             else v_driver.gap_ms end) end,
      'ahead', (
        select json_build_object('num', a.num, 'name', a.name, 'dnf', a.dnf,
                 'gapMs', case when v_best then v_driver.best_lap - a.best_lap
                               when a.laps_done = v_driver.laps_done then v_driver.gap_ms - a.gap_ms end,
                 'gapLaps', case when v_best then 0 else greatest(0, a.laps_done - v_driver.laps_done) end)
          from public.drivers a
         where a.event_id = v_event.id and a.position = v_driver.position - 1
         limit 1),
      'behind', (
        select json_build_object('num', b.num, 'name', b.name, 'dnf', b.dnf,
                 'gapMs', case when v_best then b.best_lap - v_driver.best_lap
                               when b.laps_done = v_driver.laps_done then b.gap_ms - v_driver.gap_ms end,
                 'gapLaps', case when v_best then 0 else greatest(0, v_driver.laps_done - b.laps_done) end)
          from public.drivers b
         where b.event_id = v_event.id and b.position = v_driver.position + 1
         limit 1)
    ) end,
    'penalties', coalesce((
      select json_agg(json_build_object(
               'id', p.id, 'type', p.type, 'seconds', p.seconds, 'reason', p.reason,
               'lap', p.lap, 'status', p.status, 'served', p.served,
               'at', extract(epoch from p.created_at) * 1000,
               'headline', public.penalty_headline(p.type, p.seconds))
               order by p.created_at desc)
        from public.penalties p
       where p.driver_id = v_driver.id), '[]'::json)
  );
end $$;

revoke all on function public.driver_state(uuid) from public;
grant execute on function public.driver_state(uuid) to anon, authenticated;
