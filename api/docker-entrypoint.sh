#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Chris Carvache

set -e

if [ "$1" = "reverb" ]; then
  exec php artisan reverb:start --host=0.0.0.0 --port=8080
fi

: "${DB_CONNECTION:=sqlite}"

# SQLite is a file this container owns; every other driver is a server
# somewhere else, where the /data prep below would only leave a junk file
# named after the database (and fail outright with no /data volume mounted).
if [ "$DB_CONNECTION" = "sqlite" ]; then
  # export, not a bare shell default: php inherits the environment, so an
  # unexported assignment would leave Laravel on its own database_path()
  # fallback while we touched and chowned a file it never opens
  export DB_DATABASE="${DB_DATABASE:-/data/database.sqlite}"
  [ -f "$DB_DATABASE" ] || touch "$DB_DATABASE"
  # fpm workers run as www-data (artisan serve ran as root): the SQLite file
  # and its transient journal (dir write!) must be theirs — re-done each boot
  # to catch strays
  chown -R www-data:www-data /data
fi

# storage/ (compiled mail views, the file cache) and bootstrap/cache belong to
# www-data whatever the database is
chown -R www-data:www-data storage bootstrap/cache

if [ "$DB_CONNECTION" = "sqlite" ]; then
  php artisan migrate --force
else
  # A managed Postgres is up long before we are, but a compose sidecar may not
  # be: retry briefly so a cold `docker compose up` logs a wait instead of
  # crash-looping. A migration that fails for a real reason still exits, just
  # 30s later, with its error on stderr each time.
  n=0
  until php artisan migrate --force; do
    n=$((n + 1))
    [ "$n" -ge 10 ] && { echo "ERROR: database unreachable after 10 attempts" >&2; exit 1; }
    echo "==> database not ready, retrying in 3s ($n/10)" >&2
    sleep 3
  done
fi
# reminder pushes (feed gap / wake window / meds) ride the scheduler; per-minute
# chatter goes to /dev/null but errors stay on stderr
php artisan schedule:work >/dev/null &
# Home Assistant / MQTT command listener + availability. Safe to run always:
# it idles when no household has MQTT configured, and its internal loop never
# exits (that loop is the supervision here, same tradeoff as the scheduler)
php artisan mqtt:listen >/dev/null &
# nginx self-daemonizes and just translates HTTP→FastCGI; php-fpm is the
# process that matters, so it keeps the foreground — if it dies, the
# container dies and docker's restart policy brings the pair back
nginx
exec php-fpm
