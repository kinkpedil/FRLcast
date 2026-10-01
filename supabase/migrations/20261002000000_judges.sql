-- Drift judges on their phones (2026-10-02).
--
-- A judge opens /judge?event=CODE&j=N&k=KEY and calls battles or scores qualifying runs.
-- The phone is not signed in, so it cannot write to the event: judge_submit checks the key
-- and files the call in judge_inputs, and race control (the hosted console, or the desktop
-- app through its online link) reads new rows and applies them.
--
-- The key lives in its own table that only the event's owner can read. It is not kept in
-- events.settings, which the overlays read without signing in.
--
-- Safe to re-run: every object is created if missing or replaced.

create table if not exists public.event_judge_keys (
  event_id    uuid primary key references public.events (id) on delete cascade,
  key         text not null,
  updated_at  timestamptz not null default now()
);
alter table public.event_judge_keys enable row level security;
drop policy if exists event_judge_keys_owner on public.event_judge_keys;
create policy event_judge_keys_owner on public.event_judge_keys for all
  using (exists (select 1 from public.events e where e.id = event_id and e.owner = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner = auth.uid()));
grant select, insert, update, delete on public.event_judge_keys to authenticated;

create table if not exists public.judge_inputs (
  id          bigserial primary key,
  event_id    uuid not null references public.events (id) on delete cascade,
  judge       int not null check (judge between 1 and 9),
  kind        text not null check (kind in ('vote', 'score', 'ping')),
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists judge_inputs_event_idx on public.judge_inputs (event_id, id);
alter table public.judge_inputs enable row level security;
drop policy if exists judge_inputs_owner_read on public.judge_inputs;
create policy judge_inputs_owner_read on public.judge_inputs for select
  using (exists (select 1 from public.events e where e.id = event_id and e.owner = auth.uid()));
grant select on public.judge_inputs to authenticated;

create or replace function public.judge_submit(
  p_code text, p_key text, p_judge int, p_kind text, p_payload jsonb default '{}'::jsonb)
returns json
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_event public.events;
  v_key   text;
  v_recent int;
begin
  select * into v_event from public.events where upper(code) = upper(trim(coalesce(p_code, '')));
  if not found then
    return json_build_object('ok', false, 'error', 'No event with that code');
  end if;
  select key into v_key from public.event_judge_keys where event_id = v_event.id;
  if v_key is null or upper(coalesce(p_key, '')) <> upper(v_key) then
    return json_build_object('ok', false, 'error', 'This judge link is no longer valid. Ask race control for a new one.');
  end if;
  if p_judge is null or p_judge < 1 or p_judge > 9 then
    return json_build_object('ok', false, 'error', 'Unknown judge');
  end if;
  if p_kind not in ('vote', 'score', 'ping') then
    return json_build_object('ok', false, 'error', 'Unknown call');
  end if;
  if p_kind = 'vote' and coalesce(p_payload->>'vote', '') not in ('a', 'b', 'omt') then
    return json_build_object('ok', false, 'error', 'Unknown vote');
  end if;
  select count(*) into v_recent from public.judge_inputs
   where event_id = v_event.id and judge = p_judge and created_at > now() - interval '10 seconds';
  if v_recent > 30 then
    return json_build_object('ok', false, 'error', 'Too many calls. Wait a moment.');
  end if;
  insert into public.judge_inputs (event_id, judge, kind, payload)
    values (v_event.id, p_judge, p_kind, coalesce(p_payload, '{}'::jsonb));
  -- Old pings are noise once read; keep the table small.
  delete from public.judge_inputs
   where event_id = v_event.id and kind = 'ping' and created_at < now() - interval '10 minutes';
  return json_build_object('ok', true);
end $$;

revoke all on function public.judge_submit(text, text, int, text, jsonb) from public;
grant execute on function public.judge_submit(text, text, int, text, jsonb) to anon, authenticated;
