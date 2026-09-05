# Contributing to mybabynotes

Thanks for your interest! mybabynotes is a young project being actively shaped by real-world use, so contributions of every size are welcome — bug reports, docs fixes, and code.

## Before you write code

- **Bugs**: open an issue with steps to reproduce (there's a template). Small, obvious fixes can go straight to a PR.
- **Features**: open an issue first so we can agree on the approach before you invest time. [docs/known-limitations.md](docs/known-limitations.md) lists known gaps and roadmap candidates — those are good starting points.
- **Security issues**: never open a public issue — see [SECURITY.md](SECURITY.md).

## Licensing: what you're agreeing to

mybabynotes is open source under the [AGPL-3.0](LICENSE). There is also an official hosted (SaaS) edition of the app, run by the maintainer, that combines this codebase with closed-source billing/tenancy components.

To keep that model possible, **all contributions require signing the [Contributor License Agreement](CLA.md)** before they can be merged. In plain terms, the CLA says:

1. Your contribution is your own original work (or you have the right to submit it).
2. You keep the copyright to your contribution.
3. You give the maintainer a broad license to it — including the right to distribute it under other licenses, which is what allows your code to ship in both the AGPL edition and the hosted edition.

Signing is a one-time click via the CLA bot on your first pull request. If you're contributing on behalf of your employer, mention it in the PR so we can sort out a corporate signature.

If that arrangement isn't for you, that's completely fair — the AGPL still gives you every right to fork and build on the project independently. If you do run a modified build for other people, point its in-app source link at your own repository (`VITE_SOURCE_URL` at build time) — that's what the AGPL's network clause asks for, and it keeps your users pointed at the code they're actually running.

## Development setup

The whole stack runs in Docker — see [README → Local development](README.md#5-local-development). Two things that trip people up:

- **PHP runs in containers only.** Don't install PHP on your host; run artisan and composer like this:

  ```bash
  docker run --rm -v "$PWD/api:/app" -w /app composer:2 php artisan <command>
  ```

- **Secrets live in a git-ignored `.env`** (copy `.env.example`). Never commit credentials of any kind.

## Making changes

A few project invariants — [docs/architecture.md](docs/architecture.md) explains the reasoning:

- All entry writes go through `App\Services\EntryWriter` and all timer mutations through `App\Services\TimerService`. Never add a second write path.
- Realtime is poke-to-pull: broadcast `HouseholdTouched::send()` after writes; never broadcast data payloads.
- New API endpoints need auth, throttling, household scoping, and a feature test. New `/api/v1` endpoints also need an `ApiScopes` scope and a regenerated `docs/openapi.v1.json` (CI fails on a stale spec).
- UI changes should follow the existing design system (see the palette and conventions in [CLAUDE.md](CLAUDE.md)).
- **Every user-facing string goes through `t('English string', {params})`** from [src/i18n.js](src/i18n.js). English strings *are* the keys, so a new string means adding it to all 15 catalogs in [src/locales/](src/locales/) — `src/test/i18n.test.js` fails on a missing key or a dropped `{param}`. If you can't translate it, say so in the PR and copy the English into the other catalogs; a native-speaker correction to an existing translation is a very welcome PR on its own.
- **New source files carry the licence header** — two lines at the top, matching the file's comment syntax:

  ```
  // SPDX-License-Identifier: AGPL-3.0-only
  // Copyright (C) 2026 Chris Carvache
  ```

  Keep your own copyright line on files you author (the CLA covers the licensing, not the authorship). Laravel's untouched skeleton files (`api/config/*` except `babylog.php`, `api/bootstrap/`, `api/artisan`, `api/resources/`, the `0001_01_01_*` migrations) are MIT scaffolding and deliberately carry no header.
- **The wire stays English.** Entry `detail` strings (`'Left · 30m'`, `'breastmilk'`), shift "until" labels, and anything regex-parsed store canonical English and translate at render time only — one household can have phones set to different languages, and the shared log has to survive that.

## Tests

Both suites must pass — CI runs them, and a green `main` is what production updates from:

```bash
docker run --rm -v "$PWD/api:/app" -w /app -e BROADCAST_CONNECTION=log composer:2 php artisan test --compact
```

```bash
npm test
```

New endpoints and behavior changes need test coverage (`api/tests/Feature/` for the API, `src/test/` for the frontend).

## Pull requests

- Keep PRs focused — one fix or feature per PR.
- Describe *why*, not just *what*, in the description.
- Make sure both test suites pass locally before pushing.
- The CLA check and CI must be green before review.

## Code of conduct

Be kind. This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).
