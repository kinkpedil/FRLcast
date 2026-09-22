-- The values the timing computer works out, and the clock it works them out against.
--
-- Where these get written is the part worth being explicit about. The old server derived
-- them and pushed the whole state to everybody once a second. Here the operator's console
-- is the timing computer: it derives on a lap crossing and writes the drivers that
-- actually moved. Everyone else reads.
--
-- Between crossings nothing is written at all. A gap that is three seconds now and three
-- seconds a moment later is not news, and the smooth part of the picture, where a car
-- creeps up on the one in front, is interpolated by each overlay from its own clock. That
-- is the difference between roughly 4 MB of egress for a two hour event and 1.26 GB.

alter table public.events
  add column if not exists paused_at    timestamptz,
  add column if not exists paused_total bigint not null default 0,
  add column if not exists finished_at  timestamptz;

alter table public.drivers
  -- Milliseconds behind the leader, and behind the car in front. Null until this driver has
  -- completed a lap, which is not the same as zero: zero means level.
  add column if not exists gap_ms      bigint,
  add column if not exists interval_ms bigint,

  -- Not moving. The automatic flag rules read this, so it is a fact about the car rather
  -- than an opinion the overlay forms.
  add column if not exists stopped     boolean not null default false,

  -- This position has not been confirmed by a timing crossing yet. The overlay marks it so
  -- the audience is not shown a swap as though it were measured.
  add column if not exists predicted   boolean not null default false;

-- Position is read on every render and written on every crossing, and a race with a full
-- grid sorts it constantly.
create index if not exists drivers_order_idx on public.drivers (event_id, position);
