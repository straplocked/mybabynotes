# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Chris Carvache
# The Home Assistant add-on is the AIO image plus a ~50-line mode switch:
# local mode boots the whole app (nginx+fpm+reverb+scheduler+mqtt-listen via
# supervisord, state in the add-on's /data like any other add-on), remote
# mode is a thin nginx proxy that puts an EXISTING MyBabyNotes instance's UI
# behind ingress. jq reads /data/options.json; no bashio/s6 needed.
#
# Local sideload build (from the repo root, for testing on a HAOS box):
#   docker build -f deploy/ha-addon/Dockerfile --build-arg BUILD_FROM=mybabynotes-aio .
ARG BUILD_FROM=ghcr.io/straplocked/mybabynotes-aio:latest
FROM ${BUILD_FROM}
RUN apk add --no-cache jq
COPY deploy/ha-addon/rootfs /
RUN chmod +x /usr/local/bin/addon-entrypoint.sh
ENTRYPOINT ["addon-entrypoint.sh"]
