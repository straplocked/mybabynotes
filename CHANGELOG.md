# Changelog

User-visible changes to the app, the API, and the images, newest first. The Home Assistant add-on
keeps its own log in [deploy/ha-addon/CHANGELOG.md](deploy/ha-addon/CHANGELOG.md), because Home
Assistant renders that one in the add-on store.

## 1.1.0 — 2026-09-11

### Security

A code audit on 2026-09-11 drove one batch of fixes, most severe first. See
[SECURITY.md](SECURITY.md#fixed-issues) for the one that warrants action from you.

- A personal access token minted from Settings → API access could call the PWA's own `/api/*` routes (state, invites, membership, settings, the MQTT broker config, the household websocket channel) regardless of the scopes it was minted with; every unversioned route now requires a first-party login token, and a token with any scope set gets 403 outside `/api/v1` and `/mcp`.
- `POST /api/push/subscribe` accepted any URL as a push endpoint, so a signed-in user could make every later household write POST an encrypted request at an address of their choosing, including LAN and loopback ones; endpoints must now be public `https://` URLs that neither are nor resolve to a private, loopback, link-local, CGNAT or multicast address.
- In the all-in-one image, a client-supplied `X-Forwarded-For` reached Laravel unchanged, so anyone could give themselves a fresh login/register/forgot-password throttle bucket per request; nginx now overwrites that header (and `X-Forwarded-Proto`) on every path into php-fpm, matching what the compose stack's front already did.
- nginx now enforces a `Content-Security-Policy` on every response (`default-src 'self'`, the one inline script allowed by hash, Google Fonts as the only third-party origins, `object-src 'none'`, `frame-ancestors 'self'`), which is the mitigation that matters for the bearer token kept in `localStorage`.
- The password-reset email linked to `?reset=<token>`, which lands the token in reverse-proxy and nginx access logs and in `Referer` headers; the link now carries it in the URL fragment (`/#reset=…`), and the app still accepts the old form for mails already sent.
- In the all-in-one image, Reverb, the scheduler and the MQTT listener ran as root; they now run as `www-data` under supervisord, leaving only supervisord and nginx (port 80) privileged inside the container.
- Web Push sends ran inside the HTTP request that triggered them with a 10-second timeout, so a slow or hostile push endpoint could hold a partner's write; sends now go out after the response, under a 5-second per-endpoint and 15-second per-flush budget.
- The MQTT "Test connection" button echoed the driver's raw exception text (hostnames, ports, OpenSSL detail) to the client; it now reports one of three fixed messages (unreachable, credentials rejected, TLS failed) and writes the detail to the API log instead.
- The Full-log CSV export wrote member names and detail text verbatim, so a member renamed to `=HYPERLINK(...)` opened as a formula in Excel, Sheets or LibreOffice; free-text cells that open with `=`, `+`, `-`, `@`, tab or CR are now prefixed with an apostrophe before quoting.
- Responses for `/assets/*` and `/sw.js` were missing `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy`, because a location-level `add_header` in nginx replaces the server-level set; both nginx configs now repeat the security headers in those locations.

### Changed

- The compose stack's API (`3501`) and Reverb (`3502`) host ports bind to `127.0.0.1` instead of every interface; they exist for the Vite dev proxy, and the app container on `3500` is the only port meant to be reached from the LAN.

### Fixed

- The plain-text invite and password-reset emails were HTML-escaped, so a reset link arrived as `…&amp;email=…` and never opened the reset screen; both templates now render their text unescaped.
