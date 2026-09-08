# Operations

Runbook for a self-hosted instance. Two deployment shapes exist; most sections below apply to both, and say so when they don't.

- **All-in-one container** (the **AIO install**) — one container, one `/data` folder. This is what the Unraid template and the Home Assistant add-on both run, and the recommended way to self-host mybabynotes.
- **Compose stack** (the **compose install**) — three containers built from source on the box, installed and updated by [deploy/unraid/babylog.sh](../deploy/unraid/babylog.sh). The original shape. Still supported, but new installs should pick the AIO, and there's a migration path below for existing ones.

Throughout, `<host-ip>` stands in for your server's LAN address and `https://notes.example.com` for whatever public origin you put in front of it.

## The all-in-one container

[deploy/aio/Dockerfile](../deploy/aio/Dockerfile) builds the whole stack into **one** container, because that's what a one-click install expects. Inside: supervisord keeps nginx (PWA + `/api` fastcgi + `/app` ws proxy on port 80), php-fpm, Reverb, `schedule:work`, and `mqtt:listen` running; everything else matches the three-container compose stack.

```bash
docker run -d -p 3500:80 -v /path/to/data:/data ghcr.io/straplocked/mybabynotes-aio:latest
```

- **`/data` is the instance**: `database.sqlite` + a `.env` holding the secrets. Back up that folder and you have everything.
- **Secrets self-generate on first boot** (a container template can't generate secrets): an empty `/data` gets a fresh `APP_KEY` and `REVERB_*` written to `/data/.env`; later boots reuse it. Migrations run on every boot.
- The generated `REVERB_APP_KEY` is stamped into the served PWA bundle at boot (the image bakes a placeholder), so realtime works without any build-time coupling.
- **Config**: set container environment variables (`APP_URL`, `REVERB_ALLOWED_ORIGINS`, `MAIL_*`, `BABYLOG_OPEN_REGISTRATION`, …), or append them to `/data/.env` and restart the container — container env wins over the file. (Editing `REVERB_APP_KEY` itself needs a re**create**, so the fresh filesystem gets re-stamped.)
- Point a reverse proxy at this container's port 80 with websocket support enabled — see "Remote access" below.

### On Unraid

The template is [deploy/unraid/ca-template.xml](../deploy/unraid/ca-template.xml). The Community Apps listing hasn't been submitted yet, so add it by hand: copy the XML to `/boot/config/plugins/dockerMan/templates-user/` on the flash share (any filename ending `.xml`), then Docker tab → **Add Container** → pick it from the Template dropdown. Set **Data** to an appdata folder of its own (e.g. `/mnt/user/appdata/mybabynotes`) and **WebUI port** to the host port you want (default 3500).

The template pre-declares `APP_URL` and `REVERB_ALLOWED_ORIGINS`; anything else goes in as an extra variable in the container editor.

### On Home Assistant

The add-on wraps this same image and puts it in the HA sidebar via ingress, with `/data` riding HA's own backups. Install and configuration: [home-assistant.md](home-assistant.md#the-add-on).

### Updating

The image's `:latest` tag only ever moves on a tagged release — `main` builds never touch it — so "update" means pulling `:latest` again:

- **Unraid**: Docker tab → the container → **Force update** (or let the Docker tab's update check offer it).
- **Anywhere else**: `docker pull ghcr.io/straplocked/mybabynotes-aio:latest` and recreate the container.

Migrations run on the next boot; `/data` is untouched. To pin — or to roll back — use `:vX.Y.Z` instead of `:latest`.

## The compose stack (legacy)

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

### Install / update

[deploy/unraid/babylog.sh](../deploy/unraid/babylog.sh) is both the installer and the updater, and it's idempotent — running it again is the update. It needs Unraid's *Docker Compose Manager* plugin (that's what provides `docker compose`):

```bash
curl -fsSL https://raw.githubusercontent.com/straplocked/mybabynotes/main/deploy/unraid/babylog.sh | sh
```

It resolves the **latest GitHub release** (`releases/latest`), downloads that release's source tarball, sha256-verifies it against the release's `checksums.txt`, rebuilds, and restarts; `.env` and `data/` are untouched. Because it builds from source on the box, this path never pulls from GHCR.

- Pin a specific ref with `BABYLOG_REF`: `BABYLOG_REF=v1.0.2` installs that release (checksum-verified when the release carries `checksums.txt`; a warning + unverified fallback otherwise), `BABYLOG_REF=main` tracks `main` instead of releases.
- If the GitHub API is unreachable the script falls back to an unverified `main` tarball rather than dead-ending.
- On Unraid the convenient wrapper is a *User Scripts* entry whose whole body is that `curl … | sh` line, so updating is a button in the webGui. Re-running the script is what applies any `.env` change, since compose only injects `.env` into containers when it recreates them.

## Wipe all data (testing)

There is no button for this — it's a file delete. Stop the app, remove the database, start it again; migrations recreate an empty one. Every account and entry is gone and **the next sign-up claims the instance**. Secrets in `.env` are kept, so installed phones keep their realtime pairing.

```bash
# AIO install
docker stop mybabynotes && rm /path/to/data/database.sqlite && docker start mybabynotes

# compose install
docker stop baby-log-api baby-log-reverb
rm /mnt/user/appdata/baby-log/data/database.sqlite
docker start baby-log-api baby-log-reverb
```

To remove one account or one household instead of everything, use the admin commands below — they're the surgical alternative.

## Backups

The entire state is one sqlite file plus the `.env` holding the secrets — and `.env` matters as much as the database: `APP_KEY` also encrypts the stored MQTT broker password, so restoring the database under a different key breaks the Home Assistant integration until it's re-configured. Where the pair lives depends on the shape:

- **AIO install**: both sit flat in the `/data` folder you mounted (`database.sqlite`, `.env`). Back up that one folder.
- **Compose install**: `/mnt/user/appdata/baby-log/data/database.sqlite`, with `.env` one level up at `/mnt/user/appdata/baby-log/.env`. Manual restore: stop api+reverb, replace the sqlite file, start.
- **Generic Docker Compose** (the repo-root compose file): the database lives in the **named volume** `babylog-db`, not a host path — back it up with e.g. `docker run --rm -v babylog-db:/data -v "$PWD:/backup" alpine cp /data/database.sqlite /backup/`, plus your `.env`.

On Unraid, the **Appdata Backup** plugin covers whichever appdata folder you used — verify it's in its share list.

## Moving a compose install to the all-in-one container

The all-in-one image expects **one flat folder**: `/data/database.sqlite` beside `/data/.env`. The compose install nests them differently:

```
/mnt/user/appdata/baby-log/     <- compose install
  .env                          #   secrets
  data/database.sqlite          #   THE data, one level down
  src/
```

**Do not point the app's Data path at that folder.** The container would find `.env` (so it would keep your keys) but *not* the database — it creates an empty one at `/data/database.sqlite` and starts as a blank instance, with the real log still sitting in `data/`. Nothing is deleted, but a blank instance is claimable by the next sign-up, so treat it as dangerous rather than merely untidy.

Migrate into a **new folder** instead, which also leaves the old one intact as an instant rollback:

1. Note your row counts first, so you can prove the move worked:
   ```
   docker exec baby-log-api php -r '$d=new PDO("sqlite:/data/database.sqlite"); foreach(["users","babies","entries"] as $t) echo $t,": ",$d->query("select count(*) from $t")->fetchColumn(),"\n";'
   ```
2. Stop the old containers so nothing is mid-write: `docker stop baby-log-app baby-log-api baby-log-reverb`
3. Back up, then build the new folder — carrying **`APP_KEY` forward is required**, since it decrypts the stored MQTT broker password, and carrying `REVERB_APP_KEY` forward keeps already-installed phones on websockets instead of falling back to polling:
   ```
   cp -a /mnt/user/appdata/baby-log /mnt/user/appdata/baby-log.bak-$(date +%F)
   mkdir -p /mnt/user/appdata/mybabynotes
   cp -a /mnt/user/appdata/baby-log/data/database.sqlite /mnt/user/appdata/mybabynotes/database.sqlite
   grep -E '^(APP_KEY|REVERB_APP_ID|REVERB_APP_KEY|REVERB_APP_SECRET|VAPID_SUBJECT)=' \
     /mnt/user/appdata/baby-log/.env > /mnt/user/appdata/mybabynotes/.env
   chown -R 82:82 /mnt/user/appdata/mybabynotes
   ```
4. Install the all-in-one container with **Data** = `/mnt/user/appdata/mybabynotes` and the same host port you were using (default 3500), so your reverse proxy needs no change.
5. Start it and check the counts match. The old folder and stopped containers are your rollback until you're satisfied; delete them once you are.

Keep `.env` in your backups either way — losing `APP_KEY` strands anything encrypted with it.

## Using Postgres instead of SQLite

SQLite is the default and needs no configuration — it's what the appliance ships and what these backup instructions assume. If you already run a Postgres and would rather keep this database there too, the images carry `pdo_pgsql`; set these on the AIO container (or on the `api` **and** `reverb` containers of a compose install):

```
DB_CONNECTION=pgsql
DB_HOST=postgres
DB_PORT=5432
DB_DATABASE=babylog
DB_USERNAME=babylog
DB_PASSWORD=...
```

Migrations run on boot exactly as they do under SQLite, and the entrypoint retries for ~30s first so a database that starts alongside the app isn't a crash loop. Nothing else changes: the `/data` volume is then only holding `.env` (the all-in-one image still generates its secrets there), so **back up your Postgres *and* `.env`** — `APP_KEY` decrypts the stored MQTT broker password. There is no migration path between drivers: switching moves you to an empty database, so export your log first (Settings → "Share with your pediatrician") if you're changing an instance that already has data.

The feature suite runs against both drivers in CI, so a Postgres instance is a supported configuration rather than a best-effort one — but SQLite is the better-trodden path, and unless you have a reason to want Postgres, the default is the one to pick.

## Remote access (reverse proxy)

Point your reverse proxy (e.g. Nginx Proxy Manager, SWAG, Caddy) at the app's mapped port: `notes.example.com → http://<host-ip>:3500` with **websocket support enabled** (required for Reverb), plus the usual Force SSL / HTTP/2 / Let's Encrypt cert. Set `APP_URL` to the public origin so emailed links and the push VAPID subject are right.

If realtime breaks remotely but works on LAN, check the websocket toggle on the proxy host first.

**Rate limiting behind the proxy**: by default nginx's rate limits key on the direct peer — behind a reverse proxy that's the proxy itself, making the caps instance-wide. Set `TRUSTED_PROXIES` to the proxy's IP or CIDR (comma-separated for several hops) and the limits key on real client addresses instead: on the AIO install it's a container variable; on a compose install append `TRUSTED_PROXIES=<proxy-ip>` to `/mnt/user/appdata/baby-log/.env` and re-run the install script. Only name proxies you control — this tells nginx to believe their `X-Forwarded-For`.

## Registration policy

Invite-only by default: the first sign-up claims a fresh instance; after that only invited emails with their single-use code can register. To open it up (not recommended on a publicly reachable instance): set `BABYLOG_OPEN_REGISTRATION=true`.

- **AIO install**: add it as a container variable, or append it to `/data/.env` and restart the container.
- **Compose install**: append it to `/mnt/user/appdata/baby-log/.env` and re-run the install script once, so compose recreates the containers with the new value. Don't hand-edit the deployed compose file — the update script replaces the source tree wholesale on every update, so that edit wouldn't survive.

## Admin commands (lost passwords, stuck accounts, un-claiming)

There's no admin UI on purpose — admin actions are `artisan` commands inside the container, unreachable from the network. Run them from a host terminal or any script runner (no `-it` needed; pass `--force` where a command would otherwise prompt):

```
docker exec mybabynotes php artisan babylog:users         # AIO install
docker exec baby-log-api php artisan babylog:users        # compose install
```

- **`babylog:users`** — read-only map of the instance: households, members (role, on-duty), children, pending invites, former members. Start here; the other commands act on what it shows.
- **`babylog:reset-password <email> [--password=…]`** — the no-SMTP escape hatch for a locked-out account. Prints a generated password (or sets yours, min 8 chars) and signs out every device. The password lands in the script output — have the person log in and change it in Settings right away.
- **`babylog:remove-user <email> --force`** — same semantics as removing a member in the app (sessions/pushes revoked, duty reassigned, name snapshotted so their old entries stay attributed), for when no parent can do it from the UI. Refuses to remove a household's last member — that's a delete-household.
- **`babylog:delete-household <id> --force`** — deletes one household with all its members, children and entries. When the last household goes, the next sign-up claims the instance — the surgical alternative to wiping the database when you want to un-claim without losing secrets/VAPID keys or other households.

## Enabling email (invite mail + password reset)

Out of the box the instance can't send mail (`MAIL_MAILER` defaults to `log`): invites show the shareable code only, and "Forgot password?" tells the user this server can't send email. To turn email on, set SMTP credentials as container variables (AIO install) or append them to the instance's `.env`:

```
MAIL_MAILER=smtp
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_USERNAME=you@example.com
MAIL_PASSWORD=app-password
MAIL_FROM_ADDRESS=you@example.com
# MAIL_SCHEME=smtps   # only for implicit-TLS servers (usually port 465)
```

Then make the containers pick it up: restart the AIO container, or on a compose install re-run the install script once. That step is required, not optional — compose only injects `.env` values into containers when it (re)creates them, and `docker compose up -d` recreates api+reverb because their environment changed. Nothing beyond that: no config cache to clear (the containers don't run `config:cache`).

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

`.github/workflows/release.yml`: pushing a `v*` tag runs both suites — the API one twice, against SQLite **and** a Postgres service container, so a release can't ship a driver regression — then builds and pushes `mybabynotes-app`, `mybabynotes-api`, and `mybabynotes-aio` tagged `:vX.Y.Z` **and** `:latest` (releases own `:latest`; `main` builds never touch it), plus the two per-arch add-on images below. It then creates a GitHub Release with generated notes, a `git archive` source tarball (`mybabynotes-vX.Y.Z.tar.gz`), and its sha256 in `checksums.txt`. The compose updater consumes that tarball + checksum; the AIO image is what the Unraid template and the HA add-on run.

All five GHCR packages are public, so every pull is anonymous. A brand-new package name starts *private* on GitHub, though — if one is ever added, flip it public or users get a misleading "manifest not found".

`.github/dependabot.yml`: weekly grouped npm + composer updates, monthly GitHub Actions and Docker base-image updates. They arrive as PRs, so they land on the same test gate as anything else — a green Dependabot PR is safe to merge, and merging it is what publishes new `:main` images.

### Home Assistant add-on release flow

[deploy/ha-addon/](../deploy/ha-addon/) is the **source of truth** for the add-on; the `straplocked/mybabynotes-hassio-addons` repo users add to HA is only a publish target. On a `v*` tag, `release.yml` builds the per-arch add-on images (`ghcr.io/straplocked/mybabynotes-ha-addon-{amd64,aarch64}`, layered on the multi-arch AIO image), then stamps the tag into `config.yaml`'s `version` and pushes the manifest/docs/icons to the addons repo. That last job needs the **`ADDONS_REPO_TOKEN`** repository secret — a fine-grained PAT with `contents: write` on the addons repo — and skips with a warning if it's missing, so a fork tags releases without it. Never edit the addons repo by hand; change `deploy/ha-addon/` and tag.

There is no add-on "store" to submit to: Home Assistant's built-in store lists official add-ons only, and third-party add-ons are distributed exactly this way — a repository the user adds. Publishing the tag *is* the release.

### Building the all-in-one image yourself

The published image is what the template and add-on pull, but the Dockerfile builds standalone from a checkout:

```bash
docker build -f deploy/aio/Dockerfile -t mybabynotes-aio .        # from the repo root
docker run -d -p 3500:80 -v /path/to/data:/data mybabynotes-aio
```

## Troubleshooting

Container names below are the compose install's; on an AIO install there's one container (`mybabynotes` by default) holding all of it, so read `docker logs mybabynotes` wherever a specific one is named.

| Symptom | Check |
|---|---|
| App up, changes not appearing on partner's phone | `docker logs baby-log-reverb`; the proxy's websocket toggle; client falls back to 20s polls so data still converges |
| 500s from `/api` | `docker logs baby-log-api` (Laravel logs to stderr) |
| "invite-only" on a legit partner signup | Exact email match required (lowercased) + the code from the invite toast; re-invite to regenerate a code |
| Update script fails on compose | Compose Manager plugin must be installed (provides `docker compose`) |
| Wrong/lost secrets | `.env` beside the database; keep APP_KEY stable — tokens survive a change (hashed, not encrypted) but the stored MQTT broker password does not (encrypted column) — re-enter it in Settings → Home Assistant after a key change |
| HA entities `unavailable` or buttons dead | The `mqtt:listen` process is down or can't reach the broker — check the container logs and Settings → Home Assistant → Test connection. See [home-assistant.md](home-assistant.md#troubleshooting) |
| A phone suddenly asks to log in again | Only happens after ~90 days of *not using the app* — token expiry slides from last use, so a device in regular use never ages out; logging back in is the whole fix |
