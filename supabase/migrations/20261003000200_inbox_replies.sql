-- Replies sent from the owner's inbox (2026-10-03).
--
-- /inbox can now answer a message itself (site/api/inbox.js sends it through Resend from the
-- site's own address). Each reply is kept on the message as { at, text }, so the inbox shows
-- the whole conversation. Same rules as the table: only the server's service role reads or
-- writes it. Run after 20261003000000_inbox.sql; safe to re-run.

alter table public.contact_messages
  add column if not exists replies jsonb not null default '[]'::jsonb;
