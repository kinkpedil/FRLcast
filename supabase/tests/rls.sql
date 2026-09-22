-- What the database refuses to do.
--
-- Policies are the kind of thing that reads correct and behaves otherwise, so every claim
-- made in the migration is exercised here as the role that would be making the attempt.
-- The interesting assertions are all negative: what an operator cannot see of another
-- operator's event, what the public cannot see at all, and what one driver cannot learn
-- about another.

\set ON_ERROR_STOP on
\pset pager off

create or replace function pg_temp.ok(claim boolean, what text)
returns void language plpgsql as $$
begin
  if claim then
    raise notice 'PASS  %', what;
  else
    raise exception 'FAIL  %', what;
  end if;
end $$;

-- ---------------------------------------------------------------- fixtures

delete from public.events;
delete from auth.users where id in (
  '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');

insert into public.events (id, owner, code, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'NDL3', 'NUSANTARA'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'RIVAL', 'OTHER LEAGUE');

insert into public.drivers (event_id, num, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '17', 'REZA A.'),
  ('bbbbbbbb-0000-0000-0000-000000000002', '5',  'SOMEONE ELSE');

-- ---------------------------------------------------------------- two drivers sign up

select pg_temp.ok((public.driver_register('NDL3', 'AKI', '7', 'hunter22')->>'ok')::boolean,
  'a driver can register into an event by its code');

select pg_temp.ok((public.driver_register('NDL3', 'BUDI', '21', 'secret99')->>'ok')::boolean,
  'and so can a second one');

select pg_temp.ok((public.driver_register('NOPE', 'GHOST', '3', 'whatever')->>'error') = 'No event with that code',
  'registering into an event that does not exist is refused');

select pg_temp.ok((public.driver_register('NDL3', 'IMPOSTER', '7', 'different')->>'error')
                  = 'That number is already registered',
  'somebody else cannot take a number that is taken');

select pg_temp.ok((public.driver_register('NDL3', 'AKI TWO', '7', 'hunter22')->>'rejoined')::boolean,
  'the person who owns the number can register again from a second phone');

-- ---------------------------------------------------------------- login answers nothing away

select pg_temp.ok(
  (public.driver_login('NDL3', '7', 'wrong')->>'error')
  = (public.driver_login('NDL3', '404', 'wrong')->>'error'),
  'a wrong password and an unknown number give the same answer');

select pg_temp.ok(
  (public.driver_login('NDL3', '7', 'wrong')->>'error')
  = (public.driver_login('ZZZZ', '7', 'hunter22')->>'error'),
  'and so does an event code that does not exist, so codes cannot be probed');

-- ---------------------------------------------------------------- what one driver sees

create temporary table t (who text, token uuid);
insert into t values ('aki',  (public.driver_login('NDL3', '7',  'hunter22')->>'token')::uuid);
insert into t values ('budi', (public.driver_login('NDL3', '21', 'secret99')->>'token')::uuid);

select pg_temp.ok((public.driver_state((select token from t where who='aki'))->>'status') = 'pending',
  'a driver starts out waiting for race control');

select pg_temp.ok((public.driver_state((select token from t where who='aki'))->'me')::text = 'null',
  'and has no car until somebody approves them');

-- ---------------------------------------------------------------- approving

do $$
declare v_reg uuid;
begin
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
  select id into v_reg from public.registrations where num = '7';
  perform public.approve_registration(v_reg);
end $$;

select pg_temp.ok((public.driver_state((select token from t where who='aki'))->>'status') = 'approved',
  'approving lets the driver in');

select pg_temp.ok(exists (select 1 from public.drivers
  where event_id = 'aaaaaaaa-0000-0000-0000-000000000001' and num = '7' and name = 'AKI TWO'),
  'and puts their car on the grid under the name they registered');

-- the other operator must not be able to approve into an event that is not theirs
do $$
declare v_reg uuid; v_out json;
begin
  select id into v_reg from public.registrations where num = '21';
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  v_out := public.approve_registration(v_reg);
  perform pg_temp.ok((v_out->>'error') = 'Not your event',
    'a different operator cannot approve into an event they do not own');
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- ---------------------------------------------------------------- penalties stay private

insert into public.penalties (event_id, driver_id, type, seconds, reason)
select 'aaaaaaaa-0000-0000-0000-000000000001', id, 'time', 5, 'Contact at turn 3'
  from public.drivers where num = '7';

select pg_temp.ok(
  json_array_length(public.driver_state((select token from t where who='aki'))->'penalties') = 1,
  'a penalty reaches the driver it was given to');

select pg_temp.ok(
  (public.driver_state((select token from t where who='aki'))->'penalties'->0->>'headline')
  = '+5s PENALTY',
  'with the wording race control sees');

select pg_temp.ok(
  json_array_length(public.driver_state((select token from t where who='budi'))->'penalties') = 0,
  'and no part of it reaches anybody else');

-- ---------------------------------------------------------------- signing out

select pg_temp.ok((public.driver_logout((select token from t where who='budi'))->>'ok')::boolean,
  'a driver can sign out');
select pg_temp.ok((public.driver_state((select token from t where who='budi'))->>'error') = 'Signed out',
  'and the token stops working straight away');
select pg_temp.ok((public.driver_state(gen_random_uuid())->>'error') = 'Signed out',
  'an invented token never worked');

-- ---------------------------------------------------------------- the public

begin;
  set local role anon;
  select pg_temp.ok((select count(*) from public.events) = 2,
    'anyone may read the timing: it is being broadcast');
  select pg_temp.ok((select count(*) from public.drivers) = 3,
    'including the grid');
commit;

-- Refused outright, not filtered to nothing. With no SELECT grant the request never
-- reaches a policy, which is the stronger of the two failures.
do $$
declare n int;
begin
  begin
    set local role anon;
    select count(*) into n from public.registrations;
    reset role;
    raise exception 'FAIL  the public could read the sign-in queue';
  exception when insufficient_privilege then
    reset role;
    raise notice 'PASS  the public is refused the sign-in queue outright';
  end;

  begin
    set local role anon;
    select count(*) into n from public.driver_accounts;
    reset role;
    raise exception 'FAIL  the public could read driver_accounts';
  exception when insufficient_privilege then
    reset role;
    raise notice 'PASS  and refused driver_accounts, where the password hashes live';
  end;

  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
    select count(*) into n from public.driver_accounts;
    reset role;
    raise exception 'FAIL  a signed in operator could read driver_accounts';
  exception when insufficient_privilege then
    reset role;
    raise notice 'PASS  so is an operator, on their own event';
  end;
end $$;

do $$
begin
  begin
    set local role anon;
    insert into public.events (owner, code, name)
      values ('11111111-1111-1111-1111-111111111111', 'HACK', 'NOT YOURS');
    reset role;
    raise exception 'FAIL  the public managed to create an event';
  exception when insufficient_privilege or check_violation then
    reset role;
    raise notice 'PASS  the public cannot create an event';
  end;
end $$;

do $$
begin
  begin
    set local role anon;
    update public.events set status = 'red';
    reset role;
    if (select count(*) from public.events where status = 'red') > 0 then
      raise exception 'FAIL  the public managed to throw a red flag';
    end if;
    raise notice 'PASS  the public cannot change the flag';
  exception when insufficient_privilege then
    reset role;
    raise notice 'PASS  the public cannot change the flag';
  end;
end $$;

-- ---------------------------------------------------------------- one operator, one event

do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

  update public.events set name = 'RENAMED' where code = 'NDL3';
  select count(*) into n from public.events where name = 'RENAMED';
  perform pg_temp.ok(n = 1, 'an operator can change their own event');

  update public.events set name = 'STOLEN' where code = 'RIVAL';
  select count(*) into n from public.events where name = 'STOLEN';
  perform pg_temp.ok(n = 0, 'and silently changes nothing in an event they do not own');

  delete from public.drivers where num = '5';
  select count(*) into n from public.drivers where num = '5';
  perform pg_temp.ok(n = 1, 'nor can they delete a car off another operator''s grid');

  select count(*) into n from public.registrations;
  perform pg_temp.ok(n = 2, 'they do see the sign-in queue for their own event');

  reset role;
end $$;

do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  select count(*) into n from public.registrations;
  perform pg_temp.ok(n = 0, 'and the other operator sees none of it');
  reset role;
end $$;

select 'all assertions passed' as result;
