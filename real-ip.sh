#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Chris Carvache

# Generates nginx realip config from TRUSTED_PROXIES: comma/space-separated
# IPs or CIDRs of reverse proxies allowed to speak for clients via
# X-Forwarded-For. With it set, the rate-limit zones key on the real client
# address; unset (the default), they key on the direct peer exactly as
# before — never trust XFF from an address you didn't name.
#
# Runs in two images: the app container (official nginx image, via
# /docker-entrypoint.d) and the all-in-one (alpine nginx package, called
# from entrypoint.sh) — hence the include-dir probe.
set -e
dir=/etc/nginx/http.d
[ -d "$dir" ] || dir=/etc/nginx/conf.d
conf="$dir/00-real-ip.conf"
rm -f "$conf"
[ -n "$TRUSTED_PROXIES" ] || exit 0
{
  echo "# generated at boot by real-ip.sh from TRUSTED_PROXIES"
  for peer in $(printf '%s' "$TRUSTED_PROXIES" | tr ',' ' '); do
    echo "set_real_ip_from $peer;"
  done
  echo "real_ip_header X-Forwarded-For;"
  echo "real_ip_recursive on;"
} > "$conf"
echo "==> rate limits key on real client IPs; trusted proxies: $TRUSTED_PROXIES"
