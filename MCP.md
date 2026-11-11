# Connecting an agent to Stash over MCP

Stash speaks MCP (streamable HTTP, JSON-RPC over POST) at:

```
https://stash.aruo.dev/api/mcp
```

Keys made for the old address, `https://stashkit.vercel.app/api/mcp`, keep
working there; it is the same server.

A plain GET returns a health summary listing the tools.

## Keys

Every call needs a member's key. Members create keys on `/connect`, the setup
guide, which shows the exact setup for Claude Code, Cursor, VS Code (Copilot),
Claude and Windsurf with the key filled in. Send it as
`Authorization: Bearer <key>`, or as `?key=` for clients that only take a URL.

## Sign-in (OAuth), for Claude's custom connectors

Claude's connectors (and any client following the MCP auth spec) connect with
just the address: the member presses Connect, Stash's sign-in page opens, they
sign in and press Allow, and the client gets a key of its own, named after the
app and listed with the rest on `/connect`, where it can be revoked.
`lib/oauth.js` is all of it:

| Path | What it is |
|---|---|
| `/.well-known/oauth-protected-resource` (also `/api/mcp` under it) | RFC 9728: which server signs callers in. The 401 from `/api/mcp` points here in `WWW-Authenticate` |
| `/.well-known/oauth-authorization-server` | RFC 8414: the endpoints below |
| `/api/oauth/register` | Dynamic client registration (RFC 7591) |
| `/oauth/authorize` | The member signs in and allows the app; `POST /api/oauth/authorize` is its Allow button |
| `/api/oauth/token` | A code (or refresh token) in, a Stash key out |

There is no table for it. Client ids, codes and refresh tokens are sealed with
AES-256-GCM under `MCP_OAUTH_SECRET` (or, unset, a key derived from
`SUPABASE_SERVICE_ROLE_KEY`; rotating either asks connected apps to register
again, but their keys keep working). PKCE S256 is required, a code lasts five
minutes, and the key a code buys is derived from it, so trading a code twice
returns the same key instead of a second one. The 5-key limit applies; the
consent page says so before the member presses Allow. Metadata names whichever
host it is read on, so the old address works too.

`proxy.js` never applies the AI-crawler filter to `/api/mcp`, `/api/oauth` or
`/.well-known`: Claude's own user agents (`Claude-User`, `anthropic-ai`) are on
its list, and it used to answer them 403 on the MCP server itself.

Stash stores only a SHA-256 of each key, and a revoked key stops working on the
next call. Each key records when it was last used and the `clientInfo.name` its
agent sent on `initialize`, which is how the setup guide shows "Connected"
only after a real call. `STASH_TOKEN` (a Vercel env var) still works as an
owner key for scripts.

## What each plan sees

Entries carry an access tier (`links.access`), and curators lock whole
toolkits to Premium from `/admin`, Settings (UI/UX Development, Content
Creation and Automation are locked). `lib/access.js` is the one policy for the
website, the catalogue API and every MCP tool and resource. Premium is the
`pro` plan in the database.

| Caller | Entries returned |
|---|---|
| Free key | the Free collection: `public` and `free` entries outside Premium toolkits (50 today) |
| Premium key | everything (315 live entries today) |
| Curator key, `STASH_TOKEN` | everything, plus the owner's private fields |

Searches pass the policy into `search_links`, so locked entries never leave
the database; lookups by id (`get_tool`, `how_to_use`, `mark_used`,
`stash://link/{id}`) answer a locked entry with an upgrade message and nothing
about the entry itself.

## What each plan can call

| Tool | Plan |
|---|---|
| `search_tools`, `get_tool`, `how_to_use`, `list_categories`, `find_inspiration` | Free |
| `mark_used` | Free (adds the tool to the member's saved list) |
| `build_stack`, `compare_tools`, `review_project`, `ask_stash` | Premium |
| `save_tool` | Curators only |

Premium tools stay listed for free members, prefixed `[Stash Premium]`, and
answer with an upgrade message, so an agent can tell the user why.

## Limits

Each account's keys share 60 calls a minute and 1,500 a day; past that the
server answers HTTP 429 with a JSON-RPC error (`-32029`) and `retry-after`.
`resources/list` lists only the entries a member has saved (at most 50); the
whole-library `stash://index` resource is for curators. Searches return at
most 25 entries a call.

## Privacy

The owner's private fields (`note`, `why`, `used_in`, `collections`, which name
real client projects) are only ever returned to an admin key. `render()` leaves
them out and `scrub()` strips them from every other response as a backstop.
