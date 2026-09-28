-- Penalty appeals. A driver appeals a penalty from the app; the steward upholds it (the
-- penalty stands) or overturns it (the penalty is dropped) with a ruling note. Modelled on
-- incident_reports: the operator owns the queue, drivers write through the RPC and never read
-- the table. driver_state is not touched: the app shows "submitted" locally and an overturned
-- penalty simply disappears from the driver's penalty list.

create table if not exists public.appeals (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  account_id  uuid references public.driver_accounts (id) on delete set null,
  penalty_id  uuid,
  num         text not null default '',
  name        text not null default '',
  reason      text not null,
  status      text not null default 'open',
  ruling      text not null default '',
  created_at  timestamptz not null default now(),
  constraint appeal_status_known check (status in ('open', 'upheld', 'overturned'))
);

create index if not exists appeals_event_idx on public.appeals (event_id, created_at desc);

alter table public.appeals enable row level security;

drop policy if exists appeal_own on public.appeals;
create policy appeal_own on public.appeals for all
  using (exists (select 1 from public.events e where e.id = event_id and e.owner = auth.uid()))
  with check (exists (select 1 from public.events e where e.id = event_id and e.owner = auth.uid()));

revoke all on public.appeals from anon;
grant select, insert, update, delete on public.appeals to authenticated;
grant all on public.appeals to service_role;

-- The driver files an appeal for their most recent applied penalty (or a specific one).
create or replace function public.driver_appeal(p_token uuid, p_reason text, p_penalty uuid default null)
returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_account public.driver_accounts;
  v_reg     public.registrations;
  v_driver  public.drivers;
  v_reason  text := left(trim(coalesce(p_reason, '')), 300);
  v_pen     uuid := p_penalty;
  v_recent  int;
begin
  if v_reason = '' then
    return json_build_object('ok', false, 'error', 'Say why you are appealing');
  end if;
  select * into v_account from public.driver_accounts
    where token = p_token and token_expires > now();
  if not found then
    return json_build_object('ok', false, 'error', 'Signed out');
  end if;
  select count(*) into v_recent from public.appeals
    where account_id = v_account.id and created_at > now() - interval '10 minutes';
  if v_recent >= 5 then
    return json_build_object('ok', false, 'error', 'Too many appeals. Wait a few minutes.');
  end if;
  select * into v_reg    from public.registrations where account_id = v_account.id;
  select * into v_driver from public.drivers where id = v_reg.driver_id;
  -- Attach to the driver's most recent applied penalty when none is named.
  if v_pen is null and v_driver.id is not null then
    select p.id into v_pen from public.penalties p
      where p.driver_id = v_driver.id and p.status = 'applied'
        and not exists (select 1 from public.appeals a where a.penalty_id = p.id)
      order by p.created_at desc limit 1;
  end if;
  insert into public.appeals (event_id, account_id, penalty_id, num, name, reason)
  values (v_account.event_id, v_account.id, v_pen, v_account.num, v_account.nick, v_reason);
  return json_build_object('ok', true);
end $$;

revoke all on function public.driver_appeal(uuid, text, uuid) from public;
grant execute on function public.driver_appeal(uuid, text, uuid) to anon, authenticated;
