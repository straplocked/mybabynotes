# Changelog

## 1.1.0

- Security release — the add-on runs the same all-in-one image as every other install, so it
  picks up the whole batch from the app's [CHANGELOG](https://github.com/straplocked/mybabynotes/blob/main/CHANGELOG.md#110--2026-09-11).
  Nothing to configure. The two that touch the add-on's own container:
- Reverb, the scheduler and the MQTT listener now run as `www-data` instead of root inside the
  container; only supervisord and nginx (port 80) stay privileged.
- A client-supplied `X-Forwarded-For` no longer reaches the API, so the login throttle can't be
  sidestepped by forging one. Ingress still works: Home Assistant's proxy is the direct peer.
- Every response now carries a `Content-Security-Policy`. Ingress embeds the panel on Home
  Assistant's own origin, so `frame-ancestors 'self'` behaves like the existing
  `X-Frame-Options: SAMEORIGIN` did.
- If you created a scoped API token for a third party (an MCP client on another machine, a
  dashboard), revoke and re-issue it after updating — see
  [SECURITY.md](https://github.com/straplocked/mybabynotes/blob/main/SECURITY.md#fixed-issues).

## 1.0.2

- Documentation only; the add-on itself is unchanged from 1.0.1.
- Says out loud that **Show in sidebar** has to be turned on after installing.
  Home Assistant hides the panel for every newly installed ingress add-on and
  no manifest key can change that, but the docs read as though the sidebar
  entry appeared by itself.
- Explains that opening the ingress URL directly returns `401: Unauthorized`
  by design, so it isn't mistaken for a broken install.
- Remote mode said it needed "v1.1 or newer", a version that has never
  existed. It needs **v1.0.0 or newer**.

## 1.0.1

- First installable release. 1.0.0 pushed its add-on images under a tag Home
  Assistant never asks for, so the add-on appeared in the store but the
  install failed to pull. Nothing about the add-on itself changed.

## 1.0.0

- Initial add-on: ingress UI, `local` mode (full instance on the HA box,
  state in `/data`), `remote` mode (proxy an existing instance), optional
  direct LAN port for the installable PWA.
