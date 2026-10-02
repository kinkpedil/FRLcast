-- The owner's inbox for the contact form (2026-10-03).
--
-- Every message sent from frlcast.my.id/contact is kept here as well as emailed, so the owner
-- can read, sort and answer them on the private /inbox page.
--
-- Nobody reads or writes this table from a browser. Row level security is on with no policy
-- at all, and the API roles get no grants, so the anon key (which every visitor has) can do
-- nothing with it. Only the site's own server functions touch it, with the service role key
-- that lives in the Vercel project's environment (site/api/contact.js writes a message,
-- site/api/inbox.js lists and updates them after checking the owner's INBOX_KEY).
--
-- Safe to re-run: every object is created if missing.

create table if not exists public.contact_messages (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null default '' check (char_length(name) <= 80),
  email       text not null check (char_length(email) between 3 and 254),
  topic       text not null default 'Other' check (char_length(topic) <= 40),
  -- what the owner files it under; starts as the form's topic, a guess for bugs and spam
  category    text not null default 'question'
              check (category in ('question', 'bug', 'idea', 'league', 'other', 'spam')),
  status      text not null default 'new' check (status in ('new', 'replied', 'archived')),
  message     text not null check (char_length(message) between 1 and 4000),
  lang        text not null default 'en' check (lang in ('en', 'id')),
  replied_at  timestamptz
);

create index if not exists contact_messages_status_created on public.contact_messages (status, created_at desc);
create index if not exists contact_messages_category on public.contact_messages (category);

alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from anon, authenticated;
grant select, insert, update, delete on public.contact_messages to service_role;
