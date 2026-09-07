# Changelog

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
