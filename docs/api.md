# API Reference

This documents the **internal PWA/sync API** — the unversioned `/api/*` surface that is the app's own wire format. It is **private and unstable**: it changes whenever the app needs it to, and nothing outside this repo should depend on it. The public, stable contract for scripts and integrations is **`/api/v1`**, documented in [integrations.md](integrations.md) with a machine-readable spec at [openapi.v1.json](openapi.v1.json).

Base path `/api`. JSON in/out (`Accept: application/json`). Authenticated routes take `Authorization: Bearer <token>` (Sanctum) — and only a **first-party login token** (the one `/register` and `/login` return) is accepted. The whole authenticated group, plus `POST /broadcasting/auth`, carries `abilities:*`, so a [personal access token](integrations.md#authentication) answers **403** on every route here no matter which scopes it holds; PATs belong to `/api/v1` and `/mcp`. Validation failures return `422` with `{message, errors}`; throttling returns `429`; missing/bad auth returns `401`.

## Auth

### `POST /register` — throttle 10/min
```json
{ "name": "Ben", "email": "ben@example.com", "password": "…", "invite": "AB2C3D" }
```
Lockdown rules, in order:
1. Email already used → 422.
2. Email matches a pending row in the `invites` table → the `invite` code is **required** and must match (hashed comparison); wrong/missing code → 422. Household already full (`babylog.max_household_users`, default 6 via `BABYLOG_MAX_USERS`) → 422. On success the invite row is deleted (single-use) and the new user gets **the invite's role** (`parent` or `caregiver`).
3. No invite match: allowed only if this is the **first account** on the instance, or `BABYLOG_OPEN_REGISTRATION=true`; otherwise 422 "invite-only". These accounts are always parents.

Returns `201 { "token": "…", "joinedPartner": bool }`. The first user of a household starts on duty. Emails are lowercased. Password min 8, `invite` optional ≤20 chars (non-alphanumerics stripped, uppercased).

**Roles**: a `parent` has full control; a `caregiver` may log entries, run timers, and request/accept/hand back shifts, but the household-shaping endpoints (`/baby`, `/children`, `/settings`, `/invite`, `/invite/revoke`, `/household/remove-member`) return **403**.

### `POST /login` — throttle 10/min
`{ email, password }` → `200 { token }`. Wrong credentials → 422 with a deliberately vague message.

### `POST /logout` (auth)
Revokes the current token.

### `POST /forgot-password` — throttle 10/min
`{ email }`. With SMTP configured, emails a reset token and returns `200 { sent: true }` **whether or not the account exists** (no account enumeration). Without SMTP it returns `200 { sent: false, reason: "mail-unconfigured" }` so the client can point at the invite-code fallback instead.

### `POST /reset-password` — throttle 10/min
`{ token, email, password (min 8) }` — consumes the emailed token and sets the new password; every one of the user's tokens is revoked (all devices sign out). Bad/used token → 422.

## Account — all auth + throttle 120/min

### `POST /account/profile`
`{ name (≤100) }` → `{ ok, name }`, broadcasts an `account` poke (the name shows up in duty chips and handoffs).

### `POST /account/email`
`{ email, password }` — requires the current password; wrong password or already-used email → 422. Returns `{ ok, email }`.

### `POST /account/password`
`{ current_password, password (min 8) }` — wrong current password → 422. Revokes every **other** app token (other devices sign out; the calling device stays in). Personal access tokens survive a routine password change, GitHub-style; the forgot-password **reset** flow still revokes everything.

## API tokens — auth + throttle 120/min, first-party session tokens only

Management of the [public API's](integrations.md) personal access tokens (PATs). Like every route in this group these carry `abilities:*`, so only a first-party app token (a logged-in session) can reach them — a PAT can never mint or revoke PATs. `*` is not in `ApiScopes`, so no PAT can be created with it; `tests/Feature/PatBoundaryTest.php` sweeps the group to keep it that way.

### `GET /tokens`
The caller's PATs (`app` login tokens never appear): `{ tokens: [{id, name, abilities, createdAt, lastUsedAt, expiresAt}], scopes }` — `scopes` is the scope-name → description map for the Settings UI.

### `POST /tokens`
`{ name (≤40, ≠"app", unique per user), abilities (non-empty subset of the scope names), expires_in_days?: 30|90|365|null }` — default expiry 90 days; explicit `null` means no expiry. At most 10 PATs per user → 422. Returns `201 { ok, id, token }` — **the plaintext token appears only here**; only a hash is stored.

### `POST /tokens/revoke`
`{ id }` — deletes that PAT (only the caller's own; `app` tokens are untouchable here). Unknown id → 422.

## Home Assistant / MQTT — auth + throttle 120/min, parents only (403 for caregivers)

Settings for the [MQTT integration](home-assistant.md). Broker credentials are household infrastructure: stored encrypted server-side, never in `/state`, never synced to clients.

### `GET /integrations/mqtt`
`{ config, status: { heartbeatAt } }` — `config` is the stored broker settings with the password masked to a `hasPassword` flag; `heartbeatAt` is the listener's last check-in (null when it isn't connected).

### `POST /integrations/mqtt`
Any subset of `{ enabled, host, port, username, password, tls, tls_verify, discovery_prefix, base_topic, acting_user_id }`; provided keys merge over stored ones. A blank/absent `password` keeps the stored one (write-only field); enabling without a host → 422; an `acting_user_id` outside the household falls back to the caller. Enabling publishes discovery + full state immediately; disabling publishes retained removals so the HA devices disappear. Returns `{ ok, config }` (masked, as in GET).

### `POST /integrations/mqtt/test`
Same payload — tries the submitted credentials (blank password = stored one) against the broker without persisting anything. Returns `{ ok }` or `{ ok: false, message }`, where `message` is one of three fixed, localized buckets — couldn't reach the broker / the broker rejected the credentials / TLS handshake failed — never the driver's own error text (that goes to the server log as `mqtt test failed`), so the button can't be used to probe what the API container can see.

## Sync — all auth + throttle 120/min

### `GET /state?since=<rev>`
The single polling/converge endpoint.
```json
{
  "user":    { "id": 1, "name": "Ben", "email": "ben@example.com", "role": "parent", "householdId": 1,
               "notifyPrefs": { "handoff": true, "timer": true, "partner": false, "feed": false,
                                "feedEvery": null, "feedEveryByChild": {}, "onDutyOnly": true,
                                "wake": false, "meds": false, "medsTime": "09:00",
                                "quiet": false, "quietStart": "22:00", "quietEnd": "07:00", "tz": null } },
  "members": [ { "id": 1, "name": "Ben", "role": "parent" },
               { "id": 2, "name": "Katrina", "role": "parent" },
               { "id": 3, "name": "Robin", "role": "caregiver" } ],   // id-ordered, includes the caller
  "children": [ { "id": 10, "name": "Wren", "age": "2–8 wks", "birthdate": "2026-07-20",
                  "archived": false } ],              // id-ordered; the first is the primary child
  "invites": [ { "email": "granny@example.com", "role": "caregiver" } ],  // pending, id-ordered
  "formerMembers": [ { "id": 4, "name": "Doula Dana" } ],  // removed members, for naming their old entries
  "limits":  { "maxMembers": 6, "maxChildren": 10 },
  "partner": { "id": 2, "name": "Katrina" },        // LEGACY: first other member, or null
  "invitePending": "granny@example.com",             // LEGACY: first pending invite's email, or null
  "baby":    { "name": "Wren", "age": "2–8 wks", "birthdate": "2026-07-20" },  // LEGACY: the primary child, or null
  "onDutyUserId": 1,
  "settings": { "tracking": {"diapers": false}, "dismissed": ["meds"], "widgets": ["feeds","sleep"],
                "unit": "oz", "theme": {"accent":"plum","bg":"mist"}, "medName": "Vitamin D" },  // or null
  "shift":   { "id": 3, "state": "requested|active|completed|cancelled", "requester_id": 1, "target_id": null,
               "user_id": 2, "note": "…", "plan": [{"id":"p1","type":"bottle","at":1750000000000}],
               "until": "Until 6 AM", "until_at": 1750000000000, "until_notified_at": null,
               "requested_at": 0, "started_at": 0, "ended_at": 0,
               "handback_note": "…" },               // latest row, or null
  "timer":   { "id": "uuid", "type": "nurse", "started_at": 0, "user_id": 1,
               "baby_id": 10 },                      // LEGACY singular: the caller's newest running timer (else the household's), or null
  "timers":  [ { "id": "uuid", "type": "nurse", "started_at": 0, "user_id": 1,
                 "baby_id": 10 } ],                  // every running timer, in start order; baby_id null ⇒ primary child
  "entries": [ { "id": "uuid", "user_id": 1, "baby_id": 10, "type": "bottle", "t": 1750000000000,
                 "detail": "4", "deleted": false, "rev": 1750000000123 } ],
  "serverTime": 1750000000456,
  "vapidPublicKey": "BM…"                            // Web Push application server key
}
```
`entries` contains only rows with `rev > since` (≤ 2000, ordered by rev). Clients store `serverTime` as the next `since`. The three `LEGACY` singular keys are kept for installed PWAs that predate multi-member households and will not be removed casually.

### `POST /entries`
Batch upsert from the client outbox (≤ 500 per call).
```json
{ "entries": [ { "id": "uuid", "type": "bottle", "t": 1750000000000, "detail": "4", "deleted": false, "baby_id": 10, "user_id": 3 } ] }
```
- `type` ≤ 20 chars — one of `bottle nurse pump wet dirty both sleep tummy bath meds` (client-defined; server stores any short string).
- `detail` nullable string ≤ 100 (amount for bottle/pump, side for nurse, minutes for sleep/tummy — sleep may carry a nap/night tag, e.g. `Nap · 45m`).
- `t` ms epoch — when the session **started**, except `sleep`/`tummy`, which stamp when it **ended** (`t` − duration = the start the app shows and sorts by).
- `baby_id` optional — must be one of the household's children; a foreign id is **dropped, never stored**. Absent (old single-child clients): a **create** lands on the primary (oldest) child, an **update** keeps the entry's stored `baby_id` — an old client editing an amount can't re-home the entry.
- `user_id` optional — whose activity this was. Must be a member of the caller's household; a foreign id is **dropped, never stored**, and the entry falls back to the caller. Honored on **create** only: an update never re-homes an existing entry's author, so editing someone else's entry leaves their name on it. This is what lets any member stop a timer someone else started (see [Timers](#timers--all-auth--throttle-120min)) without re-crediting the session to whoever pressed Stop.
- Ids colliding with **another household's** entry are silently skipped; within the household, last write wins and the original author's `user_id` is preserved.
- Returns `{ ok, serverTime }`, broadcasts a poke.

### `POST /baby` — parents only (403 for caregivers)
`{ name (≤100), age (≤40, nullable), birthdate (Y-m-d, nullable, not future, after 2015) }` — legacy endpoint: upserts the household's **primary child** (creating it if the household has none). `age`/`birthdate` are only written when the key is present, so a client that doesn't know the DOB can't erase it. `age` is the legacy onboarding label, kept as a fallback for babies without a `birthdate`.

### `POST /children` — parents only
`{ id?, name (≤100), age?, birthdate?, archived? }` — create (no `id`; 422 at the cap of `babylog.max_children`, default 10) or update (`id` must belong to the household, else 422 without a write) one child. Same key-presence rule as `/baby`. There is **no delete** — retiring a child only sets `archived: true` (its log is history worth keeping). Returns `{ ok, child }`, broadcasts a poke.

### `POST /invite` — parents only
`{ email, role?: "parent"|"caregiver" (default parent) }` → `{ ok, code, mailed }`. Inserts a row in the `invites` table (lowercased email, hashed single-use code, role); **the plaintext code is returned only here** — with SMTP configured it is also emailed (`mailed: true`). Capacity counts members **plus outstanding invites** against `babylog.max_household_users` (default 6) → 422 when full. Re-inviting the same email replaces its row (fresh code, updated role) and doesn't take a second seat; multiple concurrent invites to different emails are fine. One quirk: this endpoint validates before checking the role, so a caregiver posting a *malformed* payload gets 422, not 403 (the 403 holds for well-formed requests).

### `POST /invite/revoke` — parents only
`{ email }` — deletes the pending invite; its code stops opening doors immediately. Returns `{ ok }`, broadcasts a poke.

### `POST /household/remove-member` — parents only
`{ user_id }` — removes a member (a departing caregiver, usually). Their tokens and push subscriptions are deleted (every session 401s), duty falls back to the caller if the target held it, their requested/active shifts are cancelled — but their entries keep their `user_id` so history still says who did what. Removing yourself → 422. Returns `{ ok }`, broadcasts a poke.

### `POST /settings` — parents only
```json
{ "tracking": { "diapers": false }, "dismissed": ["meds"] }
```
Household-level preferences, shared by every member; last write wins. `tracking` maps a tracker key to on/off — keys outside `pump diapers sleep tummy bath meds` are silently dropped (feeds can't be turned off). `dismissed` lists trackers whose "turn this off?" nudge was declined. `widgets` is the ordered list of "since last …" cards shown on the Now screen (from `feeds pump diapers sleep tummy bath meds`; unknowns/duplicates dropped, client order kept; omitted/empty ⇒ the client's default set). `unit` is the display unit for bottle/pump amounts (`oz` or `ml`, default `oz`) — display only: entry `detail` amounts are always stored and synced in oz. `theme` is the household-shared palette: `accent` ∈ `olive clay rose plum sea denim`, `bg` ∈ `cream blush mist sage lilac` — any other value → 422; an absent key means the default (peach accent / cream background), which is why "peach" and plain "cream" are never stored. `medName` (nullable, ≤40, trimmed) names the daily med; clients show "Vitamin D" when blank. Each provided top-level key replaces the stored one wholesale. Returns `{ ok, settings }`, broadcasts a poke.

## Push notifications — all auth + throttle 120/min

### `POST /push/subscribe`
```json
{ "endpoint": "https://fcm.googleapis.com/…", "keys": { "p256dh": "…", "auth": "…" }, "tz": "America/New_York" }
```
Registers this device for Web Push. Upserts by `endpoint` — re-subscribing (or the partner logging in on the same phone) moves the device to the current user. Device-scoped, so no `HouseholdTouched` poke. `tz` is an IANA zone (`timezone:all` validated). `endpoint` must be a **public https URL** — `http:`, `localhost`/`.local`/`.internal`/single-label hosts, and any literal or resolved private/loopback/link-local/CGNAT address are rejected with 422 (`Push endpoint must be a public https URL.`), since the server will POST there on your word.

### `POST /push/unsubscribe`
`{ endpoint }` — removes the caller's row for that endpoint (other users' rows are untouched). Expired endpoints also self-prune when a push bounces 404/410.

### `POST /notify-prefs`
Any subset of the `notifyPrefs` keys shown in `/state`; provided keys merge over stored ones. `feedEvery` ∈ `null|120|150|180|210|240` (minutes; null = learned household rhythm), times are `HH:MM`. `feedEveryByChild` (`{childId: minutes}`) overrides `feedEvery` per child and replaces wholesale — keys for children outside the household and `null` values are silently dropped, not rejected. Per-user (each parent has their own), rides `/state`, pokes so the caller's other devices converge. Returns `{ ok, prefs }`.

**What gets sent** (see [architecture.md](architecture.md#notifications)): handoff request/accept/handback pushes are raised by the shift endpoints (every push is sent after the response has gone out, never inside the write) (respecting the recipient's `handoff` pref, ignoring quiet hours); member-activity pushes fire from `POST /entries` to every other member (opt-in, throttled to one per 10 min per recipient); feed-gap and wake-window reminders (per non-archived child) and the daily-meds nudge are sent by `babylog:reminders`, scheduled every minute.

## Timers — all auth + throttle 120/min

The live nursing/pump/sleep/tummy-time timers. **Timers stack** — a nursing timer for one twin can run beside a sleep timer for the other — synced via `/state` (`timers`: a list of `{id, type, started_at, user_id, baby_id}` in start order; the legacy singular `timer` key carries the caller's newest for pre-multi-timer clients). Only the running state lives server-side; the resulting entry is written client-side through `/entries` on stop.

### `POST /timer/start`
`{ type: nurse|pump|sleep|tummy, baby_id?, id? }` → appends to the household's `active_timers`, broadcasts a poke, and pushes every other member whose `timer` pref is on (honoring quiet hours) "{name} started nursing/pumping". Starting an identical session you already have running (same type, child, and starter — a double tap) returns the existing timer instead of stacking a duplicate. `baby_id` must be one of the household's children — a foreign id is dropped (stored as null, which clients read as the primary child). `id` is an optional client-generated timer id (entry-style), so the app's optimistic row and the server copy are the same timer. Returns `{ ok, timer }`.

### `POST /timer/stop`
`{ id? }` — removes that timer from `active_timers`, broadcasts a poke. Without `id` (pre-multi-timer clients) it stops the caller's newest timer, else the household's newest. Returns `{ ok, stopped }` (`stopped` null if nothing matched). The client logs the nurse/pump entry (with the measured duration) separately.

**Any member may stop any timer**, not just the one who started it — a nap outlives the handoff that happens mid-nap, and requiring the starter stranded whoever came on duty. The session still belongs to the person who ran it: the stopping client passes the timer's `user_id` as the logged entry's author (see [`POST /entries`](#post-entries)), so a feed stays credited to whoever did it. The nurse *side* is remembered per-device against the timer id, so stopping someone else's nursing timer falls back to the default side rather than their pick.

## Shifts — all auth + throttle 120/min

Shifts are household-level (who has the kids), not per child. Any member — parent or caregiver — can take part.

### `POST /shifts/request`
`{ note?, plan?: [{id,type,at}] (≤20), until?, until_at?, target_id? }` — any member (on duty or not — there's no ownership check) asks the household to take over. The ask **carries what the asker is proposing**: the plan (same `numeric` → int coercion on `at` as `/shifts/accept`), the window, and a note. `target_id` addresses it to one member and narrows the push to them; null (or an id outside the household, or your own) fans it out to every other member. Addressed or not, anyone may answer it. Asking again while a request is pending **refreshes it and re-pings** (a deliberate nudge, not a no-op).

### `POST /shifts/accept`
`{ plan?: [{id,type,at}] (≤20), until?, until_at? }` — accepts the pending request (or starts a shift outright). The asker seeds, the accepter commits: **omitted** `plan`/`until`/`until_at` inherit whatever the pending ask proposed, while any value you send wins (including an empty plan). Accepting **your own** request → 422, the ask stays open. Sets duty to caller, `state=active`, returns the shift; the requester is pushed "you're covered", everyone else "…is on duty now". `at` is `numeric` and coerced to integer ms — the client derives it from an averaged feed gap, and a fractional value must never reject the whole handoff.

### `POST /shifts/plan`
`{ plan: [...] }` — replaces the plan on the caller's active shift (no-op if none). Same `numeric` → int coercion on `at`.

### `POST /shifts/handback`
`{ note? }` — completes the caller's active shift, stores `handback_note`, and returns duty to **the shift's stored `requester_id`** — whoever asked for the cover gets it back, parent or caregiver alike. A self-started shift (or one whose requester was removed) falls back to another **parent** first, then any other member, then the caller: duty must not land on a night carer just because their account is older. Cancels any still-pending request. Returns the shift. Clients render the report from synced entries between `started_at`/`ended_at`.

## Websockets

### `POST /api/broadcasting/auth` (auth)
Standard Pusher-protocol channel auth for `private-household.{id}` — authorized when the token's user belongs to household `{id}`.

### `GET /app/{key}` (websocket, via nginx → Reverb)
Pusher protocol. Clients listen for `HouseholdTouched` (`{kind: entries|baby|children|invite|members|settings|shift|timer|partner|account|notify}`) and respond by pulling `/state`. Send `X-Socket-ID` on writes to avoid being poked by your own changes.
