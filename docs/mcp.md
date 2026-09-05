# MCP server

MyBabyNotes ships an [MCP](https://modelcontextprotocol.io) server built into the API at **`/mcp`** — Claude (and any MCP client) can read the household's log, answer "how did last night go?", log entries, and run timers. Streamable HTTP, stateless: every JSON-RPC message is an ordinary HTTPS request to your instance, no extra process or port. All access is scoped to your household, same as the app; writes go through the identical server-side path, so phones update instantly and sync invariants hold.

Sibling surfaces: [integrations.md](integrations.md) (REST API — same tokens, same scopes), [home-assistant.md](home-assistant.md) (MQTT + add-on).

## Auth

A [personal access token](integrations.md#authentication) (Settings → API access) with the **`mcp`** scope plus the granular scopes for what the client may do. The `mcp` scope only opens the endpoint; each tool checks its own read/write scope.

- Full access: `mcp` + `entries:read` + `entries:write` + `timer:read` + `timer:write` + `children:read` + `profile:read`.
- **Read-only** (a client that can summarize but never log): `mcp` + `entries:read` + `children:read` + `profile:read`. Write tools return a clean permission error the model can relay (naming the missing scope).

Caregiver accounts can create MCP tokens and use every tool — by design, no household-management tools (settings, invites, members) exist in v1, so there is nothing parent-only to gate.

## Client setup

**Claude Code**

```bash
claude mcp add --transport http mybabynotes https://your-host/mcp \
  --header "Authorization: Bearer <token>"
```

**Claude Desktop** — no native HTTP-with-header config yet; bridge through `mcp-remote` in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mybabynotes": {
      "command": "npx",
      "args": [
        "mcp-remote", "https://your-host/mcp",
        "--header", "Authorization: Bearer <token>"
      ]
    }
  }
}
```

**Anything else** — any client speaking Streamable HTTP works: POST JSON-RPC to `https://your-host/mcp` with the `Authorization: Bearer` header on every request.

**Known limitation**: claude.ai web custom connectors require OAuth, which v1 does not ship — bearer-token clients only for now. OAuth is the planned path for a later release.

## Tools

All tools operate on the token's household — there is no household parameter anywhere. Times in tool arguments are ISO-8601; entry timestamps in results are what the API stores (ms epoch) plus human-readable renderings.

| Tool | Scope | Parameters | Does |
|---|---|---|---|
| `list-children` | `children:read` | — | The children (id, name, birthdate, age label, archived); first is the primary child |
| `list-entries` | `entries:read` | `baby_id?`, `types?`, `since?`, `until?` (ISO 8601), `limit?` (default 50, max 200) | Entries, newest first, tombstones excluded, author names resolved |
| `get-household-status` | `profile:read` | — | Members and roles, who's on duty, the children, the latest shift, every running timer with elapsed time |
| `get-daily-summary` | `entries:read` | `date?` (YYYY-MM-DD), `tz?` (IANA), `baby_id?` | One day rolled up server-side: bottle count and oz, nursing sessions, pumping sessions and oz, diapers by kind, sleep minutes, tummy time minutes, baths, meds |
| `log-entry` | `entries:write` | `type`, `time?` (ISO 8601, default now), `detail?`, `baby_id?` | Logs an entry (defaults: now, the primary child); attributed to the token's user |
| `update-entry` | `entries:write` | `id`, then any of `type`/`time`/`detail`/`baby_id` | Partial update, original author preserved; unknown or foreign id is a loud error |
| `delete-entry` | `entries:write` | `id` | Tombstone delete — syncs to every device, marked destructive |
| `get-timer` | `timer:read` | — | Every running timer with elapsed time (`timers`); `timer` is the caller's newest, kept for older clients |
| `start-timer` | `timer:write` | `type` (`nurse`/`pump`/`sleep`/`tummy`), `baby_id?` | Starts a timer; timers stack, and re-starting an identical session (same type, child, starter) returns the one already running |
| `stop-timer` | `timer:write` (+ `entries:write` to log) | `timer_id?`, `log?` (bool, default `true`), `detail?` | Stops one timer (`timer_id` from `get-timer`; omitted = the caller's newest); with `log: true` it also writes the matching entry — sleep and tummy time log the elapsed minutes as `detail`, nurse/pump log the `detail` you pass (side / ounces). The convenience the raw [REST timer](integrations.md#delete-v1timer--timerwrite) leaves to the caller |

Entry `type` and `detail` follow the same conventions as the REST API — see the [semantics table in integrations.md](integrations.md#entry-semantics) (`bottle`/`pump` detail = oz, `nurse` = side, `sleep`/`tummy` = minutes). The server's MCP instructions carry these semantics too, so models use them without being told.

## Resources

One resource, `household-overview` (`profile:read` + `entries:read`): a markdown snapshot of the household — children with birthdates, members, who's on duty, the running timers, and today's headline numbers. Useful as ambient context for clients that attach resources automatically. No prompts in v1.

## Rate limit

120 requests/min per user, **shared with the app's bucket** (unlike `/api/v1`, which gets its own). An MCP session is chatty but bursty; if a client hits 429, it backs off like any HTTP client.
