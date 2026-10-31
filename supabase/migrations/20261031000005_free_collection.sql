-- The curated Free collection, and Premium toolkits.
--
-- Free members get a hand-sized collection of about 50 entries; signed-out
-- visitors get a smaller sample of it; Premium (the `pro` plan) and curators
-- get everything. UI/UX Development, Content Creation and Automation are
-- Premium toolkits (app_settings.catalogue.premium_toolkits), so the Free
-- collection is drawn from the two toolkits that stay open: Development and
-- Research & Analytics. The category lists below mirror lib/taxonomy.js.
--
-- Deterministic, no hard-coded ids. Within each open toolkit, entries rank by:
--   1. has install steps (an agent can act on it)
--   2. kind: mcp-server, cli, library, template, app, saas, then reading
--   3. GitHub stars
--   4. has a preview image
--   5. id, so ties always break the same way
-- The top 30 in Development and the top 20 in Research & Analytics are Free.
-- 'Other' (the fallback for anything unfiled) is never part of it.
-- The 15 best-ranked of those with a preview image are public (the visitor
-- sample) and featured. Everything else is premium.
--
-- Curators adjust any entry afterwards in /admin, Catalogue. links.is_premium
-- is left as it was, so a deployment still reading it behaves as before; the
-- previous tiers can be rebuilt from it (is_premium -> 'free', else 'public').

with open_kits as (
  select l.id, l.image,
    case when l.category = any (array[
      'AI Coding Tools', 'LLM APIs & Models', 'Vector DBs & RAG', 'Databases & Backend',
      'Auth & Identity', 'Payments & Billing', 'APIs & Integrations', 'Deployment & Hosting',
      'DevTools & CLI', 'Testing & Monitoring', 'Security & Privacy'
    ]) then 'development' else 'research' end as toolkit,
    row_number() over (
      partition by l.category = any (array[
        'AI Coding Tools', 'LLM APIs & Models', 'Vector DBs & RAG', 'Databases & Backend',
        'Auth & Identity', 'Payments & Billing', 'APIs & Integrations', 'Deployment & Hosting',
        'DevTools & CLI', 'Testing & Monitoring', 'Security & Privacy'
      ])
      order by
        (coalesce(l.install, '') <> '') desc,
        array_position(array['mcp-server', 'cli', 'library', 'template', 'app', 'saas', 'reference', 'article'], l.type) nulls last,
        coalesce(l.repo_stars, 0) desc,
        (l.image is not null) desc,
        l.id
    ) as rank
  from public.links l
  where not l.dead
    and coalesce(l.category, 'Other') <> 'Other'
    and not (coalesce(l.category, '') = any (array[
      'Design Inspiration', 'UI Components & Elements', 'Onboarding & Product Tours', 'Icons & Illustrations',
      'Fonts & Typography', 'Color & Design Systems', 'Animation & Motion', 'Landing Pages & Templates',
      'Charts & Data Viz', '3D & Graphics',
      'Image Generation & Editing', 'Video Generation & Editing', 'Audio, Voice & Music',
      'Screenshots & Screen Recording', 'Docs & Knowledge Bases',
      'AI Agents & Frameworks', 'Prompting & Evals', 'Automation & Workflows', 'Scraping & Data Extraction',
      'No-code & Builders', 'Email & Notifications'
    ]))
),
free_set as (
  select * from open_kits
  where (toolkit = 'development' and rank <= 30) or (toolkit = 'research' and rank <= 20)
),
sample as (
  select id from free_set
  where image is not null
  order by rank, (toolkit = 'development') desc, id
  limit 15
)
update public.links l
set access = case
      when l.id in (select id from sample) then 'public'
      when l.id in (select id from free_set) then 'free'
      else 'premium'
    end,
    featured = l.featured or l.id in (select id from sample);

update public.app_settings
set value = value || jsonb_build_object(
  'premium_toolkits', '["ui-ux", "content", "automation"]'::jsonb,
  'free_target', 50,
  'new_entries_access', 'premium'
)
where key = 'catalogue';
