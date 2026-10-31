-- Curator settings and the iOS share sheet.
--
--   app_settings     small key/value store for switches the curator flips
--                    from /admin (no redeploy needed)
--   mcp_keys.kind    'mcp' for agent connector keys, 'shortcut' for the iOS
--                    share sheet. Kept apart so a phone shortcut key can never
--                    open the MCP server, and an MCP key can never save links.
--
-- Same access model as the rest: RLS on, no policies, service role only.

create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table public.app_settings enable row level security;

insert into public.app_settings (key, value) values
  ('ios_shortcut', '{"enabled": false}'),
  ('catalogue',    '{"new_entries_premium": false}')
on conflict (key) do nothing;

alter table public.mcp_keys
  add column kind text not null default 'mcp' check (kind in ('mcp', 'shortcut'));
create index mcp_keys_kind_idx on public.mcp_keys (user_id, kind);
