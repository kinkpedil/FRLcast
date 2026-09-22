-- FR Legends player ID, end to end.
--
-- FR Legends 0.4.9 adds an official Tournament Timing API. It has no race numbers: the game
-- has no such concept. What it does have is a stable, unique player ID per account, and iiley
-- (the developer) confirmed that is the reliable key to join a timing row to a driver. Names
-- collide; player IDs do not.
--
-- So the grid needs somewhere to hold that ID. This migration threads a `game_id` from the
-- point a driver signs in on their phone through to the drivers row race control watches, so
-- the API poller can later match a timing entry to the right car by player ID alone.
--
-- It is captured, not required: the game may not surface the ID to every player, and the
-- Android app in the field predates this column, so every path defaults it to '' and nothing
-- breaks when it is absent. An operator can also fill it later from the Supabase table editor.

alter table public.driver_accounts add column if not exists game_id text not null default '';
alter table public.drivers          add column if not exists game_id text not null default '';
alter table public.registrations    add column if not exists game_id text not null default '';

-- ---------------------------------------------------------------- driver sign in
--
-- Adding a defaulted parameter makes a new function rather than changing the old one, and
-- PostgREST picks a function by the parameter names in the request body. The previous
-- signatures (added by the team migration) have to go, exactly as that migration dropped the
-- ones before it, or a phone's request body would match two candidates.
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
    -- The number is taken. Same wording as a wrong password for anybody who is not the owner,
    -- so the endpoint cannot be used to find out which numbers exist.
    if v_account.pass_hash <> crypt(p_password, v_account.pass_hash) then
      return json_build_object('ok', false, 'error', 'That number is already registered');
    end if;
    update public.driver_accounts
       set token = v_token, token_expires = now() + interval '30 days',
           nick = trim(p_nick),
           -- An empty box means "leave it as it is", not "clear it". A driver rejoining from a
           -- new phone should keep the team and player ID they already had.
           team    = case when v_team <> '' then v_team else team end,
           game_id = case when v_game <> '' then v_game else game_id end
     where id = v_account.id
     returning * into v_account;

    update public.registrations set nick = trim(p_nick), team = v_account.team, game_id = v_account.game_id
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

  insert into public.registrations (event_id, account_id, nick, num, team, game_id)
  values (v_event.id, v_account.id, v_account.nick, v_account.num, v_account.team, v_account.game_id);

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

  -- Signing in is also how a driver corrects their team or player ID between rounds. Blank
  -- changes nothing, so an old app that never sends these leaves both untouched.
  update public.driver_accounts
     set token = v_token, token_expires = now() + interval '30 days',
         team    = case when v_team <> '' then v_team else team end,
         game_id = case when v_game <> '' then v_game else game_id end
   where id = v_account.id
   returning * into v_account;

  if v_team <> '' or v_game <> '' then
    update public.registrations set team = v_account.team, game_id = v_account.game_id where account_id = v_account.id;
    update public.drivers        set team = v_account.team, game_id = v_account.game_id where account_id = v_account.id;
  end if;

  return json_build_object('ok', true, 'token', v_token,
    'nick', v_account.nick, 'num', v_account.num, 'team', v_account.team, 'gameId', v_account.game_id);
end $$;

-- driver_state gains the player ID so the phone can show a driver what ID race control has on
-- file for them, which is how a wrong one gets noticed and corrected.
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
                                'team', v_account.team, 'gameId', v_account.game_id),
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
               'headline', public.penalty_headline(p.type, p.seconds))
               order by p.created_at desc)
        from public.penalties p
       where p.driver_id = v_driver.id), '[]'::json)
  );
end $$;

-- Approving a sign-in carries the player ID onto the grid, so a car entered by hand and later
-- adopted still ends up with whatever ID the driver typed.
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

  select * into v_driver from public.drivers
   where event_id = v_reg.event_id and num = v_reg.num;

  if not found then
    insert into public.drivers (event_id, account_id, num, name, team, game_id)
    values (v_reg.event_id, v_reg.account_id, v_reg.num, v_reg.nick, v_reg.team, v_reg.game_id)
    returning * into v_driver;
  else
    update public.drivers
       set account_id = v_reg.account_id, name = v_reg.nick,
           team    = case when v_reg.team <> ''    then v_reg.team    else team end,
           game_id = case when v_reg.game_id <> '' then v_reg.game_id else game_id end
     where id = v_driver.id returning * into v_driver;
  end if;

  update public.registrations set status = 'approved', driver_id = v_driver.id
   where id = v_reg.id;

  return json_build_object('ok', true, 'driver_id', v_driver.id);
end $$;

-- Grants match the init migration, updated for the new signatures. anon may call the driver
-- functions and nothing else here.
revoke all on function public.driver_register(text, text, text, text, text, text) from public;
revoke all on function public.driver_login(text, text, text, text, text)          from public;

grant execute on function public.driver_register(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.driver_login(text, text, text, text, text)          to anon, authenticated;
