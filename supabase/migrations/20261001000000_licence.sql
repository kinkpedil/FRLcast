-- Licence points on the driver's phone (2026-10-01).
--
-- The console keeps each driver's licence in the event's settings blob, keyed by driver id,
-- the same way it already keeps the operator's notes to each phone. This only teaches
-- driver_state to hand that entry back. Nothing else changes, no table, no column, and the
-- function body is otherwise the batch2 version, so re-running it is harmless.
--
-- Sessions (same day): a race night runs practice, qualifying and the race in one event,
-- and the console stamps settings.sessionEpoch (epoch ms) each time it moves to the next
-- session. The black flag and the drive-through countdown on the phone only look at
-- penalties issued after it, so a practice decision does not follow a driver into the race.
-- No epoch (an older event) means every penalty counts, as before.

create or replace function public.driver_state(p_token uuid)
returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_account   public.driver_accounts;
  v_event     public.events;
  v_reg       public.registrations;
  v_driver    public.drivers;
  v_best      boolean;
  v_timed     boolean;
  v_limit     bigint;
  v_paused    bigint;
  v_time_left bigint;
  v_unserved  int;
  v_serve     int;
  v_epoch     timestamptz;
begin
  select * into v_account from public.driver_accounts
    where token = p_token and token_expires > now();
  if not found then
    return json_build_object('ok', false, 'error', 'Signed out');
  end if;

  select * into v_event  from public.events where id = v_account.event_id;
  select * into v_reg    from public.registrations where account_id = v_account.id;
  select * into v_driver from public.drivers where id = v_reg.driver_id;
  v_best  := v_event.session_type in ('qualifying', 'practice');
  v_epoch := case when coalesce(v_event.settings->>'sessionEpoch', '') ~ '^[0-9]+$'
                  then to_timestamp((v_event.settings->>'sessionEpoch')::bigint / 1000.0) end;
  v_timed := v_event.session_type = 'endurance';

  -- Endurance time remaining (ms), from the green-flag stamp minus any red-flag pauses.
  v_time_left := null;
  if v_timed then
    v_limit := coalesce((v_event.settings->>'timeLimitSec')::bigint, 0) * 1000;
    if v_limit > 0 and v_event.started_at is not null then
      v_paused := coalesce(v_event.paused_total, 0)
                + case when v_event.paused_at is not null
                       then (extract(epoch from (now() - v_event.paused_at)) * 1000)::bigint
                       else 0 end;
      v_time_left := greatest(0, v_limit
                     - ((extract(epoch from (now() - v_event.started_at)) * 1000)::bigint - v_paused));
    end if;
  end if;

  -- Laps to serve a drive-through before it escalates to a black flag (null when off / none).
  v_serve := null;
  v_unserved := coalesce((v_event.settings->'rules'->>'blackFlagUnserved')::int, 0);
  if v_unserved > 0 and v_driver.id is not null then
    select min(greatest(0, v_unserved - (v_driver.laps_done - coalesce(p.lap, 0))))
      into v_serve
      from public.penalties p
     where p.driver_id = v_driver.id and p.type = 'drivethrough'
       and p.status = 'applied' and not p.served
       and (v_epoch is null or p.created_at >= v_epoch);
  end if;

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
           and p.type in ('blackflag', 'dq') and not p.served
           and (v_epoch is null or p.created_at >= v_epoch)),
      'cars', (select count(*) from public.drivers x where x.event_id = v_event.id),
      'session', v_event.session_type,
      'totalLaps', v_event.total_laps,
      'pitOpen', coalesce((v_event.settings->>'pitOpen')::boolean, true),
      'timeLeftMs', v_time_left,
      'serveInLaps', v_serve,
      -- A note race control pushed to this phone, and the start-light gantry (0..6).
      'message', coalesce(v_event.settings->'messages'->v_driver.id::text->>'text', ''),
      'lights', coalesce((v_event.settings->>'lights')::int, 0),
      -- Licence points (null when the league has them off): points, pending, threshold, banned.
      'licence', v_event.settings->'licence'->v_driver.id::text,
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
