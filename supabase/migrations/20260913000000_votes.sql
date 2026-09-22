-- Audience voting / prediction.
--
-- A public poll attached to an event: viewers on the live page pick a driver, the overlay
-- shows the tally live. One row per voter per event (a browser-local fingerprint), so a
-- re-vote replaces the old one rather than stuffing the box.
--
-- The poll's question and whether it is open live in events.settings.overlay.poll, next to
-- the rest of the overlay config, so no schema is needed for that — only the votes table.

create table if not exists public.votes (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  voter      text not null,
  choice     text not null,
  created_at timestamptz not null default now(),
  unique (event_id, voter)
);

create index if not exists votes_event_idx on public.votes (event_id);

alter table public.votes enable row level security;

-- A public poll: anyone may read the tally and cast (or change) their own vote. The unique
-- constraint above is what keeps it one-per-voter; the fingerprint is not a secret and not
-- trusted for anything but that.
do $p$ begin
  create policy votes_select on public.votes for select to anon, authenticated using (true);
exception when duplicate_object then null; end $p$;
do $p$ begin
  create policy votes_insert on public.votes for insert to anon, authenticated with check (true);
exception when duplicate_object then null; end $p$;
do $p$ begin
  create policy votes_update on public.votes for update to anon, authenticated using (true) with check (true);
exception when duplicate_object then null; end $p$;

-- Realtime so the overlay tally moves as votes land.
do $pub$ begin
  alter publication supabase_realtime add table public.votes;
exception when duplicate_object then null; end $pub$;
