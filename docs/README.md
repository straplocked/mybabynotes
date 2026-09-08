# mybabynotes docs

Everything here documents a **self-hosted instance** — running one, building against one, or
changing the code. If you haven't installed it yet, start at the [project README](../README.md).

## Running an instance

| Doc | Read it when |
|---|---|
| [operations.md](operations.md) | Installing, updating, backups, moving a compose install to the all-in-one container, reverse proxies, SMTP, Postgres, lost passwords |
| [home-assistant.md](home-assistant.md) | Putting the app in the HA sidebar via the ingress add-on, or exposing the household as HA devices over MQTT |
| [known-limitations.md](known-limitations.md) | Something looks missing and you want to know whether it's a bug or a line we drew on purpose |

## Building against one

Three surfaces, all writing through the same server-side path as the app — an integration's entry
syncs to every phone instantly and obeys the same rules.

| Doc | Read it when |
|---|---|
| [integrations.md](integrations.md) | Writing a script or dashboard against the stable `/api/v1` — tokens, scopes, endpoints, entry semantics |
| [openapi.v1.json](openapi.v1.json) | Pointing a client generator at the spec. Generated from the code, and CI fails a stale one |
| [home-assistant.md](home-assistant.md) | Automating on MQTT entities instead of HTTP |
| [mcp.md](mcp.md) | Connecting Claude or another MCP client to the server built into the API at `/mcp` |

Not [api.md](api.md), though — that one documents the app's own `/api/*` wire format, which is
private, unversioned, and free to change in any commit. `/api/v1` is the contract.

## Working on the code

| Doc | Read it when |
|---|---|
| [architecture.md](architecture.md) | Before any structural change — container layout, [local-first sync](architecture.md#local-first-sync), poke-to-pull realtime, notifications, shift semantics, and why each was chosen |
| [api.md](api.md) | Changing or calling the internal PWA/sync API — every endpoint with payloads, auth, throttles, and error behaviour |
| [feeding-patterns.md](feeding-patterns.md) | Touching the age-aware insights — the sourced norms behind `WAKE_NORMS` / `FEED_NORMS`, phrased as context and never as medical advice |
| [ca-submission.md](ca-submission.md) | Shipping a change to the Unraid Community Apps template, or repeating the listing process |

Project conventions and invariants live in [CLAUDE.md](../CLAUDE.md), setup and the test commands in
[CONTRIBUTING.md](../CONTRIBUTING.md), and the trial-period feedback journal in
[TESTING.md](../TESTING.md). Security issues go through [private reporting](../SECURITY.md), never a
public issue.

## Also in this folder

`media/` — the README's screenshots. Every app shot is a light/dark pair (`now.png` alongside
`now-dark.png`), because the README's hero row follows the reader's GitHub theme.
