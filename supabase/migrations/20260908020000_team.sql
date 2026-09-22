-- The team a driver races for, carried from their phone to the timing screen.
--
-- Teams were something the operator typed into the console for every car, from a list they
-- had to keep somewhere else. The driver already knows which team they are in, and they are
-- already typing their name and number, so this asks them once and puts it on the grid when
-- the sign-in is accepted.
--
-- Safe to run again, and safe to run before or after the schema it extends.

alter table public.driver_accounts add column if not exists team text not null default '';
alter table public.registrations   add column if not exists team text not null default '';

-- The old signatures have to go, not merely be replaced.
--
-- Adding a defaulted parameter makes a new function rather than changing the old one, and
-- PostgREST picks a function by the names in the request body. A phone sending code, nick,
-- number and password would match the four argument version exactly and the five argument
-- one by its default, which is ambiguous and fails outright. Dropping them first also keeps
-- an old APK working: it sends four arguments, and the new function takes them.
drop function if exists public.driver_register(text, text, text, text);
drop function if exists public.driver_login(text, text, text);

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

-- The phone shows the team back, so a driver can see the operator has the right one.
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

-- Accepting a sign-in is what puts the team on the car.
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

-- The new signatures need their own grants: the ones on the dropped functions went with
-- them, and a function nobody may execute is a sign-in screen that always fails.
revoke all on function public.driver_register(text, text, text, text, text) from public;
revoke all on function public.driver_login(text, text, text, text)          from public;

grant execute on function public.driver_register(text, text, text, text, text) to anon, authenticated;
grant execute on function public.driver_login(text, text, text, text)          to anon, authenticated;
