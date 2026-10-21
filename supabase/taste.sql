-- Taste scores for saved items (see lib/taste.js). Safe to run more than once.
-- Run in the Supabase SQL editor.
alter table public.links add column if not exists taste jsonb;
alter table public.links add column if not exists taste_v integer;
create index if not exists links_taste_v_idx on public.links (taste_v);
