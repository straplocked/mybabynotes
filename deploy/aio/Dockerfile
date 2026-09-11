# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Chris Carvache
# All-in-one image for Unraid Community Apps: nginx (PWA + /api fastcgi +
# /app ws proxy), the Laravel API (php-fpm), Reverb, and schedule:work — one
# container, supervised by supervisord (one small, boring package; we don't
# need s6's service graph for four flat processes).
#
# Build from the repo root:
#   docker build -f deploy/aio/Dockerfile -t mybabynotes-aio .
#
# All state (SQLite + the generated .env) lives under the /data volume.

# ---- PWA build (mirrors the root Dockerfile) ----
# Pinned to the BUILD platform, not the target one. This image goes multi-arch
# (amd64 + arm64 for HAOS boxes), and without the pin buildx runs this whole
# stage a second time under QEMU to produce a `dist/` that is byte-identical
# either way — JS is architecture-independent. That emulated Vite build is what
# stalled the v1.2.0 release: the same job that takes ~11 minutes ran 2h35m and
# then 30+ on a re-run, both times sitting in the arm64 leg. Building natively
# once and copying the output into both images removes the whole stage from the
# emulated path. Same reasoning for `deps` below (Composer resolves pure PHP).
FROM --platform=$BUILDPLATFORM node:22-alpine AS webbuild
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.js index.html ./
COPY public ./public
COPY src ./src
# A placeholder gets baked into the bundle; the entrypoint stamps this
# instance's generated REVERB_APP_KEY over it on boot (the Pusher app key is
# public by design — it ships in the JS of every Pusher-protocol app — but
# per-instance keys keep strangers' clients from even handshaking).
ENV VITE_REVERB_APP_KEY=__BABYLOG_REVERB_KEY__
# AGPL §13: a modified build must offer ITS source, not ours — override with
# --build-arg VITE_SOURCE_URL=https://your.host/your-fork
ARG VITE_SOURCE_URL=
ENV VITE_SOURCE_URL=$VITE_SOURCE_URL
RUN npm run build

# ---- API deps (mirrors api/Dockerfile) ----
# Build-platform pinned like webbuild: `vendor/` is PHP source, and Composer
# resolves it against the composer:2 image's own PHP, not the target arch's
FROM --platform=$BUILDPLATFORM composer:2 AS deps
WORKDIR /app
COPY api/composer.json api/composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --no-interaction
COPY api/ .
RUN composer dump-autoload --optimize --no-dev

# ---- Runtime ----
FROM php:8.4-fpm-alpine
# gmp speeds up the Web Push EC crypto (pure-PHP fallback works but is slow).
# libpq is the pdo_pgsql runtime and is named explicitly so the `apk del` of
# the -dev packages can't take it with it as an orphan. The appliance stays
# SQLite-on-/data by default; pdo_pgsql only matters if someone overrides
# DB_CONNECTION to point at a Postgres of their own.
RUN apk add --no-cache gmp gmp-dev libpq postgresql-dev nginx supervisor openssl \
    && docker-php-ext-install pcntl gmp bcmath pdo_pgsql \
    && apk del gmp-dev postgresql-dev
WORKDIR /var/www/html
COPY --from=deps /app /var/www/html
COPY --from=webbuild /app/dist /usr/share/nginx/html
COPY deploy/aio/nginx.conf /etc/nginx/http.d/default.conf
# zzz- so it sorts after the base image's zz-docker.conf and wins
COPY api/fpm.conf /usr/local/etc/php-fpm.d/zzz-babylog.conf
COPY deploy/aio/supervisord.conf /etc/supervisord.conf
COPY deploy/aio/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY real-ip.sh /usr/local/bin/real-ip.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/real-ip.sh && mkdir -p /data /run/nginx

# Static wiring for the single-container layout (parity with
# deploy/unraid/docker-compose.yml). Secrets are NOT here — they are
# generated into /data/.env on first boot. Anything below can still be
# overridden per-container (real env beats the .env file in Laravel).
ENV APP_NAME="mybabynotes" \
    APP_ENV=production \
    APP_DEBUG=false \
    LOG_CHANNEL=stderr \
    DB_CONNECTION=sqlite \
    DB_DATABASE=/data/database.sqlite \
    SESSION_DRIVER=cookie \
    CACHE_STORE=file \
    QUEUE_CONNECTION=sync \
    BROADCAST_CONNECTION=reverb \
    REVERB_HOST=127.0.0.1 \
    REVERB_PORT=8080 \
    REVERB_SCHEME=http \
    REVERB_APP_MAX_CONNECTIONS=100 \
    REVERB_APP_RATE_LIMITING_ENABLED=true

EXPOSE 80
VOLUME /data
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
ENTRYPOINT ["entrypoint.sh"]
