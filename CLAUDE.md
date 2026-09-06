# mybabynotes — project conventions

Two-parent baby-tracking PWA (React) + Laravel API + Reverb websockets, deployed on Unraid. Read [docs/architecture.md](docs/architecture.md) before structural changes.

## Non-negotiables

- **PHP only runs in containers** on this dev machine (host PHP lacks extensions). Artisan/composer:
  `docker run --rm -v "$PWD/api:/app" -w /app composer:2 php artisan <cmd>`
- **Tests must pass before pushing** — a push to `main` auto-builds public GHCR images, and the production Unraid updater pulls `main`. Both suites:
  `docker run --rm -v "$PWD/api:/app" -w /app -e BROADCAST_CONNECTION=log composer:2 php artisan test --compact`
  `npm test` (frontend: Vitest + Testing Library in `src/test/`)
- **Never commit secrets.** Dev secrets live in git-ignored `.env` (see `.env.example`); production generates its own on the NAS. A leaked key here already cost us a history rewrite.
- **Ports 3500–3502 belong to this project** on the dev machine; everything else in 3xxx is taken by other projects.
- **Keep the AGPL source offer.** The repo is AGPL-3.0 and the app is served over a network, so Settings ends with a "Source code" link (`SOURCE_URL` in [src/App.jsx](src/App.jsx), overridable at build time via `VITE_SOURCE_URL` so modified builds can point at their own source). Don't delete it while tidying; `src/test/app.test.jsx` pins it. New first-party source files open with `SPDX-License-Identifier: AGPL-3.0-only` + a copyright line (Laravel's untouched skeleton files deliberately don't).

## Design system

- The visual source of truth is the comp in `design/Baby Log.dc.html` (brand accents, the baby-face logo in [src/Logo.jsx](src/Logo.jsx), and the tri-color wordmark come from the newer marketing comp — `Landing.dc.html` in Claude Design / `~/dev/mybabynotes-site`). App markup keeps the comp's inline CSS strings verbatim via `S()` from [src/s.js](src/s.js) — when changing styles, edit the string, don't convert to style objects. Hover states are utility classes in [src/styles.css](src/styles.css).
- Palette: cream `#FAF6EF`/`#FFFDF8`, ink `#26231D`, peach `#E8957A` (primary) with plum `#B5566A` (deep), type colors via `oklch(0.60 0.075 <hue>)`. Fonts: Nunito (display), Nunito Sans (body), Material Symbols Rounded (icons, ligature names).
- New UI should read like the comp: 999px pills, 24–26px card radii, `rgba(38,35,29,…)` hairlines.
- **i18n**: every user-facing string goes through `t('English string', {params})` from [src/i18n.js](src/i18n.js) — English is the key, catalogs live in `src/locales/` (15 languages), and `src/test/i18n.test.js` fails on missing keys or dropped `{param}` placeholders, so adding a UI string means adding it to all 15 catalogs. **The wire stays English**: entry `detail` strings (`'Left · 30m'`, `'breastmilk'`), shift `until` labels, and anything regex-parsed or synced stores canonical English and translates at render time only. Language is a device pref (`babylog:lang`), never a household setting.
- **Server i18n**: push copy, API error messages, and mail translate in `api/lang/` (`{code}.json`, English keys; `en.json` is the reference). Push producers pass `[key, params]` pairs to `PushService::notify()` — never pre-baked strings, since copy renders per subscription (`push_subscriptions.lang`). Custom controller messages wrap in `__()`; requests localize via `X-App-Lang` (`SetLocale` middleware → `users.lang`, the email fallback). New server strings go into `en.json` + all 14 catalogs; `tests/Feature/LocaleTest.php` sweeps for missing catalogs.
- **Theming**: `S()` rewrites the comp's fixed palette to CSS variables (`--surface`, `--ink`, `--ink-rgb`…) at parse time — comp hexes in `S()` strings auto-follow the household theme and dark mode. Colors in JS style objects/computed props bypass `S()`, so write `var(--…)` there directly. Light values + the `html.dark` flip live in [src/styles.css](src/styles.css); dark mode & tilt parallax are per-device prefs in [src/fx.js](src/fx.js) (`babylog:fx`), never synced household settings.
- **Never add `theme_color` back to the manifest.** Chrome's installed-PWA color picker (`WebappIntentDataProvider.getColorProvider`) uses a baked light color in OS-dark whenever no dark color exists — and no manifest key can bake a dark one until Chromium ships `color_scheme_dark` (spec merged 2026-04, already declared in our manifest). With no light color baked, the status bar correctly defaults dark/light with the OS. The bar follows the OS scheme only (`ColorUtils.inNightMode`) — no page-side action (metas, JS, reloads) can recolor it, so app-dark on a light OS keeps a light bar until Chrome ships web-app edge-to-edge (the app is already `viewport-fit=cover` + safe-area ready for that).

## Sync rules (don't break these)

- Entries: client-generated UUID ids, tombstone deletes, outbox → batch push, `GET /state?since=` pull. Server never invents entry state; last write wins.
- Realtime is **poke-to-pull**: broadcast `HouseholdTouched` (via its best-effort `::send()`, never raw `broadcast()`), client re-pulls `/state`. Never broadcast data payloads.
- Every new write endpoint needs: auth + the 120/min throttle group, household scoping through `$request->user()->household`, a `HouseholdTouched::send()`, and a feature test in `api/tests/Feature/BabylogApiTest.php`. Parent-only endpoints also join `PARENT_ONLY_ENDPOINTS` in that test (the caregiver-403 sweep).
- **Old-client compat is an invariant** (installed PWAs hit the new server before their JS updates): `/state` keeps the legacy singular `baby` (= primary child), `partner` (= first other member), and `invitePending` keys; `POST /entries` without `baby_id` defaults to the primary child on CREATE only and never re-homes an existing entry on update; a null `baby_id` always reads as the primary child.
- **One write path**: all entry writes go through `App\Services\EntryWriter` and all timer mutations through `App\Services\TimerService` — never a second upsert loop. `/api/v1`, the MCP tools, and the MQTT command handler already do; new producers must too.
- **New `/api/v1` endpoints** need an `ApiScopes` scope on the route, a feature test in `api/tests/Feature/ApiV1Test.php`, and a regenerated `docs/openapi.v1.json` (CI diff-fails a stale spec). Local regen:
  `docker run --rm -v "$PWD:/repo" -w /repo/api -e DB_DATABASE=/tmp/scramble.sqlite composer:2 sh -c "touch /tmp/scramble.sqlite && php artisan migrate --force -q && php artisan scramble:export --path=../docs/openapi.v1.json"`
- **MCP tools count as write endpoints**: scope check via `requireAbilities`, writes via the services above, feature test in `api/tests/Feature/McpTest.php` (including its caregiver/parent-only sweep).
- **MQTT publishes are best-effort** and must never block or fail a write — they ride `HouseholdTouched::send()` (the publisher has a circuit breaker; keep it that way).

## Deploy

- Production = an Unraid box (no SSH — drive the webGui via the user's Chrome; User Scripts plugin runs commands). `babylog-update` pulls `main` and rebuilds; `babylog-reset-data` wipes the DB.
- Public URL, LAN addresses, and reverse-proxy details are deliberately NOT in this repo (it's going public) — they live in Claude's private memory. Never write them into tracked files.
- Registration is invite-only — never register test accounts against production; the first account claims a fresh instance.
- Full runbook: [docs/operations.md](docs/operations.md).

## Current phase

Living with the app to collect feedback in [TESTING.md](TESTING.md), then iterating. Backlog seeds: [docs/known-limitations.md](docs/known-limitations.md). Marketplace release (CA template, tagged versions, pinned installer) comes after.
