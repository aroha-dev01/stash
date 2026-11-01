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
| `CRON_SECRET` | optional, Vercel signs the nightly refresh with it |
| `STASH_TOKEN` | optional owner token for scripts; never put it in a phone shortcut |
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

Unset, or when Google's script cannot load, the site falls back to the
redirect sign-in. Showing the name "Stash" instead of a domain still needs
Google brand verification under Google Auth Platform, Branding.

## Database

Schema changes are versioned in `supabase/migrations` and applied in order.
New users get a `profiles` row automatically. Give someone Pro or the curator
role from `/admin`, Members. Pro is a plan and curator is a role: neither
implies the other. The first curator has to be set in SQL:

```sql
update public.profiles set is_admin = true, plan = 'pro' where email = '...';
```

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
