# Deploying Stash

Production is the Vercel project **stashkit** (team `aroha5`), served at
https://stashkit.vercel.app. Database, auth and the `embed` function live in
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

For local work, copy `.env.example` to `.env.local`. Never put real keys in
`.env.example`, which is committed.

## Supabase Auth

Google is the only provider. Under Authentication, URL Configuration:

- Site URL: `https://stashkit.vercel.app`
- Redirect URLs: `https://stashkit.vercel.app/**`,
  `http://localhost:3000/**`, and the preview pattern
  `https://*-aroha5.vercel.app/**` if previews should sign in.

If an address is missing, Supabase silently sends people to the Site URL
instead, which is how new members once landed on an old deployment.

## Database

Schema changes are versioned in `supabase/migrations` and applied in order.
New users get a `profiles` row automatically. Give someone Pro or the curator
role from `/admin`, Members. The first curator has to be set in SQL:

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
