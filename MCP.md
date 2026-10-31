# Connecting an agent to Stash over MCP

Stash speaks MCP (streamable HTTP, JSON-RPC over POST) at:

```
https://stashkit.vercel.app/api/mcp
```

A plain GET returns a health summary listing the tools.

## Keys

Every call needs a member's key. Members create keys on `/connect`, the setup
guide, which shows the exact setup for Claude Code, Cursor, VS Code (Copilot),
Claude and Windsurf with the key filled in. Send it as
`Authorization: Bearer <key>`, or as `?key=` for clients that only take a URL
(Claude's custom connectors).

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

## Privacy

The owner's private fields (`note`, `why`, `used_in`, `collections`, which name
real client projects) are only ever returned to an admin key. `render()` leaves
them out and `scrub()` strips them from every other response as a backstop.
