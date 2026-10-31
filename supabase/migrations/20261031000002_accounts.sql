-- Accounts: Stash becomes a shared catalogue with signed-in members.
--
--   profiles   one per auth user: plan (free | pro) and admin flag
--   mcp_keys   per-user MCP connector keys, stored only as SHA-256 hashes
--   saves      a member's personal "My Stash" list over the shared catalogue
--   links.is_premium   visible to members only; signed-out visitors see a
--                      locked teaser
--
-- Same access model as links: RLS on, no policies. The server reaches these
-- with the service role after resolving the user itself (lib/auth.js).

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  name        text,
  avatar_url  text,
  plan        text not null default 'free' check (plan in ('free', 'pro')),
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Anyone who signed in before this migration.
insert into public.profiles (id, email, name, avatar_url)
select id, email,
       coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name'),
       raw_user_meta_data ->> 'avatar_url'
from auth.users
on conflict (id) do nothing;

-- The owner curates the catalogue and has every feature.
update public.profiles set is_admin = true, plan = 'pro' where email = 'aruo.dev01@gmail.com';

create table public.mcp_keys (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  name          text not null default 'Default',
  prefix        text not null,                -- first characters, so a key can be recognised in the list
  key_hash      text not null unique,         -- sha256 hex of the full key; the key itself is never stored
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index mcp_keys_user_idx on public.mcp_keys (user_id);
alter table public.mcp_keys enable row level security;

create table public.saves (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  link_id     bigint not null references public.links (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, link_id)
);
create index saves_link_idx on public.saves (link_id);
alter table public.saves enable row level security;

alter table public.links add column is_premium boolean not null default false;

-- Starting set: the owner's starred picks, tools proven on real projects,
-- MCP servers and agent skills. Adjust per item from /admin.
update public.links set is_premium = true
where starred
   or used_count > 0
   or type = 'mcp-server'
   or tags && array['agent-skill', 'agent-skills', 'claude-skill', 'claude-code-skill',
                    'ai-agent-skill', 'skills', 'skill', 'design-skill', 'codex-skill'];

-- search_links gains f_ids, so a member's saved list can be searched and
-- filtered like the rest. Dropped first: a new parameter would otherwise
-- create a second overload beside the old one.
drop function public.search_links;

create function public.search_links(
  q             text default null,
  q_embedding   extensions.vector(384) default null,
  f_category    text default null,
  f_pricing     text default null,
  f_source      text default null,
  f_kind        text default null,
  f_status      text default null,
  f_tags        text[] default null,
  f_oss         boolean default false,
  f_starred     boolean default false,
  f_collection  text default null,
  f_language    text default null,
  f_type        text default null,
  f_min_stars   integer default null,
  f_maintained  boolean default false,
  f_dead        boolean default null,     -- null: all, true: dead only, false: hide dead
  f_section     text default null,
  f_style       text default null,
  f_effect      text default null,
  f_works_with  text default null,
  f_used_only   boolean default false,
  f_categories  text[] default null,      -- any of these categories (a toolkit)
  f_ids         bigint[] default null,    -- only these links (a member's saves)
  sort_by       text default 'newest',    -- newest | oldest | stars | title
  max_rows      integer default 60,
  skip_rows     integer default 0
)
returns setof jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with filtered as (
    select l.*
    from public.links l
    where (f_category   is null or l.category = f_category)
      and (f_categories is null or l.category = any (f_categories))
      and (f_ids        is null or l.id = any (f_ids))
      and (f_pricing    is null or l.pricing = f_pricing)
      and (f_source     is null or l.source = f_source)
      and (f_kind       is null or l.kind = f_kind)
      and (f_status     is null or l.status = f_status)
      and (f_tags       is null or l.tags @> f_tags)
      and (not f_oss    or l.is_open_source)
      and (not f_starred or l.starred)
      and (f_collection is null or f_collection = any (l.collections))
      and (f_language   is null or l.repo_language ilike f_language)
      and (f_type       is null or l.type = f_type)
      and (f_min_stars  is null or coalesce(l.repo_stars, 0) >= f_min_stars)
      and (not f_maintained or (
            coalesce(l.maturity, '') <> 'archived'
            and (l.repo_pushed_at is null or l.repo_pushed_at > now() - interval '1 year')))
      and (f_dead       is null or l.dead = f_dead)
      and (f_section    is null or f_section = any (l.sections))
      and (f_style      is null or f_style = any (l.style_tags))
      and (f_effect     is null or f_effect = any (l.effect_kind))
      and (f_works_with is null or exists (
            select 1 from unnest(l.works_with) w where w ilike '%' || f_works_with || '%'))
      and (not f_used_only or l.used_count > 0)
  ),
  kw as (
    select f.id,
           row_number() over (order by
             ts_rank_cd(f.fts, websearch_to_tsquery('english', q)) desc,
             (f.title ilike '%' || q || '%') desc,
             f.created_at desc) as r
    from filtered f
    where q is not null
      and (f.fts @@ websearch_to_tsquery('english', q)
           or f.title ilike '%' || q || '%'
           or f.domain ilike '%' || q || '%')
  ),
  sem as (
    select f.id,
           row_number() over (order by f.embedding operator(extensions.<=>) q_embedding) as r
    from filtered f
    where q is not null and q_embedding is not null and f.embedding is not null
    order by f.embedding operator(extensions.<=>) q_embedding
    limit 100
  ),
  hits as (
    select coalesce(kw.id, sem.id) as id,
           coalesce(1.0 / (60 + kw.r), 0) + coalesce(1.0 / (60 + sem.r), 0) as score
    from kw full join sem on sem.id = kw.id
  ),
  pool as (
    select f.*, h.score
    from filtered f
    join hits h on h.id = f.id
    where q is not null
    union all
    select f.*, null::numeric as score
    from filtered f
    where q is null
  )
  select (to_jsonb(p) - 'embedding' - 'fts' - 'score')
         || jsonb_build_object('total_count', count(*) over ())
  from pool p
  order by
    p.score desc nulls last,
    case when sort_by = 'oldest' then p.created_at end asc,
    case when sort_by = 'stars'  then coalesce(p.repo_stars, -1) end desc,
    case when sort_by = 'title'  then lower(coalesce(p.title, p.domain)) end asc,
    p.created_at desc
  limit greatest(max_rows, 0)
  offset greatest(skip_rows, 0)
$$;
revoke execute on function public.search_links from public, anon, authenticated;
