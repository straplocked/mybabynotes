# Operations

Runbook for a self-hosted instance. Production is an Unraid box (referred to as the "NAS" below; `<nas-ip>` stands in for its LAN address), optionally published at a public domain through a reverse proxy.

## Layout on Unraid

```
/mnt/user/appdata/baby-log/
  .env      # generated on first install: APP_KEY, REVERB_* secrets, APP_PORT, DATA_DIR
  src/      # extracted GitHub tarball (replaced on every update)
  data/     # database.sqlite — THE data. Survives updates and rebuilds.
```

Containers (compose project `baby-log`, from `src/deploy/unraid/docker-compose.yml`):

| Container | Role | Exposure |
|---|---|---|
| `baby-log-app` | nginx: PWA + `/api` + `/app` ws proxy | host port **3500** |
| `baby-log-api` | Laravel (php-fpm behind a loopback nginx), migrates on boot | internal only |
| `baby-log-reverb` | websocket server | internal only |

## Update / install

Unraid webGui → **Settings → User Scripts → `babylog-update` → Run Script**. It resolves the **latest GitHub release** (`releases/latest`), downloads that release's source tarball, sha256-verifies it against the release's `checksums.txt`, rebuilds, and restarts; `.env` and `data/` are untouched. The same script is the installer (idempotent).

- If no release exists yet or the GitHub API is unreachable, the script falls back to tracking `main` (unverified tarball) so updates never dead-end.
- Pin a specific ref with `BABYLOG_REF` in the environment: `BABYLOG_REF=v1.0.0` installs that release (checksum-verified when the release carries `checksums.txt`; a warning + unverified fallback otherwise), `BABYLOG_REF=main` restores the old track-main behavior.
- The script lives at [deploy/unraid/babylog.sh](../deploy/unraid/babylog.sh); the User Script is just `curl | sh` of it from `main`.

## Wipe all data (testing)

**Settings → User Scripts → `babylog-reset-data`** — stops api+reverb, deletes `database.sqlite`, restarts (migrations recreate it). Every account and entry is gone; **the next sign-up claims the instance**. Secrets are kept. (To remove just one account or household instead of everything, see "Admin commands" below.) (Unlike `babylog-update`, this script lives only on the NAS — it isn't tracked in the repo, so recreate it by hand after a flash rebuild: stop api+reverb, `rm data/database.sqlite`, start.)

## Backups

The entire state is one file: `/mnt/user/appdata/baby-log/data/database.sqlite` (plus `.env` for the secrets — and `.env` matters more than it used to: `APP_KEY` now also encrypts the stored MQTT broker password, so restoring the database under a different key breaks the Home Assistant integration until it's re-configured). Unraid's **Appdata Backup** plugin covers `appdata/baby-log` if installed — verify it's included in its share list. Manual restore: stop api+reverb, replace the sqlite file, start.

On a generic Docker Compose install (the repo-root compose file), the database lives in the **named volume** `babylog-db`, not a host path — back it up with e.g. `docker run --rm -v babylog-db:/data -v "$PWD:/backup" alpine cp /data/database.sqlite /backup/`, plus your `.env`.

## Remote access (reverse proxy)

Point your reverse proxy (e.g. Nginx Proxy Manager) at the app container: `your-domain → http://<nas-ip>:3500` with **websocket support enabled** (required for Reverb), plus the usual Force SSL / HTTP/2 / Let's Encrypt cert.

If realtime breaks remotely but works on LAN, check the websocket toggle on the proxy host first.

**Rate limiting behind the proxy**: by default nginx's rate limits key on the direct peer — behind a reverse proxy that's the proxy itself, making the caps instance-wide. Set `TRUSTED_PROXIES` to the proxy's IP or CIDR (comma-separated for several hops) and the limits key on real client addresses instead: on the compose-based script install append `TRUSTED_PROXIES=<proxy-ip>` to `/mnt/user/appdata/baby-log/.env` and run `babylog-update`; on the CA install it's an advanced container variable. Only name proxies you control — this tells nginx to believe their `X-Forwarded-For`.

## Registration policy

Invite-only by default: the first sign-up claims a fresh instance; after that only invited emails with their single-use code can register. To open it up (not recommended while public): on the all-in-one/CA install, add a `BABYLOG_OPEN_REGISTRATION=true` container variable in Unraid's container editor. On the compose-based script install, append `BABYLOG_OPEN_REGISTRATION=true` to `/mnt/user/appdata/baby-log/.env` (same mechanism as the `MAIL_*` vars in "Enabling email" below) and run **`babylog-update`** once so compose recreates the containers with the new value. Don't hand-edit the deployed compose file — the update script replaces the source tree wholesale on every update, so that edit wouldn't survive.

## Admin commands (lost passwords, stuck accounts, un-claiming)

There's no admin UI on purpose — admin actions are `artisan` commands inside the api container, unreachable from the network. Run them from a host terminal or a User Scripts script (no `-it` needed; scripts pass `--force` where a command would otherwise prompt):

```
docker exec baby-log-api php artisan babylog:users        # compose-based script install
docker exec mybabynotes php artisan babylog:users         # CA all-in-one install
```

- **`babylog:users`** — read-only map of the instance: households, members (role, on-duty), children, pending invites, former members. Start here; the other commands act on what it shows.
- **`babylog:reset-password <email> [--password=…]`** — the no-SMTP escape hatch for a locked-out account. Prints a generated password (or sets yours, min 8 chars) and signs out every device. The password lands in the script output — have the person log in and change it in Settings right away.
- **`babylog:remove-user <email> --force`** — same semantics as removing a member in the app (sessions/pushes revoked, duty reassigned, name snapshotted so their old entries stay attributed), for when no parent can do it from the UI. Refuses to remove a household's last member — that's a delete-household.
- **`babylog:delete-household <id> --force`** — deletes one household with all its members, children and entries. When the last household goes, the next sign-up claims the instance — the surgical alternative to `babylog-reset-data` when you want to un-claim without wiping secrets/VAPID keys or other households.

## Enabling email (invite mail + password reset)

Out of the box the instance can't send mail (`MAIL_MAILER` defaults to `log`): invites show the shareable code only, and "Forgot password?" tells the user this server can't send email. To turn email on, append SMTP credentials to `/mnt/user/appdata/baby-log/.env` (User Scripts can do it, or edit the file over SMB):

```
MAIL_MAILER=smtp
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_USERNAME=you@example.com
MAIL_PASSWORD=app-password
MAIL_FROM_ADDRESS=you@example.com
# MAIL_SCHEME=smtps   # only for implicit-TLS servers (usually port 465)
```

Then run **`babylog-update`** once. That's required, not optional: compose only injects `.env` values into the containers when it (re)creates them, and the update script's `docker compose up -d` recreates api+reverb because their environment changed. Nothing else — no config cache to clear (the containers don't run `config:cache`), no manual container restarts.

With mail on: invites also email the code to the partner (the on-screen code still works and stays the source of truth), and "Forgot password?" emails a reset link pointing at `APP_URL/?reset=…` — so `APP_URL` in that same `.env` must be the real public origin (e.g. `https://notes.example.com`) or the links will point somewhere useless. A failed SMTP send never blocks an invite; it falls back to code-only (`mailed: false`).

## Local development

```bash
cp .env.example .env       # then fill APP_KEY + REVERB_APP_SECRET (commands in the file)
npm install
docker compose up -d --build   # full stack on http://localhost:3500 (api :3501, reverb :3502)
npm run dev                    # OR: Vite dev server on :3500, proxying to the containers
```

Host PHP on the dev machine lacks extensions — run all composer/artisan through containers:

```bash
docker run --rm -v "$PWD/api:/app" -w /app composer:2 php artisan <cmd>
```

Tests — both suites must pass before pushing (a push to `main` publishes images):

```bash
docker run --rm -v "$PWD/api:/app" -w /app -e BROADCAST_CONNECTION=log composer:2 php artisan test --compact
```

```bash
npm test
```

Building a **modified** instance for other people? Set `VITE_SOURCE_URL` to your own repository at build time so the app's Settings → Source code link points at the code you're actually running (the AGPL's network clause); unset, it points at the upstream project.

Two accounts in one browser: open `http://localhost:3500` and `http://127.0.0.1:3500` — different origins, separate sessions.

## MQTT listener (Home Assistant)

The [Home Assistant integration](home-assistant.md) needs a long-lived `php artisan mqtt:listen` process (command topics + availability via Last Will). It runs automatically in every deployment shape — backgrounded by `api/docker-entrypoint.sh` in the compose stacks (same supervision tradeoff as `schedule:work`), a supervisord program in the AIO image — and idles when no household has MQTT enabled, so there is nothing to configure or turn off. If HA entities go `unavailable`, this process (or the broker) is what's down.

## CI / images

`.github/workflows/build-images.yml`: on every push to `main` (or manual `workflow_dispatch`), runs both test suites in parallel jobs — the API suite (plus an OpenAPI-spec freshness check that diff-fails a stale `docs/openapi.v1.json`) and the frontend Vitest suite — then (only if both are green) builds and pushes `ghcr.io/straplocked/mybabynotes-app` and `…-api` (`:main` + commit SHA). **Pull requests run the same two test jobs and stop there** — the build job is skipped, so a PR is gated on green tests without publishing anything.

`.github/workflows/release.yml`: pushing a `v*` tag runs the same two suites, then builds and pushes all three images — `mybabynotes-app`, `mybabynotes-api`, and `mybabynotes-aio` — tagged `:vX.Y.Z` **and** `:latest` (releases own `:latest`; `main` builds never touch it), then creates a GitHub Release with generated notes, a `git archive` source tarball (`mybabynotes-vX.Y.Z.tar.gz`), and its sha256 in `checksums.txt`. The Unraid updater consumes that tarball + checksum; the images are the basis for the Unraid Community Apps template.

`.github/dependabot.yml`: weekly grouped npm + composer updates, monthly GitHub Actions and Docker base-image updates. They arrive as PRs, so they land on the same test gate as anything else — a green Dependabot PR is safe to merge, and merging it is what publishes new `:main` images.

### Home Assistant add-on release flow

[deploy/ha-addon/](../deploy/ha-addon/) is the **source of truth** for the add-on; the `straplocked/mybabynotes-hassio-addons` repo users add to HA is only a publish target. On a `v*` tag, `release.yml` builds the per-arch add-on images (`ghcr.io/straplocked/mybabynotes-ha-addon-{amd64,aarch64}`, layered on the multi-arch AIO image), then stamps the tag into `config.yaml`'s `version` and pushes the manifest/docs/icons to the addons repo. That last job needs the **`ADDONS_REPO_TOKEN`** repository secret — a fine-grained PAT with `contents: write` on the addons repo — and skips with a warning until it exists. Never edit the addons repo by hand; change `deploy/ha-addon/` and tag.

### Repo-rename migration (baby-log → mybabynotes) — production checklist

The GitHub repo was renamed `straplocked/baby-log` → `straplocked/mybabynotes` (2026-09-04). GitHub redirects the old repo/raw/tarball URLs, but **GHCR packages do not follow a repo rename** — the image names above are new packages that only come into existence on the next push, and each starts **private**. Until every step below is done, anonymous pulls of the new names fail with a misleading "manifest not found":

1. After the first post-rename push to `main`, flip the new packages public: GitHub → profile → Packages → `mybabynotes-app` and `mybabynotes-api` → Package settings → Danger Zone → Change visibility → Public. (`mybabynotes-aio` appears with the first post-rename `v*` tag — flip it then too.)
2. The old `baby-log-*` packages stay published under their old names and keep working; leave them until nothing references them, then delete or deprecate.
3. The `babylog-update` User Script on the NAS is a `curl | sh` of `deploy/unraid/babylog.sh` from the old raw URL. The redirect keeps it working (and the fetched script now carries the new repo/tarball names), but update the User Script's URL to `https://raw.githubusercontent.com/straplocked/mybabynotes/main/deploy/unraid/babylog.sh` — the redirect dies if the old name is ever reused.
4. Note the compose-based production stack **builds from source on the NAS** (`docker compose up -d --build`) — it never pulls GHCR, so production updates don't depend on package visibility. The visibility flips matter for the CA/all-in-one route and anyone pulling images directly.
5. Appdata paths (`/mnt/user/appdata/baby-log`), the compose project name (`-p baby-log`), container names (`baby-log-app/api/reverb`), and the `babylog-update`/`babylog-reset-data` script names are **unchanged on purpose** — they point at live state, and renaming the compose project would orphan the running stack.

## All-in-one image (Community Apps)

[deploy/aio/Dockerfile](../deploy/aio/Dockerfile) builds the whole stack into **one** container — CA users expect one-click single containers. Inside: supervisord keeps nginx (PWA + `/api` fastcgi + `/app` ws proxy on port 80), php-fpm, Reverb, `schedule:work`, and `mqtt:listen` running; everything else matches the three-container compose stack.

```bash
docker build -f deploy/aio/Dockerfile -t mybabynotes-aio .        # from the repo root
docker run -d -p 3500:80 -v /path/to/data:/data mybabynotes-aio
```

- **`/data` is the instance**: `database.sqlite` + a `.env` holding the secrets. Back up that volume and you have everything.
- **Secrets self-generate on first boot** (CA templates can't generate secrets): an empty `/data` gets a fresh `APP_KEY` and `REVERB_*` written to `/data/.env`; later boots reuse it. Migrations run on every boot.
- The generated `REVERB_APP_KEY` is stamped into the served PWA bundle at boot (the image bakes a placeholder), so realtime works without any build-time coupling.
- **Config**: set container env vars in Unraid's container editor (the template pre-declares `APP_URL` and `REVERB_ALLOWED_ORIGINS`; add `MAIL_*`, `BABYLOG_OPEN_REGISTRATION`, etc. as extra variables by hand), or append them to `/data/.env` and restart the container — container env wins over the file. (Editing `REVERB_APP_KEY` itself needs a re**create**, so the fresh filesystem gets re-stamped.)
- Reverse proxy guidance is the same as above: point it at this container's port 80 with websocket support enabled.

## Troubleshooting

| Symptom | Check |
|---|---|
| App up, changes not appearing on partner's phone | `docker logs baby-log-reverb`; NPM websocket toggle; client falls back to 20s polls so data still converges |
| 500s from `/api` | `docker logs baby-log-api` (Laravel logs to stderr) |
| "invite-only" on a legit partner signup | Exact email match required (lowercased) + the code from the invite toast; re-invite to regenerate a code |
| Update script fails on compose | Compose Manager plugin must be installed (provides `docker compose`) |
| Wrong/lost secrets | `.env` in appdata; keep APP_KEY stable — tokens survive a change (hashed, not encrypted) but the stored MQTT broker password does not (encrypted column) — re-enter it in Settings → Home Assistant after a key change |
| HA entities `unavailable` or buttons dead | The `mqtt:listen` process inside the api container is down or can't reach the broker — check `docker logs baby-log-api` (or the AIO container) and Settings → Home Assistant → Test connection. See [home-assistant.md](home-assistant.md#troubleshooting) |
| A phone suddenly asks to log in again | Only happens after ~90 days of *not using the app* — token expiry slides from last use, so a device in regular use never ages out; logging back in is the whole fix |
