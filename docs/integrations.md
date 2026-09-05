# Public API (v1)

The stable, versioned REST API for scripts, dashboards, and third-party integrations. It is one of three integration surfaces — see also [home-assistant.md](home-assistant.md) (MQTT entities + HA add-on) and [mcp.md](mcp.md) (MCP server for AI clients). All three write through the same server-side path as the app, so sync invariants ([architecture.md](architecture.md#local-first-sync)) hold no matter who writes.

## Two API surfaces

| Surface | Base path | Contract |
|---|---|---|
| Internal (PWA) | `/api/*` (unversioned) | **Private and unstable.** The app's own wire format, documented in [api.md](api.md) for contributors. It changes whenever the app needs it to; nothing outside this repo should depend on it. |
| Public | `/api/v1/*` | **This document.** Frozen shape, additive-only changes. |

Versioning policy: v1 never breaks. New fields, new endpoints, and new optional parameters may appear; existing fields never change meaning or disappear. A breaking change means a new `/api/v2` prefix, with v1 kept alive and answering `Deprecation`/`Sunset` headers until a documented end date.

## Authentication

Personal access tokens (PATs), created in the app under **Settings → API access**. Send on every request:

```
Authorization: Bearer <token>
Accept: application/json
```

Token lifecycle:

- The plaintext token is shown **once**, at creation. Only a SHA-256 hash is stored; a lost token is replaced, never recovered.
- Optional expiry at creation: 30, 90, or 365 days, or no expiry. Default 90. Expiry is **fixed** — PATs never slide, unlike the app's login tokens, which extend with use. An expired PAT is a 401; make a new one.
- Revocable individually from the same Settings card.
- Up to 10 PATs per user. Scopes are chosen at creation and can't be edited afterward — revoke and re-create.

What kills tokens:

| Event | App login tokens | PATs |
|---|---|---|
| Password **reset** (forgot-password flow) | all revoked | all revoked |
| Password **change** (Settings, knows current password) | other devices revoked | survive |
| Member removed from household | revoked | revoked |
| Explicit revoke in Settings | — | that token only |

## Scopes

Every PAT carries one or more scopes; a route rejects a token without its scope with 403. Defined in one place server-side (`ApiScopes`) and shared verbatim by the token UI, the OpenAPI spec, and the [MCP tools](mcp.md#auth).

| Scope | Grants |
|---|---|
| `profile:read` | `GET /v1/me` — your account, household members, who's on duty |
| `children:read` | `GET /v1/children`, `GET /v1/children/{id}` |
| `entries:read` | `GET /v1/entries`, `GET /v1/entries/{id}` |
| `entries:write` | `POST /v1/entries`, `PATCH /v1/entries/{id}`, `DELETE /v1/entries/{id}` |
| `timer:read` | `GET /v1/timer` |
| `timer:write` | `PUT /v1/timer`, `DELETE /v1/timer` |
| `mcp` | The `/mcp` endpoint ([mcp.md](mcp.md)) — combine with read/write scopes above |

Everything is scoped to the token owner's household; there is no cross-household access and no household id in any request. Reads and writes are attributed to the token's user.

## Endpoints

All routes: `auth` + scope check + the `v1` rate limit. Entry timestamps (`t`) and revs are milliseconds since the Unix epoch, UTC.

### `GET /v1/me` — `profile:read`

The caller (`user`), the household roster (id, name, role) with the on-duty member's id (`household`), and `server_time` (ms).

### `GET /v1/children` — `children:read`

The household's children, id-ordered — **the first is the primary child** (where legacy writes without a `baby_id` land). Includes archived children (`archived: true`); archiving is the only retirement, children are never deleted.

### `GET /v1/children/{id}` — `children:read`

One child. A child in another household is a 404, indistinguishable from a missing id.

### `GET /v1/entries` — `entries:read`

Filters (all optional, combinable):

| Param | Meaning |
|---|---|
| `baby_id` | Only this child's entries. Must be in the household → otherwise 422. |
| `type` | Only this entry type (e.g. `bottle`). |
| `t_min`, `t_max` | Entry-time range, ms epoch, inclusive. |
| `updated_after` | Only entries with `rev` greater than this — the incremental-sync filter. |
| `include_deleted` | `true` to include tombstones (default `false`). Sync-style consumers using `updated_after` want this on, or deletes are invisible. |
| `sort` | `-t` (default, newest first, `id` tiebreak) or `rev` (oldest change first — pair with `updated_after`). |
| `per_page` | Page size, default 100, max 500. |
| `cursor` | Opaque cursor from the previous page's `next_cursor`. |

Cursor-paginated: the response carries the page in `data` and `meta.next_cursor` (null on the last page) to pass back as `?cursor=`. Cursors are opaque — don't parse them.

### `POST /v1/entries` — `entries:write`

```json
{ "id": "optional-client-uuid", "type": "bottle", "t": 1750000000000, "detail": "4", "baby_id": 10 }
```

- `id` is optional; supply your own UUID if you want idempotent creates or offline-style merging, otherwise the server generates one.
- `baby_id` optional; absent → the primary child.
- Returns 201 with the created entry (and its server-stamped `rev`).

### `GET /v1/entries/{id}` — `entries:read`

One entry, tombstones included. Foreign household → 404.

### `PATCH /v1/entries/{id}` — `entries:write`

Partial update — send only the fields you're changing (`type`, `t`, `detail`, `baby_id`). Unsent fields are preserved; an update never re-homes an entry to a different child unless `baby_id` is explicitly sent. The original author's `user_id` is preserved. Returns the updated entry with a fresh `rev`.

### `DELETE /v1/entries/{id}` — `entries:write`

**Tombstone, not erasure**: sets `deleted: true` with a fresh `rev`, so every device and consumer syncs the delete. Returns 200 with the tombstoned entry. There is no hard delete.

### `GET /v1/timer` — `timer:read`

The household's running timers. `timers` lists every one — `{id, type, started_at, user_id, baby_id}` in start order; timers stack, so a nursing timer for one twin can run beside a sleep timer for the other. `timer` is the legacy singular slot (your newest, or null), kept for pre-multi-timer clients.

### `PUT /v1/timer` — `timer:write`

```json
{ "type": "nurse", "baby_id": 10 }
```

Starts a timer. `type` ∈ `nurse|pump|sleep|tummy`. Starting an identical session you already have running (same type, child, and starter) returns the running timer instead of a duplicate. Other members get their usual timer push.

### `DELETE /v1/timer` — `timer:write`

Stops one timer — `?id=<timer id>` picks which; omitted, it stops your newest — returning what was running as `stopped` (null if nothing matched). **Does not write an entry** — the consumer logs the resulting nurse/pump/sleep/tummy entry itself via `POST /v1/entries`, exactly as the app does. (The [MCP `stop-timer` tool](mcp.md#tools) offers the log-on-stop convenience; raw REST keeps the two steps explicit.)

## Entry semantics

An entry is `{id, user_id, baby_id, type, t, detail, deleted, rev}`.

- **`type`** is a short string (≤20 chars), not an enum. Ten types are the app's convention:

  | Type | `detail` means |
  |---|---|
  | `bottle` | amount in **oz** (always oz on the wire; ml is a display setting) |
  | `nurse` | which side |
  | `pump` | amount in **oz** |
  | `wet`, `dirty`, `both` | — (diaper kinds) |
  | `sleep` | duration in **minutes** — bare (`45`) or with a nap/night tag (`Nap · 45m`) |
  | `tummy` | tummy time duration in **minutes** |
  | `bath` | — |
  | `meds` | — |

- **`detail`** is a nullable string ≤100.
- **`baby_id`** in responses is always a concrete child id — the API resolves the legacy "null means primary child" rule for you.
- **Last write wins**, keyed by `rev` (server-stamped ms). Concurrent edits from the app, v1, MQTT, and MCP all converge through the same rule.
- **Deletes are tombstones** (`deleted: true`); filter them in views, honor them in syncs.

Every write pokes the household's realtime channel, so phones update instantly — an integration's writes are indistinguishable from the app's.

## Errors

Standard Laravel JSON errors:

| Status | Meaning |
|---|---|
| 401 | Missing/bad/expired token |
| 403 | Token lacks the route's scope |
| 404 | Resource not in your household (or doesn't exist — deliberately the same) |
| 422 | Validation failure — `{message, errors}` |
| 429 | Rate limited |

## Rate limits

- **120 requests/min per user** on `/api/v1`, in its **own bucket** — an integration hammering v1 can't starve the app's sync, and vice versa.
- ~20 requests/s per IP at nginx, shared across everything under `/api`.

Poll politely: `GET /v1/entries?updated_after=<last rev>&include_deleted=true&sort=rev` once a minute costs one request and returns nothing when nothing changed.

## Examples

```bash
HOST=https://notes.example.com
AUTH='Authorization: Bearer <token>'

# Who am I, who's on duty
curl -s "$HOST/api/v1/me" -H "$AUTH" -H 'Accept: application/json'

# Last 24h of feedings for child 10
curl -s "$HOST/api/v1/entries?baby_id=10&type=bottle&t_min=$(( ($(date +%s) - 86400) * 1000 ))" \
  -H "$AUTH" -H 'Accept: application/json'

# Log a 4 oz bottle, now
curl -s -X POST "$HOST/api/v1/entries" \
  -H "$AUTH" -H 'Content-Type: application/json' -H 'Accept: application/json' \
  -d "{\"type\":\"bottle\",\"t\":$(date +%s)000,\"detail\":\"4\"}"

# Incremental sync loop: everything changed since <rev>, deletes included
curl -s "$HOST/api/v1/entries?updated_after=<rev>&include_deleted=true&sort=rev" \
  -H "$AUTH" -H 'Accept: application/json'

# Start a sleep timer, later stop it and log the nap yourself
curl -s -X PUT "$HOST/api/v1/timer" -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"type":"sleep","baby_id":10}'
curl -s -X DELETE "$HOST/api/v1/timer" -H "$AUTH"
```

## OpenAPI

The machine-readable spec lives at [docs/openapi.v1.json](openapi.v1.json) — generated from the code, committed, and CI-enforced (the build fails if the spec drifts from the routes). Point your client generator at it.

## v1.0 policy notes

- **PATs are technically accepted on the internal `/api/*` routes.** This is undocumented and unsupported — internal routes have no scope checks and no stability promise, and this may be hardened away in a later release. Build against `/api/v1` only.
- **Caregivers may create tokens.** A token never exceeds its account's own role, and v1 has no parent-only writes, so a caregiver's PAT can do exactly what the caregiver can do in the app — no more.
