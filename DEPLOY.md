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
| `STASH_TOKEN` | optional owner token for scripts; also enables the hidden iOS save endpoint |

For local work, copy `.env.example` to `.env.local`. Never put real keys in
`.env.example`, which is committed.

## Supabase Auth

Google is the only provider. Under Authentication, URL Configuration:

- Site URL: `https://stashkit.vercel.app`
- Redirect URLs: `https://stashkit.vercel.app/auth/callback`,
  `http://localhost:3000/auth/callback`, and the preview pattern
  `https://*-aroha5.vercel.app/auth/callback` if previews should sign in.

## Database

Schema changes are versioned in `supabase/migrations` and applied in order.
New users get a `profiles` row automatically. To make someone a curator or give
them Pro before payments exist:

```sql
update public.profiles set is_admin = true, plan = 'pro' where email = '...';
```

## The iOS share sheet (hidden)

`/api/save` answers only to `STASH_TOKEN` and returns 404 otherwise. It is a
developer feature until it ships as part of Pro; the Shortcut URL is
`https://stashkit.vercel.app/api/save?token=STASH_TOKEN&text=1&url=` with
`url=` last.
