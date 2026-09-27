-- Crowd reactions: viewers on the live page tap an emoji, the broadcast overlay shows a
-- hype meter and the emoji floating up. Insert-only and cheap, like the poll's votes but
-- with no one-per-voter limit (a reaction is a tap, not a ballot). Rows are transient; the
-- overlay only ever reads the last few seconds, and old rows can be swept whenever.

create table if not exists public.reactions (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now()
);
create index if not exists reactions_event_time_idx on public.reactions (event_id, created_at);

alter table public.reactions enable row level security;

-- Anyone may read the recent reactions and add their own. There is nothing secret here and
-- nothing that a stuffed count could damage beyond a livelier meter for a moment.
do $p$ begin
  create policy reactions_select on public.reactions for select to anon, authenticated using (true);
exception when duplicate_object then null; end $p$;
do $p$ begin
  create policy reactions_insert on public.reactions for insert to anon, authenticated with check (true);
exception when duplicate_object then null; end $p$;

-- Realtime, so the overlay can also pick them up live if it subscribes.
do $pub$ begin
  alter publication supabase_realtime add table public.reactions;
exception when duplicate_object then null; end $pub$;
