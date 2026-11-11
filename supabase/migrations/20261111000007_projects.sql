-- Projects: a Premium member's own skill sets, one per thing they build.
--
--   projects          "ABC website", "Client CRM", "Launch video"
--   project_folders   the parts of a project: Frontend, Backend, UI/UX, Content...
--   project_items     a catalogue entry filed in one folder, with why it is there
--
-- An agent connected over MCP asks for a project by name (get_project) and
-- works from exactly the skills filed in it, so every session on that project
-- reaches for the same tools.
--
-- Ownership is carried down every row (user_id) and pinned by composite
-- foreign keys: a folder can only belong to a project of the same member, and
-- an item only to a folder of the same project and member. A bug in the app
-- cannot file one member's skill into another member's project, because the
-- database will not hold that row.
--
-- Same access model as the rest of the schema: RLS on with no policies, and
-- no grants to anon or authenticated, so the browser's publishable key reads
-- nothing. The server reaches these tables with the service role after
-- resolving the member itself (lib/auth.js, lib/mcpkeys.js), and scopes every
-- query by that member's id (lib/projects.js).

create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 60),
  slug         text not null check (char_length(slug) between 1 and 64 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description  text check (description is null or char_length(description) <= 400),
  template     text not null default 'blank' check (char_length(template) <= 40),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, slug),
  unique (id, user_id)
);
-- One "ABC" per member, whatever the case, so an agent asking for a project by name gets one answer.
create unique index projects_user_name_key on public.projects (user_id, lower(name));

create table public.project_folders (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null,
  user_id     uuid not null,
  name        text not null check (char_length(name) between 1 and 40),
  kind        text not null default 'custom' check (char_length(kind) between 1 and 40),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete cascade,
  unique (id, project_id, user_id)
);
create unique index project_folders_name_key on public.project_folders (project_id, lower(name));
create index project_folders_user_idx on public.project_folders (user_id);

create table public.project_items (
  folder_id   uuid not null,
  project_id  uuid not null,
  user_id     uuid not null,
  link_id     bigint not null references public.links (id) on delete cascade,
  note        text check (note is null or char_length(note) <= 280),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  primary key (folder_id, link_id),
  foreign key (folder_id, project_id, user_id)
    references public.project_folders (id, project_id, user_id) on delete cascade
);
create index project_items_project_idx on public.project_items (project_id);
create index project_items_user_idx on public.project_items (user_id);
create index project_items_link_idx on public.project_items (link_id);

-- Hard ceilings, enforced here as well as in lib/projects.js, so a burst of
-- parallel requests cannot run past them. Messages are stable codes the app
-- turns into sentences.
create or replace function public.project_limits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'projects' then
    if (select count(*) from public.projects where user_id = new.user_id) >= 30 then
      raise exception 'stash_limit_projects' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'project_folders' then
    if (select count(*) from public.project_folders where project_id = new.project_id) >= 12 then
      raise exception 'stash_limit_folders' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'project_items' then
    if tg_op = 'INSERT' and (select count(*) from public.project_items where project_id = new.project_id) >= 150 then
      raise exception 'stash_limit_items' using errcode = 'P0001';
    end if;
    if (select count(*) from public.project_items where folder_id = new.folder_id) >= 40 then
      raise exception 'stash_limit_folder_items' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.project_limits() from public, anon, authenticated;

create trigger projects_limit before insert on public.projects
  for each row execute function public.project_limits();
create trigger project_folders_limit before insert on public.project_folders
  for each row execute function public.project_limits();
create trigger project_items_limit before insert on public.project_items
  for each row execute function public.project_limits();
-- Moving an item into another folder counts against that folder too.
create trigger project_items_move_limit before update of folder_id on public.project_items
  for each row when (old.folder_id is distinct from new.folder_id)
  execute function public.project_limits();

alter table public.projects enable row level security;
alter table public.project_folders enable row level security;
alter table public.project_items enable row level security;

revoke all on table public.projects, public.project_folders, public.project_items from anon, authenticated;

-- Covering indexes for the composite ownership keys, so cascades and the
-- per-member lookups behind them stay index scans.
create index if not exists project_folders_project_user_idx on public.project_folders (project_id, user_id);
create index if not exists project_items_folder_project_user_idx on public.project_items (folder_id, project_id, user_id);
