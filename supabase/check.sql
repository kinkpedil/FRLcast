-- Is the schema complete?
--
-- Run this in the SQL Editor after loading the migrations. It reports one row per thing
-- that should exist, so a half-applied schema shows up as a list of MISSING rather than as
-- a strange failure during a race.

with expected as (
  select * from (values
    ('table',    'events'),          ('table',    'drivers'),
    ('table',    'driver_accounts'), ('table',    'registrations'),
    ('table',    'penalties'),       ('table',    'feed'),
    ('table',    'results'),

    ('column',   'events.paused_at'),    ('column', 'events.paused_total'),
    ('column',   'events.finished_at'),  ('column', 'drivers.gap_ms'),
    ('column',   'drivers.interval_ms'), ('column', 'drivers.stopped'),
    ('column',   'drivers.predicted'),
    ('column',   'driver_accounts.team'), ('column', 'registrations.team'),
    ('column',   'drivers.game_id'),      ('column', 'driver_accounts.game_id'),
    ('column',   'registrations.game_id'),

    ('function', 'driver_register'), ('function', 'driver_login'),
    ('function', 'driver_logout'),   ('function', 'driver_state'),
    ('function', 'penalty_headline'),('function', 'approve_registration'),

    ('policy',   'events_read'),  ('policy', 'events_own'),
    ('policy',   'drivers_read'), ('policy', 'drivers_own'),
    ('policy',   'pen_read'),     ('policy', 'pen_own'),
    ('policy',   'reg_own')
  ) as t(kind, name)
),
found as (
  select 'table' as kind, tablename as name
    from pg_tables where schemaname = 'public'
  union all
  select 'column', table_name || '.' || column_name
    from information_schema.columns where table_schema = 'public'
  union all
  select 'function', proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
  union all
  select 'policy', policyname
    from pg_policies where schemaname = 'public'
)
select
  e.kind,
  e.name,
  case when f.name is null then 'MISSING' else 'ok' end as status
from expected e
left join (select distinct kind, name from found) f
  on f.kind = e.kind and f.name = e.name
order by (f.name is null) desc, e.kind, e.name;

-- Row level security has to be on as well as having policies. A table with policies and
-- RLS switched off is wide open, and it looks correct in the list above.
select
  c.relname as table_name,
  case when c.relrowsecurity then 'on' else 'RLS IS OFF' end as row_level_security
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relname in ('events','drivers','driver_accounts','registrations','penalties','feed','results')
order by c.relrowsecurity, c.relname;

-- And the one table nothing should be able to read.
select
  case when count(*) = 0
    then 'ok: driver_accounts is unreachable through the API'
    else 'PROBLEM: ' || count(*) || ' grant(s) on driver_accounts for anon or authenticated'
  end as password_table
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'driver_accounts'
  and grantee in ('anon', 'authenticated')
  -- Only the ones that reach or destroy rows. REFERENCES and TRIGGER are handed out by
  -- the platform on every new table and expose nothing, and flagging them would train
  -- somebody to ignore this line.
  and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');

-- The sign-in queue, same question. It names people who asked to join and, if you turned
-- any of them down, that too. Operators read it as `authenticated`; the public never
-- should, and it should be refused rather than filtered to nothing by a policy.
select
  case when count(*) = 0
    then 'ok: the sign-in queue is refused to the public'
    else 'PROBLEM: anon still holds ' || string_agg(privilege_type, ', ') || ' on registrations'
  end as sign_in_queue
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'registrations'
  and grantee = 'anon'
  and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
