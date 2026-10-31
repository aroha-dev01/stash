-- Access tiers, curated featured entries, and the client behind each key.
--
--   links.access     who may open an entry:
--                      public   anyone, signed out included
--                      free     any signed-in member
--                      premium  members on Pro, and curators
--                    Replaces links.is_premium, which meant "signed in only"
--                    and so maps to 'free'. is_premium stays for now so the
--                    deployment still running on it keeps working; the API
--                    writes both until it is dropped.
--   links.featured   the curator's homepage and Explore picks
--   mcp_keys.last_client
--                    the clientInfo name an agent sent on its last
--                    initialize, so setup can show which app connected
--
-- Whole toolkits can also be locked to Pro (app_settings.catalogue
-- .premium_toolkits). Toolkits are defined in lib/taxonomy.js, so the server
-- turns that setting into f_hide_categories for search_links.

alter table public.links
  add column access text not null default 'public' check (access in ('public', 'free', 'premium')),
  add column featured boolean not null default false;

update public.links set access = 'free' where is_premium;

create index links_access_idx on public.links (access);
create index links_featured_idx on public.links (featured) where featured;

alter table public.mcp_keys add column last_client text;

-- New entries default to public unless the curator says otherwise.
update public.app_settings
set value = value || jsonb_build_object(
  'new_entries_access', case when (value ->> 'new_entries_premium')::boolean then 'free' else 'public' end,
  'premium_toolkits', '[]'::jsonb
)
where key = 'catalogue';

-- search_links gains the access filters. Every caller passes the tiers the
-- viewer may open and the categories of toolkits locked to them, so totals
-- and pagination already exclude what they cannot see.
drop function public.search_links;

create function public.search_links(
  q                 text default null,
  q_embedding       extensions.vector(384) default null,
  f_category        text default null,
  f_pricing         text default null,
  f_source          text default null,
  f_kind            text default null,
  f_status          text default null,
  f_tags            text[] default null,
  f_oss             boolean default false,
  f_starred         boolean default false,
  f_collection      text default null,
  f_language        text default null,
  f_type            text default null,
  f_min_stars       integer default null,
  f_maintained      boolean default false,
  f_dead            boolean default null,     -- null: all, true: dead only, false: hide dead
  f_section         text default null,
  f_style           text default null,
  f_effect          text default null,
  f_works_with      text default null,
  f_used_only       boolean default false,
  f_categories      text[] default null,      -- any of these categories (a toolkit)
  f_ids             bigint[] default null,    -- only these links (a member's saves)
  f_access          text[] default null,      -- only these tiers; null: every tier (curators)
  f_hide_categories text[] default null,      -- never these categories ('' stands for none)
  f_featured        boolean default false,    -- curator picks only
  sort_by           text default 'newest',    -- newest | oldest | stars | title
  max_rows          integer default 60,
  skip_rows         integer default 0
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
      and (f_access     is null or l.access = any (f_access))
      and (f_hide_categories is null or not (coalesce(l.category, '') = any (f_hide_categories)))
      and (not f_featured or l.featured)
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
