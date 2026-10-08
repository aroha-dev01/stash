# Connecting Stash to Claude as an MCP connector

Once deployed, Stash speaks MCP at:

```
https://stash-cyatra.vercel.app/api/mcp
```

Check it in a browser first — a plain GET returns a health summary listing the
tools and whether writing is enabled.

## Add it in Claude

Settings → Connectors → **Add custom connector** → paste the URL above.

Claude will call `initialize`, then `tools/list`, and the four tools appear.

## What your agents get

| Tool | Use |
|---|---|
| `search_tools` | Search by problem description, not product name. Filters for category and open-source. |
| `get_tool` | Full detail on one entry, including your private note. |
| `list_categories` | The shape of the library, with counts. |
| `save_tool` | Save a new find. Only present when a token is configured. |

The server also sends `instructions` on connect, telling the agent to check
your library *before* recommending anything third-party. That is what makes it
behave like your library rather than a search engine.

## Writing is off by default

Read tools are always available. `save_tool` only appears once `STASH_TOKEN` is
set as an environment variable in Vercel.

The reasoning: an open endpoint that reads a list of public tool links is a
small exposure. An open endpoint that lets anyone write into your library is
not. Rather than forcing you to configure a secret before anything works at
all, the server drops to read-only on its own and says so in its health check.

### To enable saving

1. Invent a long random string.
2. Vercel → stash-cyatra → Settings → Environment Variables → add
   `STASH_TOKEN` with that value.
3. Redeploy (`npx vercel --prod`).
4. Connect using the URL with the token appended:

   ```
   https://stash-cyatra.vercel.app/api/mcp?token=YOUR_TOKEN
   ```

   A bearer header is also accepted, and is the better option wherever the
   client lets you set headers, since URLs end up in logs.

Once a token is set, **all** access requires it, reads included.

## Trying it

Ask Claude, in any project connected to it:

> What have I saved that would help me build a pricing page?

It should call `search_tools`, then answer from your own collection.
