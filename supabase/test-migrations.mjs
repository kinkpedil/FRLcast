// Run every migration on a real Postgres (PGlite, Postgres compiled to WebAssembly) with a
// minimal Supabase shim (auth schema + auth.uid(), the API roles, the realtime publication),
// then exercise the driver and entry functions. Never touches the production project.
//
//   npm install --no-save @electric-sql/pglite
//   node supabase/test-migrations.mjs
//
// Run it before handing any new migration to the owner. It found an event_join bug that
// would have signed drivers' phones out (2026-09-26).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const MIG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const files = fs.readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();

const SHIM = `
create schema if not exists auth;
create schema if not exists extensions;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;
do $$ begin create publication supabase_realtime; exception when duplicate_object then null; end $$;
`;

async function fresh(list) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SHIM);
  for (const f of list) {
    try { await db.exec(fs.readFileSync(path.join(MIG, f), 'utf8')); }
    catch (e) { throw new Error(`${f}: ${e.message}`); }
  }
  return db;
}

const q = async (db, sql, params = []) => (await db.query(sql, params)).rows;
const j = async (db, sql, params = []) => (await q(db, sql, params))[0].r;
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };

// ---------------------------------------------------------------- 1. all migrations in order
console.log('== all migrations:', files.join(', '));
const db = await fresh(files);
check('all migrations apply', true);
await db.exec(fs.readFileSync(path.join(MIG, '20260925000000_league.sql'), 'utf8'));
check('league migration re-runs (idempotent)', true);
// The idempotency re-run above restores league's driver_state; put the newest migration's
// version back so the rest of the checks run against the current function.
await db.exec(fs.readFileSync(path.join(MIG, '20260927000000_flags.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(MIG, '20260927100000_batch2.sql'), 'utf8'));
await db.exec(fs.readFileSync(path.join(MIG, '20261001000000_licence.sql'), 'utf8'));

// ---------------------------------------------------------------- 2. without playerid
const noPlayer = files.filter((f) => !f.includes('playerid'));
try { const d2 = await fresh(noPlayer); check('league works without the playerid migration', true);
  const r = await j(d2, `select public.event_join('X', 'A', '1', 'abcd') as r`);
  check('  ...and its functions run there', r && r.ok === false && r.error === 'No event with that code', JSON.stringify(r));
} catch (e) { check('league works without the playerid migration', false, e.message); }

// ---------------------------------------------------------------- 3. functions
const OWNER = '11111111-1111-4111-8111-111111111111';
await q(db, `insert into auth.users (id) values ($1)`, [OWNER]);
const ev = (await q(db, `insert into public.events (owner, code, name, round, track, session_type, total_laps)
  values ($1, 'TEST1', 'MOCK CUP', 'R1', 'EBISU', 'race', 10) returning id`, [OWNER]))[0].id;

let r = await j(db, `select public.event_join('test1', 'DIMAS', '55', 'abcd', 'SPFF') as r`);
check('event_join registers', r.ok === true && r.rejoined === false && !('token' in r), JSON.stringify(r));
let row = (await q(db, `select checked_in_at, status from public.registrations where num = '55'`))[0];
check('event_join is not a check-in', row.checked_in_at === null && row.status === 'pending');

r = await j(db, `select public.event_join('TEST1', 'DIMAS', '55', 'wrong', 'SPFF') as r`);
check('event_join: taken number, wrong password', r.ok === false && r.error === 'That number is already registered', JSON.stringify(r));

r = await j(db, `select public.event_entries('TEST1') as r`);
check('event_entries lists the entry', r.ok && r.entries.length === 1 && r.entries[0].nick === 'DIMAS' && r.entries[0].checkedIn === false, JSON.stringify(r.entries));
check('event_entries has no secrets', !JSON.stringify(r).includes('pass') && !JSON.stringify(r).includes('token'));

r = await j(db, `select public.event_checkin('TEST1', '55', 'nope') as r`);
check('event_checkin: wrong password', r.ok === false && r.error === 'Wrong number or password');
r = await j(db, `select public.event_checkin('TEST1', '55', 'abcd') as r`);
check('event_checkin', r.ok === true);
r = await j(db, `select public.event_entries('TEST1') as r`);
check('entry now checked in', r.entries[0].checkedIn === true);

r = await j(db, `select public.driver_register('TEST1', 'EKO', '43', 'pass', '', '') as r`);
check('driver_register (app) works', r.ok === true && !!r.token);
row = (await q(db, `select checked_in_at from public.registrations where num = '43'`))[0];
check('registering from the app checks in', row.checked_in_at !== null);

await q(db, `update public.registrations set checked_in_at = null where num = '55'`);
const login = await j(db, `select public.driver_login('TEST1', '55', 'abcd') as r`);
check('driver_login', login.ok === true && !!login.token);
row = (await q(db, `select checked_in_at from public.registrations where num = '55'`))[0];
check('signing in checks in', row.checked_in_at !== null);
const tok = login.token;

r = await j(db, `select public.event_join('TEST1', 'DIMAS', '55', 'abcd', 'SPFF') as r`);
const stillIn = (await j(db, `select public.driver_state($1::uuid) as r`, [tok])).ok;
check('rejoin from the web keeps the phone signed in', r.ok === true && r.rejoined === true && stillIn === true, JSON.stringify({ r, stillIn }));
const ci = (await q(db, `select checked_in_at from public.registrations where num = '55'`))[0].checked_in_at;
check('rejoin from the web does not touch the check-in', ci !== null);
r = await j(db, `select public.event_join('TEST1', 'X', '', 'abcd') as r`);
check('event_join needs a number', r.ok === false && r.error === 'Type your race number', JSON.stringify(r));

// accept both, build a small grid
await db.exec(`select set_config('request.jwt.claim.sub', '${OWNER}', false)`);
for (const num of ['55', '43']) {
  const id = (await q(db, `select id from public.registrations where num = $1`, [num]))[0].id;
  const a = await j(db, `select public.approve_registration($1) as r`, [id]);
  check(`approve #${num}`, a.ok === true, JSON.stringify(a));
}
await q(db, `insert into public.drivers (event_id, num, name, position, laps_done, gap_ms, best_lap) values ($1, '7', 'AKI', 1, 5, 0, 60000)`, [ev]);
await q(db, `update public.drivers set position = 2, laps_done = 5, gap_ms = 700,  best_lap = 60200 where num = '55'`);
await q(db, `update public.drivers set position = 3, laps_done = 4, gap_ms = null, best_lap = 61000 where num = '43'`);

// the phone's token after the web rejoin: driver_register issues a new one, so sign in again
const tok2 = (await j(db, `select public.driver_login('TEST1', '55', 'abcd') as r`)).token;
let st = await j(db, `select public.driver_state($1::uuid) as r`, [tok2]);
check('driver_state ok', st.ok === true && st.status === 'approved', JSON.stringify({ ok: st.ok, status: st.status }));
check('driver_state: checkedIn', st.checkedIn === true);
check('driver_state: gameId still there', st.driver && 'gameId' in st.driver);
const me = st.me;
check('pit board: place and cars', me.position === 2 && me.cars === 3, JSON.stringify({ p: me.position, cars: me.cars }));
check('pit board: laps left', me.lapsLeft === 5, String(me.lapsLeft));
check('pit board: ahead (same lap, ms)', me.ahead && me.ahead.num === '7' && me.ahead.gapMs === 700 && me.ahead.gapLaps === 0, JSON.stringify(me.ahead));
check('pit board: behind (a lap down)', me.behind && me.behind.num === '43' && me.behind.gapLaps === 1, JSON.stringify(me.behind));
check('pit board: gap to leader', me.gapMs === 700, String(me.gapMs));
check('pit board: pit open by default', me.pitOpen === true, String(me.pitOpen));
check('pit board: no endurance time in a lap race', me.timeLeftMs == null, String(me.timeLeftMs));

// white flag stores, and pit lane closes through the settings blob
await q(db, `update public.events set status = 'white' where id = $1`, [ev]);
await q(db, `update public.events set settings = jsonb_set(settings, '{pitOpen}', 'false') where id = $1`, [ev]);
st = await j(db, `select public.driver_state($1::uuid) as r`, [tok2]);
check('white flag is a valid status', st.flag === 'white', st.flag);
check('pit board: pit closed reaches the phone', st.me.pitOpen === false, String(st.me.pitOpen));
await q(db, `update public.events set status = 'green', settings = jsonb_set(settings, '{pitOpen}', 'true') where id = $1`, [ev]);

// endurance: time-left counts down from the limit and the green-flag stamp
await q(db, `update public.events set session_type = 'endurance', total_laps = 0,
  started_at = now() - interval '10 minutes', paused_total = 0,
  settings = jsonb_set(settings, '{timeLimitSec}', '1800') where id = $1`, [ev]);
st = await j(db, `select public.driver_state($1::uuid) as r`, [tok2]);
check('endurance: laps left is null', st.me.lapsLeft === null, String(st.me.lapsLeft));
check('endurance: time left ~ 20 min', st.me.timeLeftMs > 1180000 && st.me.timeLeftMs <= 1200000, String(st.me.timeLeftMs));
await q(db, `update public.events set session_type = 'race', total_laps = 10, started_at = null where id = $1`, [ev]);

// batch two: operator message + start lights ride in the settings blob; a drive-through
// serve countdown reads the black-flag rule from settings.rules
await q(db, `update public.events set settings = jsonb_set(jsonb_set(settings,
  '{lights}', '3'), '{messages}', jsonb_build_object($2::text, jsonb_build_object('text', 'BOX THIS LAP', 'at', 1))) where id = $1`,
  [ev, (await q(db, `select id from public.drivers where num = '55'`))[0].id]);
st = await j(db, `select public.driver_state($1::uuid) as r`, [tok2]);
check('op message reaches the phone', st.me.message === 'BOX THIS LAP', st.me.message);
check('start lights reach the phone', st.me.lights === 3, String(st.me.lights));
check('licence is null while the league has it off', st.me.licence === null, JSON.stringify(st.me.licence));
// licence points ride in the same blob, keyed by driver id
await q(db, `update public.events set settings = jsonb_set(settings, '{licence}',
  jsonb_build_object($2::text, jsonb_build_object('points', 7, 'pending', 2, 'threshold', 12, 'banned', false))) where id = $1`,
  [ev, (await q(db, `select id from public.drivers where num = '55'`))[0].id]);
st = await j(db, `select public.driver_state($1::uuid) as r`, [tok2]);
check('licence points reach the phone', st.me.licence && st.me.licence.points === 7 && st.me.licence.threshold === 12, JSON.stringify(st.me.licence));
await q(db, `update public.events set settings = jsonb_set(settings, '{driftView}',
  jsonb_build_object($2::text, jsonb_build_object('upNext', jsonb_build_object('opponent', 'AKI', 'round', 'TOP 16')))) where id = $1`,
  [ev, (await q(db, `select id from public.drivers where num = '55'`))[0].id]);
st = await j(db, `select public.driver_state($1::uuid) as r`, [tok2]);
check('drift view reaches the phone', st.me.drift && st.me.drift.upNext && st.me.drift.upNext.opponent === 'AKI', JSON.stringify(st.me.drift));
// a drive-through, 3 laps ago, black-flag rule = 5 laps -> 2 laps left to serve
await q(db, `update public.events set settings = jsonb_set(settings, '{rules}', '{"blackFlagUnserved":5}') where id = $1`, [ev]);
await q(db, `insert into public.penalties (event_id, driver_id, type, status, served, lap)
  values ($1, (select id from public.drivers where num='55'), 'drivethrough', 'applied', false, 2)`, [ev]);
await q(db, `update public.drivers set laps_done = 5 where num = '55'`);
st = await j(db, `select public.driver_state($1::uuid) as r`, [tok2]);
check('serve countdown reaches the phone', st.me.serveInLaps === 2, String(st.me.serveInLaps));
// a new session began after that penalty: it belongs to the earlier session now
await q(db, `update public.events set settings = jsonb_set(settings, '{sessionEpoch}',
  to_jsonb((extract(epoch from now() + interval '1 minute') * 1000)::bigint)) where id = $1`, [ev]);
st = await j(db, `select public.driver_state($1::uuid) as r`, [tok2]);
check('earlier session drive-through is not counted', st.me.serveInLaps === null, String(st.me.serveInLaps));
await q(db, `update public.events set settings = settings - 'sessionEpoch' where id = $1`, [ev]);
await q(db, `delete from public.penalties where type = 'drivethrough'`);
await q(db, `update public.drivers set laps_done = 5, car_class = 'GT3' where num = '55'`);
check('car_class column mirrors', (await q(db, `select car_class from public.drivers where num='55'`))[0].car_class === 'GT3');
// predictions table: anon can pick and read, one row per voter
await q(db, `insert into public.predictions (event_id, voter, choice) values ($1, 'dev1', '55')`, [ev]);
check('prediction stored', (await q(db, `select choice from public.predictions where voter='dev1'`))[0].choice === '55');
await q(db, `update public.events set settings = jsonb_set(settings, '{lights}', '0') where id = $1`, [ev]);

await q(db, `update public.events set session_type = 'qualifying' where id = $1`, [ev]);
st = await j(db, `select public.driver_state($1::uuid) as r`, [tok2]);
check('quali: gaps are best-lap deltas, no laps left', st.me.ahead.gapMs === 200 && st.me.lapsLeft === null && st.me.gapMs === 200, JSON.stringify({ a: st.me.ahead, left: st.me.lapsLeft, g: st.me.gapMs }));
await q(db, `update public.events set session_type = 'race' where id = $1`, [ev]);

// team radio restored
r = await j(db, `select public.driver_radio($1::uuid, 'BOX BOX') as r`, [tok2]);
check('driver_radio', r.ok === true, JSON.stringify(r));
st = await j(db, `select public.driver_state($1::uuid) as r`, [tok2]);
check('team radio back in driver_state', st.radio && st.radio.text === 'BOX BOX' && st.team === 'SPFF', JSON.stringify(st.radio));

// incident reports
r = await j(db, `select public.driver_report($1::uuid, '43', 'Pushed me wide at T3') as r`, [tok2]);
check('driver_report', r.ok === true, JSON.stringify(r));
row = (await q(db, `select from_nick, from_num, against_num, lap, text, status from public.incident_reports`))[0];
check('report stored with reporter and lap', row.from_nick === 'DIMAS' && row.against_num === '43' && row.lap === 5 && row.status === 'open', JSON.stringify(row));
r = await j(db, `select public.driver_report($1::uuid, '43', '   ') as r`, [tok2]);
check('empty report refused', r.ok === false);
for (let i = 0; i < 4; i++) await j(db, `select public.driver_report($1::uuid, '7', 'again') as r`, [tok2]);
r = await j(db, `select public.driver_report($1::uuid, '7', 'sixth') as r`, [tok2]);
check('rate limit after 5 in 10 minutes', r.ok === false && /Too many/.test(r.error), JSON.stringify(r));
r = await j(db, `select public.driver_report('00000000-0000-4000-8000-000000000000'::uuid, '7', 'x') as r`);
check('report with a bad token refused', r.ok === false && r.error === 'Signed out');

// rejected entries stay off the public list
await q(db, `update public.registrations set status = 'rejected' where num = '43'`);
r = await j(db, `select public.event_entries('TEST1') as r`);
check('rejected entry hidden from the list', r.entries.every((e) => e.num !== '43'), JSON.stringify(r.entries.map((e) => e.num)));

// grants and policies
const g = await q(db, `select grantee, privilege_type from information_schema.role_table_grants where table_name = 'incident_reports'`);
check('anon has no access to incident_reports', !g.some((x) => x.grantee === 'anon'), JSON.stringify(g.filter((x) => x.grantee === 'anon')));
const fx = await q(db, `select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_ok
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('event_join','event_checkin','event_entries','driver_report','driver_state','driver_login','driver_register')`);
check('anon can call the public functions', fx.length >= 7 && fx.every((x) => x.anon_ok), JSON.stringify(fx));
const dup = await q(db, `select proname, count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and proname in ('driver_login','driver_register') group by proname having count(*) > 1`);
check('no overloaded driver_login / driver_register', dup.length === 0, JSON.stringify(dup));

// drift judges: a call needs the event's key, and lands in judge_inputs for race control
let jr = await j(db, `select public.judge_submit('TEST1', 'NOPE', 1, 'vote', '{"vote":"a"}'::jsonb) as r`);
check('judge call without a key is refused', jr.ok === false, JSON.stringify(jr));
await q(db, `insert into public.event_judge_keys (event_id, key) values ($1, 'K3Y9ZZ')`, [ev]);
jr = await j(db, `select public.judge_submit('test1', 'k3y9zz', 2, 'vote', '{"vote":"b"}'::jsonb) as r`);
check('judge vote with the key is filed', jr.ok === true, JSON.stringify(jr));
jr = await j(db, `select public.judge_submit('TEST1', 'K3Y9ZZ', 2, 'vote', '{"vote":"x"}'::jsonb) as r`);
check('a vote that is not a, b or omt is refused', jr.ok === false, JSON.stringify(jr));
jr = await j(db, `select public.judge_submit('TEST1', 'K3Y9ZZ', 1, 'score', '{"line":30,"angle":25,"style":28}'::jsonb) as r`);
const jrows = await q(db, `select judge, kind, payload from public.judge_inputs where event_id = $1 order by id`, [ev]);
check('judge calls stored in order', jrows.length === 2 && jrows[0].payload.vote === 'b' && jrows[1].payload.line === 30, JSON.stringify(jrows));
const jg = await q(db, `select table_name, grantee from information_schema.role_table_grants
  where table_name in ('judge_inputs', 'event_judge_keys') and grantee = 'anon'`);
check('anon cannot read judge keys or calls', jg.length === 0, JSON.stringify(jg));
const jf = await q(db, `select has_function_privilege('anon', 'public.judge_submit(text,text,int,text,jsonb)', 'execute') as ok`);
check('anon can call judge_submit', jf[0].ok === true);

// the owner's inbox: only the server (service role) touches contact_messages
const ig = await q(db, `select grantee, privilege_type from information_schema.role_table_grants
  where table_name = 'contact_messages' and grantee in ('anon', 'authenticated')`);
check('anon and authenticated have no access to contact_messages', ig.length === 0, JSON.stringify(ig));
const irls = await q(db, `select relrowsecurity as on from pg_class where relname = 'contact_messages'`);
check('contact_messages has row level security on', irls[0].on === true);
await q(db, `insert into public.contact_messages (name, email, topic, category, message, lang)
  values ('Budi', 'budi@example.com', 'Bug report', 'bug', 'Overlay freezes after lap 3', 'id')`);
const im = await q(db, `select status, category, id is not null as has_id from public.contact_messages`);
check('a message is stored as new', im.length === 1 && im[0].status === 'new' && im[0].category === 'bug' && im[0].has_id, JSON.stringify(im));
let badCat = false;
try { await q(db, `insert into public.contact_messages (email, message, category) values ('a@b.co', 'x', 'nonsense')`); }
catch (e) { badCat = true; }
check('an unknown category is refused', badCat);
let anonRead = false;
try { await db.exec(`set role anon; select * from public.contact_messages;`); anonRead = true; }
catch (e) { anonRead = false; }
await db.exec('reset role;');
check('anon cannot select contact_messages', anonRead === false);
await db.exec(fs.readFileSync(path.join(MIG, '20261003000000_inbox.sql'), 'utf8'));
check('inbox migration re-runs (idempotent)', true);

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);
