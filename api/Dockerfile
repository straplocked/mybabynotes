# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Chris Carvache
FROM composer:2 AS deps
WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --no-interaction
COPY . .
RUN composer dump-autoload --optimize --no-dev

# FPM serves the API (php-fpm workers behind a loopback nginx on :8000, so the
# container's interface stays plain HTTP for the app proxy and the vite dev
# proxy); the same image also runs Reverb and artisan via the bundled CLI.
FROM php:8.5-fpm-alpine
# gmp speeds up the Web Push EC crypto (pure-PHP fallback works but is slow).
# libpq is the pdo_pgsql runtime and is named explicitly so the `apk del` of
# the -dev packages can't take it with it as an orphan; SQLite stays the
# default driver, pdo_pgsql is just there for whoever points DB_CONNECTION
# at a Postgres they already run.
RUN apk add --no-cache nginx gmp gmp-dev libpq postgresql-dev \
    && docker-php-ext-install pcntl gmp bcmath pdo_pgsql \
    && apk del gmp-dev postgresql-dev
WORKDIR /var/www/html
COPY --from=deps /app /var/www/html
COPY nginx.conf /etc/nginx/http.d/default.conf
# zzz- so it sorts after the base image's zz-docker.conf and wins
COPY fpm.conf /usr/local/etc/php-fpm.d/zzz-babylog.conf
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data /run/nginx
EXPOSE 8000 8080
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["api"]
