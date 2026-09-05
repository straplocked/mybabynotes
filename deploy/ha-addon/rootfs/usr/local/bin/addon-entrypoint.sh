#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Chris Carvache

# MyBabyNotes add-on entrypoint: pick local or remote mode from the add-on
# options, then get out of the way.
set -e

OPTIONS=/data/options.json
MODE=$(jq -r '.mode // "local"' "$OPTIONS" 2>/dev/null || echo local)

if [ "$MODE" = "remote" ]; then
  REMOTE_URL=$(jq -r '.remote_url // ""' "$OPTIONS" 2>/dev/null || echo "")
  case "$REMOTE_URL" in
    http://*|https://*) ;;
    *)
      echo "[mybabynotes] remote mode needs a remote_url like http://192.168.1.10:3500 — fix the add-on configuration." >&2
      exit 1
      ;;
  esac
  # strip any trailing slash so proxy_pass composes cleanly
  REMOTE_URL=${REMOTE_URL%/}
  echo "[mybabynotes] remote mode: proxying ingress to ${REMOTE_URL}"
  sed "s|__REMOTE_URL__|${REMOTE_URL}|g" /etc/babylog/nginx-remote.conf.template \
    > /etc/nginx/http.d/default.conf
  mkdir -p /run/nginx
  exec nginx -g "daemon off;"
fi

echo "[mybabynotes] local mode: booting the full stack (state in /data)"
# the AIO entrypoint does the rest: secrets into /data/.env, migrate, stamp
# the Reverb key into the bundle, then supervisord
exec /usr/local/bin/entrypoint.sh
