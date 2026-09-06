# Architecture

mybabynotes is three containers behind one nginx, built for one household sharing its babies' log — up to six grown-ups (parents and caregivers) and up to ten children. (The Unraid/CA build collapses the same stack into a single all-in-one container — nginx, php-fpm, Reverb, the scheduler, and the MQTT listener as five supervised processes, secrets self-generated into `/data/.env` on first boot; see [deploy/aio/](../deploy/aio/) and [docs/operations.md](operations.md).)

```
                    ┌─────────────────────────────────────────────┐
 phone / browser ──►│  app (nginx)                                │
                    │   • serves the built PWA                    │
                    │   • /api  ──────────► api (Laravel, :8000)  │
                    │   • /app (ws) ──────► reverb (:8080)        │
                    └─────────────────────────────────────────────┘
                                     api ──publishes──► reverb
                                     api ◄──SQLite──  /data volume
```

## Frontend (`src/`)

- **Vite + React 18**, one class component ([src/App.jsx](../src/App.jsx)) holding all state — the app is small enough that a store library would be overhead.
- **Design fidelity**: markup was ported 1:1 from the Claude Design comp in [design/Baby Log.dc.html](../design/Baby%20Log.dc.html), and layout/structure still tracks it — but branding (baby-face logo in [src/Logo.jsx](../src/Logo.jsx), peach/plum palette, tri-color wordmark) has since been adopted from the newer marketing comp, so color surfaces intentionally diverge from the old comp. Inline CSS strings from the comp pass through [src/s.js](../src/s.js) (a cached CSS-string → style-object parser), which also rewrites comp hexes to the household-theme CSS variables. Hover states live as utility classes in [src/styles.css](../src/styles.css). Per-device effects (dark mode, tilt parallax) live in [src/fx.js](../src/fx.js) under their own `babylog:fx` localStorage key — deliberately never synced. The background is a stack of absolutely-positioned layers — motif art (transparent PNGs, so the household background tint shows through), accent glow blobs at three parallax depths, and a legibility wash painted in the backdrop's own colour — and in dark the wash drops beneath the art (`html.dark .bg-wash { z-index: -1 }`) so the motifs read on top of the gradient rather than being flattened to grey under it, at the same 0.6 opacity the marketing site paints its motifs with. Dark backgrounds themselves are pinned to the site's depth (`--bg:#161019`, `--frame:#0A070C`; oklch ≈0.185 L / ≈0.020 C), each household background keeping its own hue — the earlier ≈0.23 L ladder was the other half of why dark read as grey.
- **Now screen composition**: a header (baby + age, then two icon buttons), any running-timer cards, an incoming handoff ask, the since-card grid, and today's timeline. The buttons are `pending_actions` → the shift sheet, and `settings` → Settings. Both are icon-only, so the shift button's *accessible name is its state* ("Your shift", "Sam's shift", "Take over from Sam", "Sam is handing off") — with the duty avatar and the footer shortcut both gone, that name is the only place "who has the baby" is written down, so it has to mirror exactly what the sheet opens on. It only shouts (accent fill + a pulsing dot) when an ask is waiting on you. **Every other shift surface lives in that sheet** — your live checklist, the off-duty read-only view of theirs, and the "Start your shift" framing — so Now stays a log. The one exception is an incoming ask, which stays an inline card because it needs answering, not browsing.
- **Both drawers grab the same way.** The log sheet and the hand-off sheet are the app's two bottom drawers, and they share one gesture (`sheetGestures` in [src/App.jsx](../src/App.jsx), instantiated once per drawer in the constructor): drag the handle down to dismiss — 110px, or 30px thrown fast — and a *touch* pull-down on the content does the same once it's scrolled to the top and didn't start on a control. The one asymmetry is the second detent: the log sheet can be dragged up to `tall` and back down out of it; the hand-off sheet has a single content-driven height, so it passes `tall: null` and an up-drag just rubber-bands. Both keep the handle in a non-scrolling strip above a `flex:1;min-height:0;overflow:auto` body, so it stays grabbable no matter how far the plan has scrolled.
- **The log sheet's stamp is a ladder, and the day is its top rung.** The common case never touches a date: the sheet opens stamped *now*, the `−5/−15/−1h` nudges cover the near past, and the time picker's midnight rule (a time later than now means last night) reaches back through the small hours. Past that it used to stop — a 3am backfill of a feed from two nights ago was unloggable — so the day is its own control behind an **Advanced** link, right-justified on the Cancel row. Opening it reveals a Today/Yesterday/calendar chip row plus a plain reading of what will be saved (`Sat, Sep 5 · 11:40 PM`, and `→ 12:25 AM` for a span, whose end the sheet otherwise never prints). It's folded away because the day is almost never the answer, and folded *open* on an edit whose entry isn't from today — there it's the field you came for. The timer path has no Advanced link at all: a live timer starts now. `setDay()` moves the calendar date under the time already on the sheet and keeps the span offset, so a nap still ends a duration after it starts; today plus a time that hasn't come round yet clamps to the moment itself, since nothing can be logged in the future.
- **Settings has one door and one way back.** It opens only from Now's cog (History used to carry a duplicate) and returns to Now — the header button, the `blSettings` history entry, and the Android back gesture all land in the same place. The three-tab illusion is deliberate: Now and History are peers on the tab bar, Settings is a pushed screen.
- **A running timer owns its since-card.** "Slept · 4h ago" sitting on screen through a nap reads as a stale log, so a card whose type has a live timer for the selected child (nurse→Fed, pump→Pumped, sleep→Slept, tummy→Tummy time) swaps to the session itself: present-tense label, the stopwatch counting up, "so far" instead of "ago", and who started it. It reverts the moment the timer stops and becomes an entry the card can measure from.
- **PWA**: manifest + service worker ([public/sw.js](../public/sw.js)). The SW caches the app shell and Google Fonts; it **never** caches `/api` or `/app`. Only `/assets/` (content-hashed) is trusted forever — everything else serves stale and revalidates behind you, which means an unhashed asset can be handed to a *newer* stylesheet than it was drawn for. That bit the background art once the field went transparent (old bitmap × new opacity = a light slab over dark mode), so the art is now imported through the bundle and hashed with it. Bump the SHELL/RUNTIME version whenever a cached asset changes shape rather than just content.
- **i18n**: [src/i18n.js](../src/i18n.js) — a dependency-free `t('English string', {params})` layer. English source strings are the keys; per-language catalogs in [src/locales/](../src/locales/) map them (15 languages; missing keys fall back to English, catalogs are lazy-loaded Vite chunks). Language is a per-device pref (`babylog:lang`, auto-detected from the browser, picked in Settings → Appearance) — never a synced household setting. Arabic/Urdu flip the document to RTL. **The wire stays English**: entry `detail` strings (`'Left · 30m'`, `'breastmilk'`), shift `until` labels (`untilAt()` regex-parses them), and stored names are canonical and translate at render only — translating one into state would corrupt the shared log. New UI strings must go through `t()`; [src/locales/en.js](../src/locales/en.js) is the canonical key list and `src/test/i18n.test.js` fails if a catalog misses a key or drops a `{param}`.
- **Server-side i18n** mirrors the same idea in Laravel: English strings are the keys, catalogs live in [api/lang/](../api/lang/) (`{code}.json` for app copy, vendored `{code}/validation.php` from laravel-lang for framework messages; `en.json` is the reference). Three surfaces, three language sources: **push copy** renders per *subscription* — the client rides `lang` along on `/push/subscribe` exactly like `tz`, and `PushService::render()` composes each device's copy from `[key, params]` pairs (params may nest `[key]` pairs, so type labels and "the baby" fallbacks land in-language; names and user notes stay data). **Validation + custom API errors** localize per *request* via the `X-App-Lang` header (`SetLocale` middleware), which is also remembered as `users.lang`. **Emails** have no device, so the reset mail follows the account's last-seen language and the invite mail follows the inviter's. `tests/Feature/LocaleTest.php` pins all three. Push producers must pass `[key, params]` copy to `notify()`, never pre-baked strings — baked strings can't re-render per device.
- **Source offer**: the AGPL's network clause means everyone using an instance must be offered its source, so Settings ends with a "Source code" link. The URL is a build-time constant (`VITE_SOURCE_URL`, defaulting to this repo) rather than a hardcoded one — someone deploying a modified build has to be able to point it at *their* source without patching the component.

## Local-first sync

The design brief: "Entries write locally first and sync when there's signal, so 3am logging never waits on a network."

- Every entry is `{id, type, t, detail, deleted}` with a **client-generated UUID**, written to `localStorage` (`babylog:v2`) instantly.
- Changed ids go into an **outbox**; a debounced flush POSTs them to `/api/entries` in chunks of 500 (the server's batch cap — bulk sources like the Baby Buddy CSV import in [src/bbimport.js](../src/bbimport.js) ride the same outbox). Batch upsert, last-write-wins, server stamps a `rev`.
- Pulls hit `GET /api/state?since=<rev>` — one endpoint returns everything needed to converge (user, members, children, invites, duty, shift, the running `timers`, household `settings`, changed entries (capped at 2000 per pull), server caps (`limits`), removed-member name snapshots (`formerMembers`), and `serverTime`, which the client stores as the next `since` — plus the legacy singular `partner`/`baby`/`invitePending`/`timer` keys, kept so installed PWAs that predate multi-member (and multi-timer) keep working).
- Every entry carries a `baby_id`; a client that omits it gets the primary (oldest) child on create, and an update without it never re-homes the entry — old single-child clients stay correct against a multi-child server.
- **`t` is a session's start for every type except `sleep`/`tummy`, which stamp its END** (the wake-up) with the duration in `detail` — the format the timer, the Baby Buddy import, the wake-window math and `SendReminders` all read, so it stays as it is. The UI is uniformly top-down instead: `startOf(e)` in [src/App.jsx](../src/App.jsx) subtracts the duration, and everything that renders or orders an entry's own time (Now timeline, History day grouping and rows, the shift report, CSV rows, the log sheet's stamp and its time picker) goes through it, so a nap reads at the moment it began, like a bottle. Measures of "how long since it ended" — the since-cards, the "Last nap ended" handoff row, the wake-window insight — deliberately keep reading `t`. A since-card with a *running* timer of its kind stops measuring entirely and shows the live session instead (see **Now screen composition** above), so the wake-window reading only ever describes a nap that has actually ended.
- **Deletes are tombstones** (`deleted: true`), so they sync like any other write; all views filter them.
- Merge rule: server wins for any entry **not** currently in the outbox; unpushed local writes win until flushed.

## Realtime (Reverb)

- Every household-state write endpoint fires `HouseholdTouched` — a tiny "something changed" poke on the private channel `household.{id}` (auth: Sanctum bearer at `/api/broadcasting/auth`, channel gate checks `household_id`).
- Clients respond to a poke by pulling `/api/state` — **the sync path is identical for sockets, polls, and reconnects**, so realtime can never introduce a second source of truth.
- Writes send `X-Socket-ID`, and the server broadcasts `toOthers()` — you're never poked by your own write.
- Broadcasts are **best-effort** (`HouseholdTouched::send()` swallows transport errors): a Reverb outage degrades to polling, never fails a write. (The one deliberate exception to "every write pokes": `/push/subscribe` and `/push/unsubscribe` are device-scoped, not household state, so they don't.)
- Fallbacks: a 20s poll whenever the socket is down (relaxing to 60s while it's connected), plus resync on window focus, `visibilitychange`, `online`, and socket reconnect.

## Notifications

Web Push (VAPID), self-hosting-friendly: no FCM/APNs account, just the public
HTTPS origin the app already needs.

- **Keys are zero-config**: a VAPID keypair is generated once into SQLite
  (`vapid_keys`) on first use, so it lives inside the one backup-able file;
  `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` env vars override it. The public key
  rides `/state`.
- **Subscription is per-device** (`push_subscriptions`, upserted by endpoint);
  **prefs are per-user** (`users.notify_prefs`, edited in Settings →
  Notifications, synced through `/state` like everything else). Expired
  endpoints self-prune when a push bounces.
- **Event pushes** fire inline from write endpoints, fanned out to every other
  member: shift request / accept / handback (on by default — someone asking you
  to take over should reach a sleeping phone, so these ignore quiet hours), a
  nursing/pump/sleep/tummy-time timer starting (on by default but informational,
  so it honors quiet hours), and opt-in member activity ("Katrina logged a bottle",
  throttled to one per 10 min per recipient so backfill bursts don't rattle
  anyone).
- **Reminder pushes** come from `babylog:reminders`, run every minute by a
  `schedule:work` process the api container starts next to php-fpm:
  feed gap and wake window per non-archived child (learned cluster-aware rhythm
  or a fixed interval, optionally only while on duty; wake windows use each
  child's birth date; entries with a NULL `baby_id` read as the primary child),
  a daily meds nudge (household-level), and the shift "until" ping (an active
  shift's client-resolved `until_at` passes → the shift holder and the member
  who asked for the cover get one ping each; nothing about duty changes by
  itself). Each fires at most once per triggering feed / nap /
  day / shift — the dedupe lives in `users.notify_state` (and
  `shifts.until_notified_at` for the until ping), so restarts can't
  double-ping.
- **Delivery is best-effort** like the Reverb pokes ([app/Services/PushService.php](../api/app/Services/PushService.php)):
  a dead push service never fails a write or a scheduler tick. Pushes carry
  only `{title, body, tag}` — never entry data; the app still converges
  through normal sync.
- Quiet hours and meds times are evaluated in the user's own IANA timezone,
  stamped from the device whenever prefs are saved.

## Backend (`api/`)

Laravel 13, SQLite, Sanctum bearer tokens.

- **Household model**: `households` owns everything; a user belongs to exactly one household; max 6 users (`babylog.max_household_users`, `BABYLOG_MAX_USERS`) and 10 children (`babylog.max_children`, `BABYLOG_MAX_CHILDREN`). Every user has a role: **parent** (full control) or **caregiver** (may log entries, run timers, and take/hand back shifts; the household-shaping endpoints — `/baby`, `/children`, `/settings`, `/invite`, `/invite/revoke`, `/household/remove-member` — return 403). The first account on an instance is a parent. The legacy "partner" is now just the first other member (`Household::partnerOf`), kept for old clients and used only as a fallback.
- **Children**: `babies` rows per household, id-ordered; the oldest is the *primary* child (what old clients call "the baby", and where entries without a `baby_id` land). Children are archived, never deleted — a child's log is history worth keeping.
- **Invites**: a real `invites` table — email-bound, hashed single-use 6-char code, per-invite role, multiple concurrent, revocable. The code is shown once to the inviter and required at the invitee's registration; capacity counts members + outstanding invites. See [docs/api.md](api.md#auth) for the full lockdown rules.
- **Duty & shifts**: household-level (not per child): `households.on_duty_user_id` tracks who has the kids. A `shifts` row moves through `requested → active → completed` (or to `cancelled`, when a handback supersedes a still-pending ask or a member with an open shift is removed):
  - `request` — a member (usually whoever's on duty; there's no ownership check) asks the others to take over. **The asker authors the handoff**: the ask carries a plan, an "until", and a note, on the same `plan`/`until`/`until_at` columns an active shift uses. An optional `target_id` addresses it to one member (null fans the push out to everyone); addressed or not, *anyone* may still answer it. Asking again while one is pending refreshes and re-pings.
  - `accept` — another member starts their shift; duty transfers. The plan and window are seeded by the ask and adjusted by the accepter — what the client sends wins, and a client that sends nothing inherits what was proposed rather than blanking it. A requester can't accept their own ask. (`until_at` always resolves on the *accepter's* device, in their timezone.)
  - `plan` — replace the active shift's plan. The client edits plans in place on both sides of a handoff: every item's time is an `<input type="time">` overlay (the same control the log sheet's stamp uses), items can be dropped, and "Add to plan" offers any *scheduleable* tracked type — feed, nursing, pump, sleep, tummy time, bath, meds. Diapers are excluded: they happen to you, you don't plan them. A plan item that a logged entry has already matched is frozen — history, not a plan.
  - **`handback` and `request` are not two names for one thing**, and the client stopped presenting them as if they were. `handback` moves duty *on the spot*; `request` asks and waits. So the running-shift sheet only offers hand-back when `requester_id` is set — someone handed you this shift, and the cover is theirs to get back. A shift you started yourself has nobody to hand it *back* to, so asking is the only exit, and it's the primary action. The labels carry the difference ("Hand back to Sam now" vs "Ask Sam to take over") rather than leaving it to the reader.
  - `handback` — shift completes with a note; duty returns to the shift's stored `requester_id` — whoever asked for the cover is owed it back, parent or caregiver alike. A self-started shift (or a requester since removed) falls back to another **parent** first, then to any other member: "first other member by id" would hand a newborn to the night carer purely because their account was created earlier. Clients render the report **from synced entries** (the report is computed, not stored).
  - **Role is otherwise invisible to shifts.** A caregiver requests, accepts, and hands back exactly like a parent. The two places it shows are the handback fallback above and the copy on the compose sheet (a carer is told what needs to happen; a partner is asked a favor). One mechanism, two framings — not two flows.
  - **The plan outlives the shift.** Unfinished non-feed items seed the next draft (`carryOver()` in the client): a dose is owed and shouldn't evaporate because duty changed at 4am, while feeds are rhythmic and always re-predicted from the last one that actually happened.
  - **Holding duty ≠ having a shift open.** `on_duty_user_id` is seeded to the founding account at registration and reassigned by `handback` and by member removal — none of which open a `shifts` row. So the client treats "on duty with nothing started" as a first-class state: the shift sheet opens on **"Start your shift"** (the drafted plan + "Start my shift", which is just `accept` with no pending ask) rather than a running-shift summary. Only a real `active` shift of yours renders the live checklist — that's what keeps the report window honest. `/state` carries one shift, so a pending ask of your own hides your active shift while it's open; that framing reads as "Waiting for {name}" and offers a re-ask instead of an accept (the server 422s a requester accepting their own ask).
- **Prediction is client-side**: smart prefill, feed-gap rhythm, and plan drafting run in the frontend from the local entry cache — the server stores facts, not guesses. (The reminder scheduler mirrors the same cluster-aware rhythm math server-side to time feed-gap pushes — see `SendReminders` — but nothing predicted is ever stored.)

## Integrations

Three surfaces — REST ([integrations.md](integrations.md)), Home Assistant ([home-assistant.md](home-assistant.md)), MCP ([mcp.md](mcp.md)) — built on a few structural decisions:

- **Two API surfaces, one token table.** The unversioned `/api/*` is the PWA's private contract; `/api/v1` is the frozen/additive public one, gated per-route by scopes from `App\Support\ApiScopes` (the single vocabulary shared by route middleware, the token UI, the OpenAPI spec, and MCP tool checks) and rate-limited in its own `v1` bucket so integrations can't starve the app's sync. Both use Sanctum bearer tokens, but the two kinds age differently: first-party **app tokens** (always named `app`, minted at login) *slide* — valid while `last_used_at` is inside the `sanctum.expiration` window, so a daily-use phone never logs out; **personal access tokens** honor their explicit `expires_at` only and never slide (the callback in `AppServiceProvider` branches on token name). Pruning follows the same rules: `babylog:prune-tokens` (scheduled daily) reaps app tokens only when *idle* past the window and PATs only past `expires_at` — it replaced `sanctum:prune-expired`, which reaps by `created_at` age alone and would delete an actively-used sliding token (and every no-expiry PAT).
- **One write path.** All entry writes — PWA outbox batches, `/api/v1`, MCP tools, MQTT button presses — go through `App\Services\EntryWriter`, and all timer mutations through `App\Services\TimerService`. The sync invariants (client ids win, last write wins, tombstones, baby_id default-on-create/preserve-on-update, the `HouseholdTouched` poke, partner pings) live in exactly one place, so a new producer can't fork the rules.
- **MCP is embedded, not a sidecar.** `laravel/mcp` serves Streamable HTTP at `/mcp` — stateless, each JSON-RPC message one ordinary php-fpm request, no long-running process. The `mcp` ability gates the endpoint; each tool re-checks its granular scope so read-only MCP tokens work.
- **MQTT fan-out rides `HouseholdTouched::send()`.** The one guarded publisher call sits inside `send()` itself, after the broadcast — not an event listener, because `broadcast()` dispatches straight to the broadcaster and *bypasses* the event dispatcher, so a listener would never fire. MQTT deliberately carries state (retained sensor payloads): poke-to-pull is an invariant about *our own clients* converging through `/state`, and Home Assistant is a different consumer on a different transport that can't pull. Publishing is best-effort with a 60s **circuit breaker** — the publisher runs inline on the request path, so a dead broker costs one connect timeout per minute, never one per write. Broker config lives in `households.mqtt_config`, an `encrypted:array` column (APP_KEY) deliberately **outside** `households.settings` — settings are returned verbatim by `/state` to every member, and broker credentials must never be.
- **The `mqtt:listen` process** owns the persistent broker connection: a real Last Will makes entity availability honest (listener down → entities `unavailable`), it subscribes to the per-household command topic (HA button presses → EntryWriter/TimerService), and it republishes discovery + full state every 15 minutes to heal broker restarts. It runs unconditionally in every deployment shape — backgrounded by the api container's entrypoint in the compose stacks, a fifth supervisord program in the AIO image — and idles cheaply when no household has MQTT enabled. The settings card driving all this is parent-only.
- **One build, ingress-capable.** The frontend build is base-path-relative (`vite base: ''` + `APP_BASE` in [src/base.js](../src/base.js)), so the same bundle serves the origin root (every normal deployment) and Home Assistant ingress at `/api/hassio_ingress/<token>/`. Under ingress the service worker is deliberately not registered — ingress session cookies poison SW caches, and installing a PWA inside an iframe is meaningless.
- **The HA add-on** ([deploy/ha-addon/](../deploy/ha-addon/)) has two modes: **local** wraps the AIO image (state in the add-on's `/data`, riding HA backups) and **remote** renders an nginx ingress proxy to an instance running elsewhere. Either way the app lands in the HA sidebar for every HA user.

## Security posture

- Invite-only registration (first account, or invited email + code); `BABYLOG_OPEN_REGISTRATION=true` opts out. The policy itself is a swappable extension point: an `AccountProvisioner` contract, bound via `babylog.account_provisioner` (default `InstanceClaimProvisioner`) — the seam a hosted multi-tenant deployment would replace.
- Throttles: 10/min on register/login/forgot-password/reset-password, 120/min on authed routes; nginx `limit_req` on `/api` and `limit_conn` on `/app`; Reverb rate limiting + connection cap in production.
- Passwords ≥ 8, hashed (Laravel default); tokens are Sanctum (hashed at rest, no cookies → no CSRF surface).
- Secrets are never in the repo: dev reads a git-ignored `.env`; the Unraid installer generates fresh values on first run.
- TLS terminates at the reverse proxy; Laravel trusts proxies for scheme detection.

## Key decisions (and why)

| Decision | Why |
|---|---|
| Poke-to-pull instead of broadcasting data | One converge path; a missed socket message can never cause divergence |
| Client-generated entry ids | Offline writes merge without coordination; edits/deletes address the same id |
| Tombstone deletes | Deletes must sync across devices like any write |
| Reports computed from entries | No snapshot to drift out of sync; the log is the single source of truth |
| SQLite | A handful of users per instance; zero ops; the whole DB is one backup-able file |
| php-fpm (8 static workers) behind a loopback nginx in prod | Plenty for a ≤6-user appliance; revisit pool sizing if this ever becomes multi-tenant |
