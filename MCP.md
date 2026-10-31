# Connecting an agent to Stash over MCP

Stash speaks MCP (streamable HTTP, JSON-RPC over POST) at:

```
https://stashkit.vercel.app/api/mcp
```

A plain GET returns a health summary listing the tools.

## Keys

Every call needs a member's key. Members create keys on `/account`; the page
shows the exact setup for Claude, Claude Code, Cursor, VS Code (Copilot) and
Windsurf with the key filled in. Send it as `Authorization: Bearer <key>`, or
as `?key=` for clients that only take a URL (Claude's custom connectors).

Stash stores only a SHA-256 of each key, and a revoked key stops working on the
next call. `STASH_TOKEN` (a Vercel env var) still works as an owner key for
scripts.

## What each plan gets

| Tool | Plan |
|---|---|
| `search_tools`, `get_tool`, `how_to_use`, `list_categories`, `find_inspiration` | Free |
| `mark_used` | Free (adds the tool to the member's saved list) |
| `build_stack`, `compare_tools`, `review_project`, `ask_stash` | Pro |
| `save_tool` | Curators only |

Pro tools stay listed for free members, prefixed `[Stash Pro]`, and answer with
an upgrade message, so an agent can tell the user why.

## Privacy

The owner's private fields (`note`, `why`, `used_in`, `collections`, which name
real client projects) are only ever returned to an admin key. `render()` leaves
them out and `scrub()` strips them from every other response as a backstop.
