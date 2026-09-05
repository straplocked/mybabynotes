# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Chris Carvache
# Build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY vite.config.js index.html ./
COPY public ./public
COPY src ./src
ARG VITE_REVERB_APP_KEY=babylog-local-key
ENV VITE_REVERB_APP_KEY=$VITE_REVERB_APP_KEY
# AGPL §13: a modified build must offer ITS source, not ours — override with
# --build-arg VITE_SOURCE_URL=https://your.host/your-fork
ARG VITE_SOURCE_URL=
ENV VITE_SOURCE_URL=$VITE_SOURCE_URL
RUN npm run build

# Serve stage
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
# opt-in realip for the rate-limit zones (TRUSTED_PROXIES env, see real-ip.sh)
COPY real-ip.sh /docker-entrypoint.d/40-real-ip.sh
RUN chmod +x /docker-entrypoint.d/40-real-ip.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO /dev/null http://127.0.0.1/ || exit 1
