# Deploying Stash

Production is the Vercel project **stashkit** (team `aroha5`), served at
https://stash.aruo.dev. The old address, https://stashkit.vercel.app, still
answers `/api` (members' agents are configured with it) and sends every page
to the new domain (`proxy.js`). Database, auth and the `embed` function live in
the Supabase project **Stash** (`soynjbihrhcxyaimptjl`).

## Environment variables (Vercel, Production and Preview)

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://soynjbihrhcxyaimptjl.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase, Project Settings, API keys, Legacy, `service_role` (server only) |
| `NEXT_PUBLIC_SUPABASE_URL` | same as `SUPABASE_URL` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the `sb_publishable_...` key |
| `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` | enrichment, the assistant and the Pro MCP tools |
| `GITHUB_TOKEN` | optional, higher GitHub rate limits for repo stats |
| `CRON_SECRET` | required for the nightly refresh: Vercel signs its cron call with it, and `/api/cron/refresh` refuses every call without it (or `STASH_TOKEN`) |
| `STASH_TOKEN` | optional owner token for scripts; never put it in a phone shortcut |
| `MCP_OAUTH_SECRET` | optional, any long random string; seals MCP sign-in codes (`lib/oauth.js`). Unset, a key derived from `SUPABASE_SERVICE_ROLE_KEY` is used |
| `GOOGLE_CLIENT_ID` | optional, the Google OAuth client ID (not the secret); switches on Google's own sign-in button, see below |

For local work, copy `.env.example` to `.env.local`. Never put real keys in
`.env.example`, which is committed.

## Supabase Auth

Google is the only provider. Under Authentication, URL Configuration:

- Site URL: `https://stash.aruo.dev`
- Redirect URLs: `https://stash.aruo.dev/**`, `https://stashkit.vercel.app/**`,
  `http://localhost:3000/**`, and the preview pattern
  `https://*-aroha5.vercel.app/**` if previews should sign in.

If an address is missing, Supabase silently sends people to the Site URL
instead, which is how new members once landed on an old deployment.

### Google's sign-in button

With `GOOGLE_CLIENT_ID` set, sign-in uses Google's own button
(`app/_ui/GoogleButton.jsx`) and `signInWithIdToken`, so nobody passes through
Supabase's callback and Google's screen names this site instead of
`<project>.supabase.co`. To switch it on:

1. Google Cloud Console, the OAuth web client Supabase uses: add every site
   origin under **Authorized JavaScript origins**
   (`https://stash.aruo.dev` and `http://localhost:3000`).
2. Supabase, Authentication, Providers, Google: the same client ID must be
   the provider's client ID (or listed among its client IDs).
3. Set `GOOGLE_CLIENT_ID` in Vercel and redeploy. It is read at build time
   and `next.config.mjs` passes it to the browser, which needs it to draw the
   button; it is only passed when it has the shape of a client ID.

The button's ID token is posted to `/auth/google`, and the server trades it
with Supabase (`app/auth/google/route.js`), so a visitor's browser only talks
to Google and stash.aruo.dev. Keep it that way: some networks cannot reach
`*.supabase.co` at all (UAE carriers Etisalat and du blocked it by DNS in
2025, Indian ISPs in 2026), and a browser-side call there fails with nothing
in our logs.

Unset, or when Google's script cannot load, the site falls back to the
redirect sign-in. That one does pass through `<project>.supabase.co`, so it
cannot work on those networks. Showing the name "Stash" instead of a domain still needs
Google brand verification under Google Auth Platform, Branding.

## Database

Schema changes are versioned in `supabase/migrations` and applied in order.
New users get a `profiles` row automatically. Give someone Pro or the curator
role from `/admin`, Members. Pro is a plan and curator is a role: neither
implies the other. The first curator has to be set in SQL:

```sql
update public.profiles set is_admin = true, plan = 'pro' where email = '...';
```

## Projects (Premium)

`/projects` lets a Premium member make a project per thing they build, split
into folders (Frontend, Backend, UI/UX...) from a template in
`lib/projectTemplates.js`, and file catalogue entries in each folder. Their
agent reads a project over MCP with `get_project` (see MCP.md).

- Tables: `projects`, `project_folders`, `project_items`
  (`supabase/migrations/20261111000007_projects.sql`). Every row carries
  `user_id`, and composite foreign keys stop a folder or item sitting under
  another member's project. RLS is on with no policies and no grants to `anon`
  or `authenticated`, like every other table.
- Limits: 30 projects, 12 folders a project, 40 skills a folder, 150 a project,
  enforced by triggers as well as in `lib/projects.js`.
- `lib/projects.js` is the only code that touches the tables; the web API
  (`/api/projects/...`, through `lib/projectApi.js`) and the MCP server both
  call it, and both check Premium first. A member who leaves Premium keeps
  their projects; they are not served until they return.

## Writes from other sites

`proxy.js` refuses POST, PUT, PATCH and DELETE whose `Origin` or
`Sec-Fetch-Site` says they came from anywhere but Stash's own pages, before
any route runs. The session cookie is SameSite=Lax, which does not stop a
sibling `*.aruo.dev` subdomain. `/api/mcp`, `/api/save`, `/api/cron`,
`/api/backfill` and the OAuth token and registration endpoints are exempt:
they authenticate with their own keys, and browser-based MCP clients call
them from other origins.

## The iOS share sheet (curators only)

Set up from `/admin`, iOS shortcut: switch on "Accept links", create a key for
each phone and follow the guide there, which also shows live whether the phone
is connected. `/api/save` answers to a curator's shortcut key
(`Authorization: Bearer ios_stash_...`) while the switch is on, and to
`STASH_TOKEN` for scripts. Everyone else gets a 404. Shortcut keys can only
save links; they never open the MCP server.

## Access tiers and featured entries

`20261031000004_access_tiers` adds `links.access` (`public`, `free`,
`premium`) and `links.featured`. `20261031000005_free_collection` curates the
Free collection deterministically (see the migration for the ranking): 15
public entries are the signed-out sample, 35 more are for members, the rest
are Premium, and UI/UX Development, Content Creation and Automation are
Premium toolkits. Curators adjust any entry in `/admin`, Catalogue (the Free
collection view shows the count against its target of 50) and toolkits in
`/admin`, Settings. New entries start as Premium.
`links.is_premium` is the old "members only" flag: it is still written in step
with `access` so an older deployment keeps working, and can be dropped once
every deployment reads `access`.

## Analytics

The site sends a few named funnel events (`landing_view` is the page view;
`explore_opened`, `search_submitted`, `connect_cta_clicked`, `config_copied`,
`mcp_connection_verified` and so on) through Vercel Web Analytics. Turn Web
Analytics on for the project in the Vercel dashboard; custom events need a plan
that includes them. Events never carry keys, search text or anything typed.

## Keeping the catalogue from being copied

`lib/guard.js` holds the rules. In short:

- **Bots.** `/api/catalog`, `/api/catalog/[id]`, `/api/saves` and `/api/chat`
  answer only a real browser. `instrumentation-client.js` lists them for
  Vercel BotID and the routes call `guard()`, so a script calling them gets a
  403. BotID only judges on Vercel; locally every request counts as human,
  and `BOTID_TEST=BAD-BOT` simulates a bot. For stronger detection, turn on
  BotID Deep Analysis under the project's Firewall tab (paid plans).
- **Pace.** Each account (or IP when signed out) gets a per-minute and
  per-day allowance for the catalogue, entry pages, saves, the assistant
  and MCP, counted by `rate_hit()` from `20261101000006_rate_limits`. Past
  it, APIs answer 429 with `retry-after` and pages show a short "slow down"
  page. Limited callers are logged as `rate limited <rule> <caller>`.
- **No bulk exports.** An Explore page is at most 24 entries. Over MCP,
  `resources/list` gives members only their saved entries, and the
  whole-library `stash://index` is for curators.
- **AI crawlers.** `robots.txt` disallows them and `proxy.js` answers the
  known ones with 403. Search engines still index the public pages.

None of this stops a paying member copying what they can see by hand; it
makes copying by machine slow, visible in the logs and tied to one account.

## Region and floods

- **Region.** Functions run in `dub1` (Dublin, `vercel.json`), the same AWS
  region as the database (Supabase `eu-west-1`, Ireland). Every page makes
  several database and Auth calls, so they must sit next to it; visitors
  still reach Vercel's nearest edge (Mumbai, Dubai...) first. If the database
  ever moves, move `regions` with it.
- **Per-IP flood limits** (`lib/flood.js`, run first in `proxy.js`, free:
  in memory, no Vercel Firewall rules). Before any session check or database
  call, each IP gets per minute: 30 sign-in requests (`/login`, `/auth/*`,
  `/oauth/*`), 300 API requests (`/api/*`, MCP included) and 600 pages, then
  429 with `retry-after`. Counts are per server instance, so they cut floods
  rather than meter people; the per-account allowances in `lib/guard.js` are
  the exact ones. Vercel cron is never counted. Hosted agents reach MCP from
  their providers' shared IPs, so raise `FLOOD.api` as members grow.
- **DDoS.** Vercel mitigates network and volumetric floods automatically on
  every plan. Under a real attack, switch on Attack Challenge Mode
  (Firewall tab, or `vercel firewall attack-mode enable`); it challenges every
  visitor, so agents and the iOS shortcut stop working until it is off again.
- **Keys cannot be guessed.** MCP and shortcut keys are 192 random bits,
  stored only as SHA-256; OAuth client ids, codes and refresh tokens are
  sealed with AES-256-GCM (`lib/oauth.js`); shared secrets are compared in
  constant time (`lib/secrets.js`).
