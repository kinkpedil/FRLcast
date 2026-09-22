-- Team radio.
--
-- A driver types a message on the phone — the classic "BOX BOX BOX" from the driver coming
-- in to the one still on track — and every teammate sees it on their floating window, while
-- the broadcast overlay puts it on air. Two audiences, one row.
--
-- It is not private from the audience: the overlay shows it to everyone watching. So anon
-- may read the table (that is the same trust level as the timing already on screen), but
-- nobody may write to it directly — a message only enters through driver_radio, which checks
-- the token and stamps the sender's own team on it. The same-team routing that decides which
-- driver is notified happens in driver_state, not here.

create table if not exists public.team_radio (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  team       text not null default '',
  from_nick  text not null default '',
  from_num   text not null default '',
  text       text not null,
  created_at timestamptz not null default now()
);

create index if not exists team_radio_event_idx on public.team_radio (event_id, created_at desc);

alter table public.team_radio enable row level security;

-- Read is public (the overlay is anon and broadcasts these anyway). No insert/update/delete
-- policy at all: without one, RLS denies direct writes, and the only way in is the definer
-- function below.
do $p$ begin
  create policy team_radio_select on public.team_radio for select to anon, authenticated using (true);
exception when duplicate_object then null; end $p$;

-- Realtime, so a message reaches the overlay the instant it is sent.
do $pub$ begin
  alter publication supabase_realtime add table public.team_radio;
exception when duplicate_object then null; end $pub$;

-- Send a message to your own team.
create or replace function public.driver_radio(p_token uuid, p_text text)
returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_account public.driver_accounts;
  v_text    text := trim(coalesce(p_text, ''));
begin
  if v_text = '' then
    return json_build_object('ok', false, 'error', 'Empty message');
  end if;
  select * into v_account from public.driver_accounts
    where token = p_token and token_expires > now();
  if not found then
    return json_build_object('ok', false, 'error', 'Signed out');
  end if;
  if coalesce(v_account.team, '') = '' then
    return json_build_object('ok', false, 'error', 'You are not on a team yet');
  end if;
  insert into public.team_radio (event_id, team, from_nick, from_num, text)
  values (v_account.event_id, v_account.team, v_account.nick, v_account.num, left(v_text, 120));
  return json_build_object('ok', true);
end $$;

revoke all on function public.driver_radio(uuid, text) from public;
grant execute on function public.driver_radio(uuid, text) to anon, authenticated;

-- driver_state gains two fields: the driver's team at the top level (the app shows the radio
-- box only with one), and the latest message for that team while it is still fresh. Same 2
-- minute window the laptop server uses, so a driver opening the app mid-stint is not shown a
-- pit call that was answered ten minutes ago. The rest of the body is unchanged.
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
    'team', v_account.team,
    'radio', (
      select json_build_object(
               'id', tr.id, 'from', tr.from_nick, 'num', tr.from_num,
               'team', tr.team, 'text', tr.text,
               'at', extract(epoch from tr.created_at) * 1000)
        from public.team_radio tr
       where tr.event_id = v_account.event_id
         and tr.team = v_account.team
         and tr.created_at > now() - interval '120 seconds'
       order by tr.created_at desc
       limit 1
    ),
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
